-- Identified work feedback: submission-only for staff + superadmin inbox, independent of tracking.
CREATE TABLE public.work_feedback (
  id uuid PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  mood smallint NOT NULL CHECK (mood BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK (length(comment) <= 2000),
  wants_follow_up boolean NOT NULL DEFAULT false,
  source text NOT NULL CHECK (source IN ('weekly','anytime')),
  week_start date NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','followed_up')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.employees(id)
);
CREATE UNIQUE INDEX work_feedback_weekly_unique ON public.work_feedback(employee_id, week_start) WHERE source = 'weekly';
CREATE INDEX work_feedback_inbox ON public.work_feedback(created_at DESC, id);
CREATE INDEX work_feedback_employee ON public.work_feedback(employee_id, created_at DESC);
CREATE TABLE public.work_feedback_prompts (
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  week_start date NOT NULL,
  PRIMARY KEY(employee_id, week_start)
);
ALTER TABLE public.work_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_feedback_prompts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_feedback, public.work_feedback_prompts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_feedback TO authenticated;
CREATE POLICY feedback_read ON public.work_feedback FOR SELECT TO authenticated USING (
  public.current_employee_role() = 'superadmin'
);
-- No direct prompt-table access. A claim suppresses repeat prompts even after Skip.
CREATE FUNCTION public.claim_work_feedback_prompt() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := public.current_employee_id();
  week_date date := date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata')::date;
  claimed integer;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'An active employee session is required'; END IF;
  IF EXISTS (SELECT 1 FROM public.work_feedback WHERE employee_id = actor AND week_start = week_date) THEN RETURN false; END IF;
  INSERT INTO public.work_feedback_prompts VALUES(actor, week_date) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS claimed = ROW_COUNT;
  RETURN claimed = 1;
END $$;
CREATE FUNCTION public.work_feedback_recipients() RETURNS TABLE(name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.name FROM public.employees e WHERE public.current_employee_id() IS NOT NULL
    AND e.role = 'superadmin' AND e.status = 'Active' ORDER BY e.name;
$$;
CREATE FUNCTION public.submit_work_feedback(request_id uuid, rating integer, message text DEFAULT '', follow_up boolean DEFAULT false, submission_source text DEFAULT 'anytime') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := public.current_employee_id(); existing public.work_feedback;
  week_date date := date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'An active employee session is required'; END IF;
  IF request_id IS NULL OR rating IS NULL OR rating NOT BETWEEN 1 AND 5 OR submission_source IS NULL OR submission_source NOT IN ('weekly','anytime') OR length(coalesce(message,'')) > 2000 THEN
    RAISE EXCEPTION 'Choose one of the five options and keep your comment within 2000 characters';
  END IF;
  -- Serialize retries and weekly submissions per employee; no duplicate records.
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text, 170002));
  SELECT * INTO existing FROM public.work_feedback WHERE id = request_id;
  IF FOUND THEN
    IF existing.employee_id <> actor THEN RAISE EXCEPTION 'Unable to submit feedback'; END IF;
    RETURN existing.id;
  END IF;
  IF submission_source = 'weekly' AND EXISTS (SELECT 1 FROM public.work_feedback WHERE employee_id = actor AND week_start = week_date AND source = 'weekly') THEN
    RAISE EXCEPTION 'Your weekly check-in is already submitted. You can share more through Share feedback.';
  END IF;
  INSERT INTO public.work_feedback(id,employee_id,mood,comment,wants_follow_up,source,week_start)
    VALUES(request_id,actor,rating,btrim(coalesce(message,'')),coalesce(follow_up,false),submission_source,week_date);
  RETURN request_id;
END $$;
CREATE FUNCTION public.list_work_feedback(status_filter text DEFAULT NULL, page_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, employee_name text, mood smallint, comment text, wants_follow_up boolean, source text, status text, created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := public.current_employee_id();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'An active employee session is required'; END IF;
  IF public.current_employee_role() IS DISTINCT FROM 'superadmin' THEN RAISE EXCEPTION 'Only superadmins can read the feedback inbox'; END IF;
  IF page_offset IS NULL OR page_offset < 0 OR (status_filter IS NOT NULL AND status_filter NOT IN ('new','acknowledged','followed_up')) THEN RAISE EXCEPTION 'Invalid feedback filter'; END IF;
  RETURN QUERY SELECT f.id,e.name,f.mood,f.comment,f.wants_follow_up,f.source,f.status,f.created_at,f.updated_at
    FROM public.work_feedback f JOIN public.employees e ON e.id = f.employee_id
    WHERE (status_filter IS NULL OR f.status = status_filter)
    ORDER BY f.created_at DESC, f.id LIMIT 50 OFFSET page_offset;
END $$;
CREATE FUNCTION public.advance_work_feedback(target_id uuid, expected_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.current_employee_role() IS DISTINCT FROM 'superadmin' THEN RAISE EXCEPTION 'Only superadmins can manage feedback'; END IF;
  IF expected_status IS NULL OR expected_status NOT IN ('new','acknowledged') THEN RAISE EXCEPTION 'Invalid feedback status'; END IF;
  UPDATE public.work_feedback SET status = CASE expected_status WHEN 'new' THEN 'acknowledged' ELSE 'followed_up' END,
    updated_at = now(), updated_by = public.current_employee_id()
    WHERE id = target_id AND status = expected_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'Feedback has changed. Refresh the inbox and try again.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.claim_work_feedback_prompt(), public.work_feedback_recipients(), public.submit_work_feedback(uuid,integer,text,boolean,text), public.list_work_feedback(text,integer), public.advance_work_feedback(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_work_feedback_prompt(), public.work_feedback_recipients(), public.submit_work_feedback(uuid,integer,text,boolean,text), public.list_work_feedback(text,integer), public.advance_work_feedback(uuid,text) TO authenticated;
