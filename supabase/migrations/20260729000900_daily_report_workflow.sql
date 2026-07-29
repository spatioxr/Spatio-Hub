-- HRMS-018: integrate BOS/EOD reports with first start and final End Day.
-- Project switching remains a session boundary, not a daily-report boundary.

BEGIN;

CREATE OR REPLACE FUNCTION public.current_work_day_requirements()
RETURNS TABLE (
  report_date DATE,
  bos_required BOOLEAN,
  eod_required BOOLEAN,
  bos_submitted BOOLEAN,
  eod_submitted BOOLEAN,
  has_work_today BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  work_date DATE := current_date;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  RETURN QUERY
  SELECT
    work_date,
    COALESCE(settings.bos_required, true),
    COALESCE(settings.eod_required, true),
    report.bos_submitted_at IS NOT NULL,
    report.eod_submitted_at IS NOT NULL,
    EXISTS (
      SELECT 1
      FROM public.work_entries entry
      WHERE entry.employee_id = actor_employee_id
        AND entry.started_at >= work_date::timestamptz
        AND entry.started_at < (work_date + 1)::timestamptz
    )
  FROM (SELECT 1) seed
  LEFT JOIN public.employee_work_settings settings
    ON settings.employee_id = actor_employee_id
  LEFT JOIN public.daily_reports report
    ON report.employee_id = actor_employee_id
   AND report.date = work_date;
END;
$$;

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

  IF eod_already_submitted THEN
    RAISE EXCEPTION 'Today''s work day has already ended';
  END IF;

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

  IF NOT worked_today THEN
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
        status = EXCLUDED.status;
  END IF;

  RETURN created_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_work_day(
  target_work_entry_id UUID,
  end_of_day_report TEXT
)
RETURNS public.work_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  work_date DATE := current_date;
  require_eod BOOLEAN := true;
  eod_already_submitted BOOLEAN := false;
  current_session public.work_entries;
  ended_session public.work_entries;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  PERFORM 1
  FROM public.employees employee
  WHERE employee.id = actor_employee_id
  FOR UPDATE;

  SELECT entry.*
  INTO current_session
  FROM public.work_entries entry
  WHERE entry.id = target_work_entry_id
    AND entry.employee_id = actor_employee_id
    AND entry.ended_at IS NULL
  FOR UPDATE;

  IF current_session.id IS NULL THEN
    RAISE EXCEPTION 'Open work session not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.break_entries break_entry
    WHERE break_entry.work_entry_id = current_session.id
      AND break_entry.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Resume from break before ending the work day';
  END IF;

  SELECT COALESCE(settings.eod_required, true)
  INTO require_eod
  FROM (SELECT 1) seed
  LEFT JOIN public.employee_work_settings settings
    ON settings.employee_id = actor_employee_id;

  SELECT report.eod_submitted_at IS NOT NULL
  INTO eod_already_submitted
  FROM public.daily_reports report
  WHERE report.employee_id = actor_employee_id
    AND report.date = work_date;

  eod_already_submitted := COALESCE(eod_already_submitted, false);

  IF NOT eod_already_submitted
    AND require_eod
    AND COALESCE(length(btrim(end_of_day_report)), 0) = 0
  THEN
    RAISE EXCEPTION 'End-of-day report is required before ending the work day';
  END IF;

  IF NOT eod_already_submitted
    AND COALESCE(length(btrim(end_of_day_report)), 0) > 0
  THEN
    INSERT INTO public.daily_reports (
      employee_id,
      date,
      eod_report
    )
    VALUES (
      actor_employee_id,
      work_date,
      btrim(end_of_day_report)
    )
    ON CONFLICT (employee_id, date) DO UPDATE
    SET eod_report = EXCLUDED.eod_report
    WHERE public.daily_reports.eod_submitted_at IS NULL;
  END IF;

  SELECT *
  INTO ended_session
  FROM public.end_work_session(current_session.id);

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
    current_session.started_at::time,
    ended_session.ended_at::time,
    CASE
      WHEN current_session.started_at::time >= TIME '10:30' THEN 'Late'
      ELSE 'Present'
    END
  )
  ON CONFLICT (employee_id, date) DO UPDATE
  SET check_out = EXCLUDED.check_out;

  RETURN ended_session;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_work_session(UUID, UUID, TEXT)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.end_work_session(UUID)
  FROM authenticated;

REVOKE ALL ON FUNCTION public.current_work_day_requirements()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_work_day(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_work_day(UUID, TEXT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_work_day_requirements()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_work_day(UUID, UUID, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_work_day(UUID, TEXT)
  TO authenticated;

COMMIT;
