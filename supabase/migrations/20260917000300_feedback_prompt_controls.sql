-- Superadmin scheduling and optional, time-limited team pulses.
CREATE TABLE public.work_feedback_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT true,
 frequency text NOT NULL DEFAULT 'weekly' CHECK(frequency IN ('weekly','fortnightly','monthly')),
 weekday integer NOT NULL DEFAULT 1 CHECK(weekday BETWEEN 1 AND 7), starts_on date NOT NULL DEFAULT '2026-01-05'
);
INSERT INTO public.work_feedback_settings DEFAULT VALUES;
CREATE TABLE public.work_feedback_pulses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 created_by uuid NOT NULL REFERENCES public.employees(id), closed_at timestamptz
);
CREATE TABLE public.work_feedback_pulse_claims (
 pulse_id uuid REFERENCES public.work_feedback_pulses(id) NOT NULL,
 employee_id uuid REFERENCES public.employees(id) NOT NULL,
 PRIMARY KEY(pulse_id,employee_id)
);
ALTER TABLE public.work_feedback_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_feedback_pulses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_feedback_pulse_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_feedback_settings,public.work_feedback_pulses,public.work_feedback_pulse_claims FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.work_feedback_settings,public.work_feedback_pulses TO authenticated;
CREATE POLICY settings_superadmin ON public.work_feedback_settings FOR SELECT TO authenticated USING(public.current_employee_role()='superadmin');
CREATE POLICY pulses_superadmin ON public.work_feedback_pulses FOR SELECT TO authenticated USING(public.current_employee_role()='superadmin');
ALTER TABLE public.work_feedback DROP CONSTRAINT work_feedback_source_check;
ALTER TABLE public.work_feedback ADD CONSTRAINT work_feedback_source_check CHECK(source IN ('weekly','anytime','pulse'));
ALTER TABLE public.work_feedback ADD COLUMN pulse_id uuid REFERENCES public.work_feedback_pulses(id);
CREATE UNIQUE INDEX work_feedback_pulse_unique ON public.work_feedback(employee_id,pulse_id) WHERE pulse_id IS NOT NULL;

-- Latest scheduled date: monthly means the first chosen weekday of each month.
CREATE FUNCTION public.feedback_schedule_due(today date, frequency text, weekday integer) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE anchor date := date '2026-01-05'+weekday-1; due date; step integer;
BEGIN
 IF frequency='monthly' THEN
   due := date_trunc('month',today)::date;
   due := due + ((weekday-extract(isodow FROM due)::integer+7)%7);
   IF due>today THEN
     due := (date_trunc('month',today)-interval '1 month')::date;
     due := due + ((weekday-extract(isodow FROM due)::integer+7)%7);
   END IF;
   RETURN due;
 END IF;
 step := CASE WHEN frequency='fortnightly' THEN 14 ELSE 7 END;
 RETURN anchor + (floor((today-anchor)::numeric/step)::integer*step);
END $$;
CREATE OR REPLACE FUNCTION public.claim_work_feedback_prompt() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid := public.current_employee_id(); settings public.work_feedback_settings;
 due date; claimed integer;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'An active employee session is required'; END IF;
 SELECT * INTO settings FROM public.work_feedback_settings WHERE id;
 IF NOT settings.enabled THEN RETURN false; END IF;
 due := public.feedback_schedule_due((now() AT TIME ZONE 'Asia/Kolkata')::date,settings.frequency,settings.weekday);
 IF due < settings.starts_on THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.work_feedback WHERE employee_id=actor AND created_at >= (due::timestamp AT TIME ZONE 'Asia/Kolkata')) THEN RETURN false; END IF;
 -- Also honor a prompt already shown this week when settings change.
 IF EXISTS(SELECT 1 FROM public.work_feedback_prompts WHERE employee_id=actor AND week_start>=date_trunc('week',now() AT TIME ZONE 'Asia/Kolkata')::date) THEN RETURN false; END IF;
 INSERT INTO public.work_feedback_prompts VALUES(actor,due) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS claimed=ROW_COUNT;
 RETURN claimed=1;
END $$;
CREATE FUNCTION public.manage_work_feedback(action text, automatic boolean DEFAULT NULL, cadence text DEFAULT NULL, preferred_day integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE settings public.work_feedback_settings; pulse public.work_feedback_pulses;
BEGIN
 IF public.current_employee_role() IS DISTINCT FROM 'superadmin' THEN RAISE EXCEPTION 'Only superadmins can manage feedback prompts'; END IF;
 -- Serialize launches and settings writes, including retrying an active pulse.
 SELECT * INTO settings FROM public.work_feedback_settings WHERE id FOR UPDATE;
 IF action='save' THEN
   IF automatic IS NULL OR cadence IS NULL OR cadence NOT IN ('weekly','fortnightly','monthly') OR preferred_day IS NULL OR preferred_day NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'Choose a valid schedule'; END IF;
   UPDATE public.work_feedback_settings SET starts_on=CASE WHEN (enabled,frequency,weekday) IS DISTINCT FROM (automatic,cadence,preferred_day) THEN (now() AT TIME ZONE 'Asia/Kolkata')::date ELSE starts_on END,enabled=automatic,frequency=cadence,weekday=preferred_day WHERE id RETURNING * INTO settings;
 ELSIF action='launch' THEN
   IF NOT EXISTS(SELECT 1 FROM public.work_feedback_pulses WHERE closed_at IS NULL AND expires_at>now()) THEN
     INSERT INTO public.work_feedback_pulses(created_by) VALUES(public.current_employee_id());
   END IF;
 ELSIF action='close' THEN
   UPDATE public.work_feedback_pulses SET closed_at=now() WHERE closed_at IS NULL AND expires_at>now();
 ELSIF action<>'get' OR action IS NULL THEN RAISE EXCEPTION 'Invalid action';
 END IF;
 SELECT * INTO pulse FROM public.work_feedback_pulses WHERE closed_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1;
 RETURN jsonb_build_object('enabled',settings.enabled,'frequency',settings.frequency,'weekday',settings.weekday,'pulse',CASE WHEN pulse.id IS NULL THEN NULL ELSE to_jsonb(pulse) END,
 'next_due',public.feedback_schedule_due((now() AT TIME ZONE 'Asia/Kolkata')::date,settings.frequency,settings.weekday));
END $$;
CREATE FUNCTION public.claim_work_feedback_pulse() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid:=public.current_employee_id(); pulse public.work_feedback_pulses; claimed integer;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'An active employee session is required'; END IF;
 SELECT * INTO pulse FROM public.work_feedback_pulses WHERE closed_at IS NULL AND expires_at>now() AND created_by<>actor ORDER BY created_at DESC LIMIT 1;
 IF pulse.id IS NULL THEN RETURN NULL; END IF;
 INSERT INTO public.work_feedback_pulse_claims VALUES(pulse.id,actor) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS claimed=ROW_COUNT;
 RETURN CASE WHEN claimed=1 THEN pulse.id ELSE NULL END;
END $$;

DROP FUNCTION public.submit_work_feedback(uuid,integer,text,boolean,text);
CREATE FUNCTION public.submit_work_feedback(request_id uuid, rating integer, message text DEFAULT '', follow_up boolean DEFAULT false, submission_source text DEFAULT 'anytime', pulse_request uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := public.current_employee_id(); existing public.work_feedback;
  week_date date := date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'An active employee session is required'; END IF;
  IF request_id IS NULL OR rating IS NULL OR rating NOT BETWEEN 1 AND 5 OR submission_source IS NULL OR submission_source NOT IN ('weekly','anytime','pulse') OR length(coalesce(message,'')) > 2000 THEN
    RAISE EXCEPTION 'Choose one of the five options and keep your comment within 2000 characters';
  END IF;
  -- Serialize retries and weekly submissions per employee; no duplicate records.
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text, 170002));
  SELECT * INTO existing FROM public.work_feedback WHERE id = request_id;
  IF FOUND THEN
    IF existing.employee_id <> actor THEN RAISE EXCEPTION 'Unable to submit feedback'; END IF;
    RETURN existing.id;
  END IF;
  IF submission_source = 'pulse' AND (pulse_request IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.work_feedback_pulse_claims WHERE pulse_id=pulse_request AND employee_id=actor
  )) THEN RAISE EXCEPTION 'This pulse is not available to your session'; END IF;
  IF submission_source <> 'pulse' AND pulse_request IS NOT NULL THEN RAISE EXCEPTION 'Invalid pulse response'; END IF;
  IF submission_source = 'weekly' AND EXISTS (SELECT 1 FROM public.work_feedback WHERE employee_id = actor AND week_start = week_date AND source = 'weekly') THEN
    RAISE EXCEPTION 'Your weekly check-in is already submitted. You can share more through Share feedback.';
  END IF;
  INSERT INTO public.work_feedback(id,employee_id,mood,comment,wants_follow_up,source,week_start,pulse_id)
    VALUES(request_id,actor,rating,btrim(coalesce(message,'')),coalesce(follow_up,false),submission_source,week_date,pulse_request);
  RETURN request_id;
END $$;

REVOKE ALL ON FUNCTION public.feedback_schedule_due(date,text,integer),public.manage_work_feedback(text,boolean,text,integer),public.claim_work_feedback_pulse(),public.submit_work_feedback(uuid,integer,text,boolean,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_work_feedback(text,boolean,text,integer),public.claim_work_feedback_pulse(),public.submit_work_feedback(uuid,integer,text,boolean,text,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
