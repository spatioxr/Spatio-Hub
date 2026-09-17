-- Feedback 14 / 50, HRMS-029/030: fixed monthly costing and workload review.
BEGIN;

CREATE TABLE public.costing_baselines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  effective_month DATE NOT NULL CHECK (extract(day FROM effective_month) = 1),
  monthly_hours NUMERIC NOT NULL CHECK (monthly_hours > 0 AND monthly_hours <= 744),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by UUID NOT NULL REFERENCES public.employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.workload_day_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.employees(id),
  work_date DATE NOT NULL,
  fingerprint TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  reviewed_by UUID NOT NULL REFERENCES public.employees(id),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX workload_reviews_day ON public.workload_day_reviews(employee_id, work_date);
ALTER TABLE public.costing_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workload_day_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.costing_baselines, public.workload_day_reviews FROM anon, authenticated;
GRANT SELECT ON public.costing_baselines, public.workload_day_reviews TO authenticated;
CREATE POLICY costing_baselines_read ON public.costing_baselines FOR SELECT TO authenticated
  USING (public.current_employee_role() IN ('manager', 'admin', 'superadmin'));
CREATE POLICY workload_reviews_read ON public.workload_day_reviews FOR SELECT TO authenticated
  USING (public.has_organisation_access() OR (public.current_employee_role() = 'manager' AND reviewed_by = public.current_employee_id()));
CREATE TRIGGER costing_baselines_immutable BEFORE UPDATE OR DELETE ON public.costing_baselines
  FOR EACH ROW EXECUTE FUNCTION public.prevent_leave_balance_transaction_mutation();
CREATE TRIGGER workload_reviews_immutable BEFORE UPDATE OR DELETE ON public.workload_day_reviews
  FOR EACH ROW EXECUTE FUNCTION public.prevent_leave_balance_transaction_mutation();

CREATE FUNCTION public.set_costing_baseline(target_month DATE, hours_per_month NUMERIC, change_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_organisation_access() THEN RAISE EXCEPTION 'Admin access is required'; END IF;
  IF target_month IS NULL OR extract(day FROM target_month) <> 1
     OR target_month < date_trunc('month', public.app_current_date())::date THEN
    RAISE EXCEPTION 'Choose the current month or a future month';
  END IF;
  IF hours_per_month IS NULL OR hours_per_month <= 0 OR hours_per_month > 744
    OR COALESCE(length(btrim(change_reason)), 0) = 0 THEN
    RAISE EXCEPTION 'Valid monthly hours and a reason are required';
  END IF;
  INSERT INTO public.costing_baselines(effective_month, monthly_hours, reason, created_by)
  VALUES (target_month, hours_per_month, btrim(change_reason), public.current_employee_id());
END;
$$;

-- Align raw work / break / audit reads with owned projects. The workload RPC
-- below exposes only aggregates for other projects; it does not widen raw RLS.
CREATE OR REPLACE FUNCTION public.can_access_work_entry(target_work_entry_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.work_entries e WHERE e.id = target_work_entry_id
    AND (e.employee_id = public.current_employee_id() OR public.has_organisation_access()
      OR (public.current_employee_role() = 'manager' AND
        ((e.project_id IS NOT NULL AND public.can_manage_project(e.project_id))
          OR (e.project_id IS NULL AND public.can_access_employee(e.employee_id))))));
$$;
DROP POLICY work_entries_select_scoped ON public.work_entries;
CREATE POLICY work_entries_select_scoped ON public.work_entries FOR SELECT TO authenticated
  USING (public.can_access_work_entry(id));
DO $$
DECLARE signature TEXT; definition TEXT;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.scoped_timesheet_entries(timestamp with time zone,timestamp with time zone,text,uuid)',
    'public.scoped_voided_timesheet_entries(timestamp with time zone,timestamp with time zone,text,uuid)'
  ] LOOP
    SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
    IF position('AND entry.started_at >= requested_start_at' IN definition) = 0 THEN
      RAISE EXCEPTION 'Expected timesheet predicate missing';
    END IF;
    EXECUTE replace(definition, 'AND entry.started_at >= requested_start_at',
      'AND public.can_access_work_entry(entry.id) AND entry.started_at >= requested_start_at');
  END LOOP;
  SELECT pg_get_functiondef('public.work_entry_change_history(uuid)'::regprocedure) INTO definition;
  EXECUTE replace(definition, 'IF NOT (', 'IF NOT public.can_access_work_entry(target_work_entry_id) OR NOT (');
END;
$$;

-- Private calculator: one employee-month, day slices clipped to IST midnight,
-- including entries that began before the requested month. Never client-callable.
CREATE FUNCTION public.workload_person_days(target_employee UUID, month_start DATE)
RETURNS TABLE(work_date DATE, is_working_day BOOLEAN, leave_fraction NUMERIC,
  recorded_seconds NUMERIC, open_seconds NUMERIC, flags TEXT[], fingerprint TEXT,
  confirmed BOOLEAN, can_review BOOLEAN, contexts JSONB, review_entries JSONB)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH calendar AS (
  SELECT d::date AS day,
    extract(isodow FROM d)::smallint = ANY(COALESCE((SELECT working_weekdays FROM public.attendance_policy WHERE singleton), ARRAY[1,2,3,4,5]::smallint[]))
      AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.date = d::date)
      AND d::date >= COALESCE((SELECT date_of_joining FROM public.employees WHERE id = target_employee), month_start) AS working
  FROM generate_series(month_start::timestamp, (month_start + interval '1 month - 1 day')::timestamp, interval '1 day') d
), slices AS (
  SELECT c.day, e.*,
    greatest(0, extract(epoch FROM least(COALESCE(e.ended_at, statement_timestamp()), public.app_day_start(c.day + 1))
      - greatest(e.started_at, public.app_day_start(c.day))) - COALESCE(b.seconds, 0)) AS seconds,
    b.snapshot AS breaks,
    public.can_access_work_entry(e.id) AS visible,
    COALESCE(e.ended_at, statement_timestamp()) - e.started_at >= interval '24 hours' AS excessive_session,
    e.ended_at IS NULL AND public.app_current_date(e.started_at) < public.app_current_date() AS previous_day_open
  FROM calendar c JOIN public.work_entries e ON e.employee_id = target_employee AND e.voided_at IS NULL
    AND e.started_at < public.app_day_start(c.day + 1)
    AND COALESCE(e.ended_at, statement_timestamp()) > public.app_day_start(c.day)
  LEFT JOIN LATERAL (
    SELECT sum(greatest(0, extract(epoch FROM
      least(COALESCE(b.ended_at, statement_timestamp()), COALESCE(e.ended_at, statement_timestamp()), public.app_day_start(c.day + 1))
      - greatest(b.started_at, e.started_at, public.app_day_start(c.day))))) AS seconds,
      jsonb_agg(to_jsonb(b) ORDER BY b.id) AS snapshot
    FROM public.break_entries b WHERE b.work_entry_id = e.id
  ) b ON true
), facts AS (
  SELECT c.day, c.working,
    CASE WHEN c.working THEN least(1, COALESCE((SELECT sum(CASE WHEN l.days = 0.5 THEN 0.5 ELSE 1 END)
      FROM public.leaves l WHERE l.employee_id = target_employee AND l.status = 'Approved'
        AND c.day BETWEEN l.from_date AND l.to_date), 0)) ELSE 0 END AS leave,
    COALESCE(sum(s.seconds), 0) AS recorded,
    COALESCE(sum(s.seconds) FILTER (WHERE s.ended_at IS NULL), 0) AS live,
    COALESCE(bool_or(s.ended_at IS NULL) FILTER (WHERE s.id IS NOT NULL), false) AS has_open,
    COALESCE(bool_or(s.excessive_session), false) AS excessive,
    COALESCE(bool_or(s.previous_day_open), false) AS old_open,
    COALESCE(bool_or(s.ended_at > statement_timestamp()), false) AS future_end,
    COALESCE(bool_and(s.visible), false) AS all_visible,
    md5(COALESCE(string_agg((to_jsonb(s) - 'seconds' - 'visible' - 'excessive_session' - 'previous_day_open')::text, ',' ORDER BY s.id), '')) AS fingerprint
  FROM calendar c LEFT JOIN slices s ON s.day = c.day GROUP BY c.day, c.working
), reviewed AS (
  SELECT f.*, EXISTS (SELECT 1 FROM public.workload_day_reviews r
    WHERE r.employee_id = target_employee AND r.work_date = f.day AND r.fingerprint = f.fingerprint) AS confirmed
  FROM facts f
)
SELECT f.day, f.working, f.leave, f.recorded, f.live,
  array_remove(ARRAY[
    CASE WHEN f.has_open THEN 'in_progress' END,
    CASE WHEN f.old_open THEN 'previous_day_open' END,
    CASE WHEN f.excessive THEN 'stale_session' END,
    CASE WHEN f.future_end THEN 'future_time' END,
    CASE WHEN f.recorded > 43200 AND NOT f.confirmed THEN 'long_day' END,
    CASE WHEN f.recorded > 0 AND f.leave = 1 THEN 'work_on_leave' END,
    CASE WHEN f.working AND f.day < public.app_current_date() AND f.leave < 1 AND f.recorded < 28800 * (1-f.leave) THEN 'missing_time' END,
    CASE WHEN f.recorded > 28800 THEN 'above_eight' END
  ], NULL), f.fingerprint, f.confirmed,
  public.has_organisation_access() OR (public.current_employee_role() = 'manager' AND f.all_visible AND public.can_access_employee(target_employee)
    AND target_employee <> public.current_employee_id()) AS can_review,
  COALESCE((SELECT jsonb_agg(to_jsonb(g)) FROM (
    SELECT CASE WHEN s.project_id IS NOT NULL AND s.visible THEN s.project_id::text
                WHEN s.project_id IS NOT NULL THEN 'other_projects'
                WHEN public.has_organisation_access() THEN s.activity_id::text ELSE 'internal' END AS context_id,
      CASE WHEN s.project_id IS NOT NULL AND s.visible THEN 'project'
           WHEN s.project_id IS NOT NULL THEN 'other_projects' ELSE 'activity' END AS context_type,
      CASE WHEN s.project_id IS NOT NULL AND s.visible THEN (SELECT p.code || ' · ' || p.name FROM public.projects p WHERE p.id = s.project_id)
           WHEN s.project_id IS NOT NULL THEN 'Other projects'
           WHEN public.has_organisation_access() THEN (SELECT a.name FROM public.activities a WHERE a.id = s.activity_id) ELSE 'Internal activities' END AS label,
      sum(s.seconds) AS recorded_seconds
    FROM slices s WHERE s.day = f.day GROUP BY 1,2,3
  ) g), '[]'::jsonb),
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'started_at', s.started_at, 'ended_at', s.ended_at,
    'label', COALESCE(p.name, a.name), 'task_description', s.task_description,
    'can_close', public.has_organisation_access() AND s.ended_at IS NULL AND s.previous_day_open)
    ORDER BY s.started_at)
    FROM slices s LEFT JOIN public.projects p ON p.id = s.project_id LEFT JOIN public.activities a ON a.id = s.activity_id
    WHERE s.day = f.day AND s.visible), '[]'::jsonb)
FROM reviewed f ORDER BY f.day;
$$;

CREATE FUNCTION public.workload_month(requested_month DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB; month_start DATE; baseline NUMERIC; working_days INT;
BEGIN
  IF public.current_employee_role() IS NULL OR public.current_employee_role() NOT IN ('manager','admin','superadmin') THEN
    RAISE EXCEPTION 'Management access is required';
  END IF;
  IF requested_month IS NULL OR extract(day FROM requested_month) <> 1 THEN RAISE EXCEPTION 'Choose a month'; END IF;
  month_start := requested_month;
  SELECT monthly_hours INTO baseline FROM public.costing_baselines
    WHERE effective_month <= month_start ORDER BY effective_month DESC, id DESC LIMIT 1;
  baseline := COALESCE(baseline, 176);
  SELECT count(*) INTO working_days FROM generate_series(month_start::timestamp,
    (month_start + interval '1 month - 1 day')::timestamp, interval '1 day') d
    WHERE extract(isodow FROM d)::smallint = ANY(COALESCE((SELECT working_weekdays FROM public.attendance_policy WHERE singleton), ARRAY[1,2,3,4,5]::smallint[]))
      AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.date = d::date);
  WITH people AS MATERIALIZED (
    SELECT e.id, e.name, e.emp_code, e.department, e.status FROM public.employees e
    WHERE (e.date_of_joining IS NULL OR e.date_of_joining < month_start + interval '1 month')
      AND (e.status <> 'Released' OR EXISTS (SELECT 1 FROM public.work_entries w WHERE w.employee_id = e.id
        AND w.voided_at IS NULL AND w.started_at < public.app_day_start((month_start + interval '1 month')::date)
        AND COALESCE(w.ended_at, statement_timestamp()) > public.app_day_start(month_start)))
      AND (public.has_organisation_access() OR public.can_access_employee(e.id)
        OR EXISTS (SELECT 1 FROM public.project_managers pm WHERE pm.employee_id = e.id AND public.can_manage_project(pm.project_id))
        OR EXISTS (SELECT 1 FROM public.work_entries w WHERE w.employee_id = e.id AND w.voided_at IS NULL
          AND w.started_at < public.app_day_start((month_start + interval '1 month')::date)
          AND COALESCE(w.ended_at, statement_timestamp()) > public.app_day_start(month_start)
          AND public.can_manage_project(w.project_id)))
  ), days AS MATERIALIZED (
    SELECT p.id AS employee_id, f.*,
      NOT (f.flags && ARRAY['in_progress','stale_session','future_time','long_day','work_on_leave']) AS eligible,
      baseline / NULLIF(working_days,0) * f.leave_fraction AS leave_hours,
      CASE WHEN f.is_working_day AND NOT (f.flags && ARRAY['in_progress','stale_session','future_time','long_day','work_on_leave'])
        THEN baseline / NULLIF(working_days,0) * least(1-f.leave_fraction, f.recorded_seconds / 28800)
        ELSE 0 END AS coverage_hours
    FROM people p CROSS JOIN LATERAL public.workload_person_days(p.id, month_start) f
  ), totals AS (
    SELECT employee_id, sum(coverage_hours) AS pool, sum(leave_hours) AS leave_hours,
      COALESCE(sum(recorded_seconds) FILTER (WHERE eligible),0) AS weight,
      bool_or(flags && ARRAY['previous_day_open','stale_session','future_time','long_day','work_on_leave','missing_time']) AS needs_review
    FROM days GROUP BY employee_id
  ), person_json AS (
    SELECT p.name, jsonb_build_object('id', p.id, 'name', p.name, 'emp_code', p.emp_code,
      'department', p.department, 'status', p.status, 'monthly_hours', baseline,
      'can_open_timesheet', p.status = 'Active' AND (public.has_organisation_access() OR public.can_access_employee(p.id)),
      'allocated_hours', COALESCE(t.pool,0), 'leave_hours', COALESCE(t.leave_hours,0),
      'unallocated_hours', greatest(0,baseline-COALESCE(t.pool,0)-COALESCE(t.leave_hours,0)),
      'needs_review', t.needs_review,
      'days', (SELECT jsonb_agg((to_jsonb(d) - 'employee_id' - 'coverage_hours' - 'eligible') || jsonb_build_object(
        'costing_hours', CASE WHEN d.eligible THEN COALESCE(t.pool*d.recorded_seconds/NULLIF(t.weight,0),0) ELSE 0 END,
        'contexts', (SELECT COALESCE(jsonb_agg(c || jsonb_build_object('costing_hours',
          CASE WHEN d.eligible THEN COALESCE(t.pool*(c->>'recorded_seconds')::numeric/NULLIF(t.weight,0),0) ELSE 0 END)), '[]'::jsonb)
          FROM jsonb_array_elements(d.contexts) c)) ORDER BY d.work_date) FROM days d WHERE d.employee_id = p.id)) AS value
    FROM people p JOIN totals t ON t.employee_id = p.id
  )
  SELECT jsonb_build_object('month', month_start, 'monthly_hours', baseline, 'working_days', working_days,
    'generated_at', statement_timestamp(), 'people', COALESCE((SELECT jsonb_agg(value ORDER BY name) FROM person_json), '[]'::jsonb),
    'projects', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM public.project_administration_overview() p), '[]'::jsonb)) INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION public.confirm_workload_day(target_employee UUID, target_date DATE, expected_fingerprint TEXT, review_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE fact RECORD;
BEGIN
  IF public.current_employee_role() IS NULL OR public.current_employee_role() NOT IN ('manager','admin','superadmin') THEN RAISE EXCEPTION 'Management access is required'; END IF;
  IF NOT (public.has_organisation_access() OR public.can_access_employee(target_employee)) THEN RAISE EXCEPTION 'Person outside your scope'; END IF;
  IF target_date IS NULL OR COALESCE(length(btrim(review_reason)),0) = 0 THEN RAISE EXCEPTION 'A date and review reason are required'; END IF;
  -- Serialise confirmations/corrections on the affected entries.
  PERFORM 1 FROM public.work_entries e WHERE e.employee_id = target_employee AND e.voided_at IS NULL
    AND e.started_at < public.app_day_start(target_date + 1)
    AND COALESCE(e.ended_at, statement_timestamp()) > public.app_day_start(target_date) FOR UPDATE;
  SELECT * INTO fact FROM public.workload_person_days(target_employee, date_trunc('month',target_date)::date) d WHERE d.work_date = target_date;
  IF NOT fact.can_review OR fact.fingerprint IS DISTINCT FROM expected_fingerprint THEN RAISE EXCEPTION 'Access denied or entries changed; refresh and review again'; END IF;
  IF NOT ('long_day' = ANY(fact.flags)) OR fact.flags && ARRAY['in_progress','stale_session','future_time','work_on_leave'] THEN
    RAISE EXCEPTION 'Only a completed long day without blocking issues can be confirmed';
  END IF;
  INSERT INTO public.workload_day_reviews(employee_id, work_date, fingerprint, reason, reviewed_by)
    VALUES(target_employee, target_date, fact.fingerprint, btrim(review_reason), public.current_employee_id());
END;
$$;

CREATE FUNCTION public.close_stale_work_entry(target_entry UUID, actual_end TIMESTAMPTZ, change_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_entry public.work_entries; updated_entry public.work_entries; old_breaks JSONB; new_breaks JSONB;
BEGIN
  IF NOT public.has_organisation_access() THEN RAISE EXCEPTION 'An Admin must resolve an open timer'; END IF;
  IF COALESCE(length(btrim(change_reason)),0) = 0 THEN RAISE EXCEPTION 'A correction reason is required'; END IF;
  PERFORM 1 FROM public.employees WHERE id = (SELECT employee_id FROM public.work_entries WHERE id = target_entry) FOR UPDATE;
  SELECT * INTO old_entry FROM public.work_entries WHERE id = target_entry FOR UPDATE;
  IF old_entry.id IS NULL OR old_entry.voided_at IS NOT NULL OR old_entry.ended_at IS NOT NULL
    OR public.app_current_date(old_entry.started_at) >= public.app_current_date() THEN RAISE EXCEPTION 'This is not an unresolved previous-day timer'; END IF;
  IF actual_end IS NULL OR actual_end <= old_entry.started_at OR actual_end > clock_timestamp() THEN RAISE EXCEPTION 'Choose the actual end after the start and before now'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.started_at),'[]'::jsonb) INTO old_breaks FROM public.break_entries b WHERE b.work_entry_id = target_entry;
  -- Do not guess whether a previously recorded break happened.
  IF EXISTS (SELECT 1 FROM public.break_entries WHERE work_entry_id = target_entry
    AND (started_at >= actual_end OR ended_at > actual_end)) THEN RAISE EXCEPTION 'The chosen end precedes a recorded break; review the timeline before resolving'; END IF;
  UPDATE public.break_entries SET ended_at = actual_end WHERE work_entry_id = target_entry AND ended_at IS NULL;
  UPDATE public.work_entries SET ended_at = actual_end, corrected_by = public.current_employee_id(), correction_reason = btrim(change_reason)
    WHERE id = target_entry RETURNING * INTO updated_entry;
  SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.started_at),'[]'::jsonb) INTO new_breaks FROM public.break_entries b WHERE b.work_entry_id = target_entry;
  INSERT INTO public.work_entry_audit(work_entry_id, employee_id, changed_by, change_reason, old_record, new_record)
    VALUES(target_entry, old_entry.employee_id, public.current_employee_id(), btrim(change_reason),
      to_jsonb(old_entry) || jsonb_build_object('breaks',old_breaks), to_jsonb(updated_entry) || jsonb_build_object('breaks',new_breaks));
  UPDATE public.attendance SET check_out = public.app_clock_time(actual_end)
    WHERE employee_id = old_entry.employee_id AND date = public.app_current_date(old_entry.started_at);
  -- The legacy clock-time trigger anchors to the attendance start date. Preserve
  -- an actual overnight end explicitly after it has run.
  UPDATE public.attendance SET checked_out_at = actual_end
    WHERE employee_id = old_entry.employee_id AND date = public.app_current_date(old_entry.started_at);
  INSERT INTO public.admin_work_action_audit(employee_id, acted_by, action, work_entry_id, details)
    VALUES(old_entry.employee_id, public.current_employee_id(), 'end_day', target_entry,
      jsonb_build_object('source','stale_correction','actual_end',actual_end,'reason',btrim(change_reason)));
END;
$$;

REVOKE ALL ON FUNCTION public.workload_person_days(UUID,DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workload_month(DATE), public.set_costing_baseline(DATE,NUMERIC,TEXT),
  public.confirm_workload_day(UUID,DATE,TEXT,TEXT), public.close_stale_work_entry(UUID,TIMESTAMPTZ,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workload_month(DATE), public.set_costing_baseline(DATE,NUMERIC,TEXT),
  public.confirm_workload_day(UUID,DATE,TEXT,TEXT), public.close_stale_work_entry(UUID,TIMESTAMPTZ,TEXT) TO authenticated;
COMMIT;
