-- HRMS-018 refinement: allow a same-day return after End Day.
-- Reopening keeps the original BOS, invalidates the provisional EOD, and
-- reopens attendance so the next End Day becomes the final daily close.

BEGIN;

CREATE OR REPLACE FUNCTION public.start_work_day(
  target_project_id UUID,
  target_activity_id UUID,
  session_task_description TEXT,
  beginning_of_day_report TEXT
)
RETURNS public.work_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET TimeZone = 'Asia/Kolkata'
AS $$
DECLARE
  actor_employee_id UUID;
  work_date DATE := current_date;
  require_bos BOOLEAN := true;
  bos_already_submitted BOOLEAN := false;
  eod_already_submitted BOOLEAN := false;
  worked_today BOOLEAN := false;
  created_session public.work_entries;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  -- Serialise every start/end transition for this employee so concurrent
  -- clicks cannot leave the report or attendance state half reopened.
  PERFORM 1
  FROM public.employees employee
  WHERE employee.id = actor_employee_id
  FOR UPDATE;

  SELECT COALESCE(settings.bos_required, true)
  INTO require_bos
  FROM (SELECT 1) seed
  LEFT JOIN public.employee_work_settings settings
    ON settings.employee_id = actor_employee_id;

  SELECT
    report.bos_submitted_at IS NOT NULL,
    report.eod_submitted_at IS NOT NULL
  INTO bos_already_submitted, eod_already_submitted
  FROM public.daily_reports report
  WHERE report.employee_id = actor_employee_id
    AND report.date = work_date;

  bos_already_submitted := COALESCE(bos_already_submitted, false);
  eod_already_submitted := COALESCE(eod_already_submitted, false);

  SELECT EXISTS (
    SELECT 1
    FROM public.work_entries entry
    WHERE entry.employee_id = actor_employee_id
      AND entry.started_at >= work_date::timestamptz
      AND entry.started_at < (work_date + 1)::timestamptz
  )
  INTO worked_today;

  IF NOT worked_today
    AND NOT bos_already_submitted
    AND require_bos
    AND COALESCE(length(btrim(beginning_of_day_report)), 0) = 0
  THEN
    RAISE EXCEPTION 'Beginning-of-day report is required before starting work';
  END IF;

  IF NOT worked_today
    AND NOT bos_already_submitted
    AND COALESCE(length(btrim(beginning_of_day_report)), 0) > 0
  THEN
    INSERT INTO public.daily_reports (
      employee_id,
      date,
      bos_report
    )
    VALUES (
      actor_employee_id,
      work_date,
      btrim(beginning_of_day_report)
    )
    ON CONFLICT (employee_id, date) DO UPDATE
    SET bos_report = EXCLUDED.bos_report
    WHERE public.daily_reports.bos_submitted_at IS NULL;
  END IF;

  SELECT *
  INTO created_session
  FROM public.start_work_session(
    target_project_id,
    target_activity_id,
    session_task_description
  );

  -- An EOD submitted before a same-day return is no longer the final report.
  -- Clearing the text also clears eod_submitted_at through the guarded trigger.
  IF eod_already_submitted THEN
    UPDATE public.daily_reports report
    SET eod_report = NULL
    WHERE report.employee_id = actor_employee_id
      AND report.date = work_date
      AND report.eod_submitted_at IS NOT NULL;
  END IF;

  INSERT INTO public.attendance (
    employee_id,
    date,
    check_in,
    check_out,
    status
  )
  VALUES (
    actor_employee_id,
    work_date,
    created_session.started_at::time,
    NULL,
    CASE
      WHEN created_session.started_at::time >= TIME '10:30' THEN 'Late'
      ELSE 'Present'
    END
  )
  ON CONFLICT (employee_id, date) DO UPDATE
  SET check_in = COALESCE(public.attendance.check_in, EXCLUDED.check_in),
      check_out = NULL,
      status = COALESCE(public.attendance.status, EXCLUDED.status);

  RETURN created_session;
END;
$$;

REVOKE ALL ON FUNCTION public.start_work_day(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_work_day(UUID, UUID, TEXT, TEXT)
  TO authenticated;

COMMIT;
