-- HRMS-018 rollback-only BOS/EOD work-day verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_018_actor AS
SELECT id AS employee_id, auth_id
FROM public.employees
WHERE role = 'superadmin'
  AND status = 'Active'
  AND auth_id IS NOT NULL
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hrms_018_actor) THEN
    RAISE EXCEPTION 'An Auth-linked active superadmin is required';
  END IF;
END
$$;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_018_actor actor;

DELETE FROM public.break_entries break_entry
USING public.work_entries entry, hrms_018_actor actor
WHERE break_entry.work_entry_id = entry.id
  AND entry.employee_id = actor.employee_id
  AND entry.started_at >= current_date::timestamptz
  AND entry.started_at < (current_date + 1)::timestamptz;

DELETE FROM public.work_entries entry
USING hrms_018_actor actor
WHERE entry.employee_id = actor.employee_id
  AND entry.started_at >= current_date::timestamptz
  AND entry.started_at < (current_date + 1)::timestamptz;

DELETE FROM public.daily_reports report
USING hrms_018_actor actor
WHERE report.employee_id = actor.employee_id
  AND report.date = current_date;

DELETE FROM public.attendance attendance
USING hrms_018_actor actor
WHERE attendance.employee_id = actor.employee_id
  AND attendance.date = current_date;

UPDATE public.employee_work_settings settings
SET bos_required = true,
    eod_required = true
FROM hrms_018_actor actor
WHERE settings.employee_id = actor.employee_id;

CREATE TEMP TABLE hrms_018_guards (
  first_start_without_bos_blocked BOOLEAN NOT NULL DEFAULT false,
  end_without_eod_blocked BOOLEAN NOT NULL DEFAULT false,
  end_during_break_blocked BOOLEAN NOT NULL DEFAULT false,
  reopened_end_without_fresh_eod_blocked BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO hrms_018_guards DEFAULT VALUES;

DO $$
DECLARE
  activity_id UUID;
BEGIN
  SELECT id
  INTO activity_id
  FROM public.activities
  WHERE name = 'Pre-sales'
    AND archived_at IS NULL;

  BEGIN
    PERFORM public.start_work_day(
      NULL,
      activity_id,
      'BOS must be required on the first start.',
      NULL
    );
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE hrms_018_guards
      SET first_start_without_bos_blocked = true;
  END;
END
$$;

CREATE TEMP TABLE hrms_018_initial_state AS
SELECT * FROM public.current_work_day_requirements();

CREATE TEMP TABLE hrms_018_first_session AS
SELECT session.*
FROM public.activities activity
CROSS JOIN LATERAL public.start_work_day(
  NULL,
  activity.id,
  '  Verify first work start with BOS.  ',
  '  Plan and verify the HRMS-018 workflow.  '
) AS session
WHERE activity.name = 'Pre-sales'
  AND activity.archived_at IS NULL;

CREATE TEMP TABLE hrms_018_bos_snapshot AS
SELECT report.*
FROM public.daily_reports report
JOIN hrms_018_actor actor
  ON actor.employee_id = report.employee_id
WHERE report.date = current_date;

CREATE TEMP TABLE hrms_018_attendance_start AS
SELECT attendance.*
FROM public.attendance attendance
JOIN hrms_018_actor actor
  ON actor.employee_id = attendance.employee_id
WHERE attendance.date = current_date;

CREATE TEMP TABLE hrms_018_switched_session AS
SELECT switched.*
FROM public.activities activity
CROSS JOIN LATERAL public.switch_work_session(
  NULL,
  activity.id,
  'Switch without another BOS prompt.'
) AS switched
WHERE activity.name = 'Estimation'
  AND activity.archived_at IS NULL;

CREATE TEMP TABLE hrms_018_after_switch AS
SELECT
  (SELECT count(*)
   FROM public.daily_reports report
   JOIN hrms_018_actor actor
     ON actor.employee_id = report.employee_id
   WHERE report.date = current_date) AS report_count,
  (SELECT bos_submitted_at
   FROM public.daily_reports report
   JOIN hrms_018_actor actor
     ON actor.employee_id = report.employee_id
   WHERE report.date = current_date) AS bos_submitted_at;

DO $$
DECLARE
  work_entry_id UUID;
BEGIN
  SELECT id INTO work_entry_id FROM hrms_018_switched_session;

  BEGIN
    PERFORM public.end_work_day(work_entry_id, NULL);
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE hrms_018_guards
      SET end_without_eod_blocked = true;
  END;

  PERFORM public.start_work_break();

  BEGIN
    PERFORM public.end_work_day(
      work_entry_id,
      'A break must still block End Day.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE hrms_018_guards
      SET end_during_break_blocked = true;
  END;

  PERFORM public.resume_work_session();
END
$$;

CREATE TEMP TABLE hrms_018_ended_session AS
SELECT ended.*
FROM hrms_018_switched_session session
CROSS JOIN LATERAL public.end_work_day(
  session.id,
  '  Completed and verified the HRMS-018 workflow.  '
) AS ended;

CREATE TEMP TABLE hrms_018_completed_report AS
SELECT report.*
FROM public.daily_reports report
JOIN hrms_018_actor actor
  ON actor.employee_id = report.employee_id
WHERE report.date = current_date;

CREATE TEMP TABLE hrms_018_attendance_end AS
SELECT attendance.*
FROM public.attendance attendance
JOIN hrms_018_actor actor
  ON actor.employee_id = attendance.employee_id
WHERE attendance.date = current_date;

CREATE TEMP TABLE hrms_018_reopened_session AS
SELECT session.*
FROM public.activities activity
CROSS JOIN LATERAL public.start_work_day(
  NULL,
  activity.id,
  'Reopen after an early End Day.',
  NULL
) AS session
WHERE activity.name = 'Pre-sales'
  AND activity.archived_at IS NULL;

CREATE TEMP TABLE hrms_018_reopened_report AS
SELECT report.*
FROM public.daily_reports report
JOIN hrms_018_actor actor
  ON actor.employee_id = report.employee_id
WHERE report.date = current_date;

CREATE TEMP TABLE hrms_018_reopened_attendance AS
SELECT attendance.*
FROM public.attendance attendance
JOIN hrms_018_actor actor
  ON actor.employee_id = attendance.employee_id
WHERE attendance.date = current_date;

CREATE TEMP TABLE hrms_018_reopened_state AS
SELECT * FROM public.current_work_day_requirements();

DO $$
DECLARE
  work_entry_id UUID;
BEGIN
  SELECT id INTO work_entry_id FROM hrms_018_reopened_session;

  BEGIN
    PERFORM public.end_work_day(work_entry_id, NULL);
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE hrms_018_guards
      SET reopened_end_without_fresh_eod_blocked = true;
  END;
END
$$;

CREATE TEMP TABLE hrms_018_final_session AS
SELECT ended.*
FROM hrms_018_reopened_session session
CROSS JOIN LATERAL public.end_work_day(
  session.id,
  'Final summary after reopening the work day.'
) AS ended;

CREATE TEMP TABLE hrms_018_final_report AS
SELECT report.*
FROM public.daily_reports report
JOIN hrms_018_actor actor
  ON actor.employee_id = report.employee_id
WHERE report.date = current_date;

CREATE TEMP TABLE hrms_018_final_attendance AS
SELECT attendance.*
FROM public.attendance attendance
JOIN hrms_018_actor actor
  ON actor.employee_id = attendance.employee_id
WHERE attendance.date = current_date;

CREATE TEMP TABLE hrms_018_required_flow AS
SELECT
  initial_state.bos_required
    AND initial_state.eod_required
    AND NOT initial_state.bos_submitted
    AND NOT initial_state.eod_submitted
    AND NOT initial_state.has_work_today
    AS initial_requirements_clear,
  bos_snapshot.bos_report = 'Plan and verify the HRMS-018 workflow.'
    AND bos_snapshot.bos_submitted_at IS NOT NULL
    AS bos_submitted_on_first_start,
  attendance_start.check_in IS NOT NULL
    AND attendance_start.check_out IS NULL
    AS attendance_started_with_work,
  after_switch.report_count = 1
    AND after_switch.bos_submitted_at = bos_snapshot.bos_submitted_at
    AS switch_did_not_repeat_bos,
  ended_session.ended_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.current_work_session())
    AS final_session_ended,
  completed_report.eod_report =
    'Completed and verified the HRMS-018 workflow.'
    AND completed_report.eod_submitted_at IS NOT NULL
    AS eod_submitted_on_end_day,
  attendance_end.check_in = attendance_start.check_in
    AND attendance_end.check_out IS NOT NULL
    AS attendance_completed_with_end_day,
  reopened_session.ended_at IS NULL
    AND reopened_state.has_work_today
    AND reopened_state.bos_submitted
    AND NOT reopened_state.eod_submitted
    AS same_day_reopen_started,
  reopened_report.bos_report = bos_snapshot.bos_report
    AND reopened_report.bos_submitted_at = bos_snapshot.bos_submitted_at
    AND reopened_report.eod_report IS NULL
    AND reopened_report.eod_submitted_at IS NULL
    AS reopen_preserved_bos_and_cleared_eod,
  reopened_attendance.check_in = attendance_start.check_in
    AND reopened_attendance.check_out IS NULL
    AS reopen_preserved_check_in_and_cleared_check_out,
  final_session.ended_at IS NOT NULL
    AND final_report.eod_report =
      'Final summary after reopening the work day.'
    AND final_report.eod_submitted_at IS NOT NULL
    AS fresh_eod_closed_reopened_day,
  final_attendance.check_in = attendance_start.check_in
    AND final_attendance.check_out IS NOT NULL
    AS final_end_day_completed_attendance
FROM hrms_018_initial_state initial_state
CROSS JOIN hrms_018_bos_snapshot bos_snapshot
CROSS JOIN hrms_018_attendance_start attendance_start
CROSS JOIN hrms_018_after_switch after_switch
CROSS JOIN hrms_018_ended_session ended_session
CROSS JOIN hrms_018_completed_report completed_report
CROSS JOIN hrms_018_attendance_end attendance_end
CROSS JOIN hrms_018_reopened_session reopened_session
CROSS JOIN hrms_018_reopened_report reopened_report
CROSS JOIN hrms_018_reopened_attendance reopened_attendance
CROSS JOIN hrms_018_reopened_state reopened_state
CROSS JOIN hrms_018_final_session final_session
CROSS JOIN hrms_018_final_report final_report
CROSS JOIN hrms_018_final_attendance final_attendance;

DELETE FROM public.break_entries break_entry
USING public.work_entries entry, hrms_018_actor actor
WHERE break_entry.work_entry_id = entry.id
  AND entry.employee_id = actor.employee_id
  AND entry.started_at >= current_date::timestamptz
  AND entry.started_at < (current_date + 1)::timestamptz;

DELETE FROM public.work_entries entry
USING hrms_018_actor actor
WHERE entry.employee_id = actor.employee_id
  AND entry.started_at >= current_date::timestamptz
  AND entry.started_at < (current_date + 1)::timestamptz;

DELETE FROM public.daily_reports report
USING hrms_018_actor actor
WHERE report.employee_id = actor.employee_id
  AND report.date = current_date;

DELETE FROM public.attendance attendance
USING hrms_018_actor actor
WHERE attendance.employee_id = actor.employee_id
  AND attendance.date = current_date;

UPDATE public.employee_work_settings settings
SET bos_required = false,
    eod_required = false
FROM hrms_018_actor actor
WHERE settings.employee_id = actor.employee_id;

CREATE TEMP TABLE hrms_018_optional_session AS
SELECT session.*
FROM public.activities activity
CROSS JOIN LATERAL public.start_work_day(
  NULL,
  activity.id,
  'Verify exempt work-day start.',
  NULL
) AS session
WHERE activity.name = 'Pre-sales'
  AND activity.archived_at IS NULL;

CREATE TEMP TABLE hrms_018_optional_state AS
SELECT * FROM public.current_work_day_requirements();

CREATE TEMP TABLE hrms_018_optional_end AS
SELECT ended.*
FROM hrms_018_optional_session session
CROSS JOIN LATERAL public.end_work_day(session.id, NULL) AS ended;

CREATE TEMP TABLE hrms_018_optional_reopened_session AS
SELECT session.*
FROM public.activities activity
CROSS JOIN LATERAL public.start_work_day(
  NULL,
  activity.id,
  'Reopen an exempt work day.',
  NULL
) AS session
WHERE activity.name = 'Estimation'
  AND activity.archived_at IS NULL;

CREATE TEMP TABLE hrms_018_optional_reopened_attendance AS
SELECT attendance.*
FROM public.attendance attendance
JOIN hrms_018_actor actor
  ON actor.employee_id = attendance.employee_id
WHERE attendance.date = current_date;

CREATE TEMP TABLE hrms_018_optional_final_end AS
SELECT ended.*
FROM hrms_018_optional_reopened_session session
CROSS JOIN LATERAL public.end_work_day(session.id, NULL) AS ended;

CREATE TEMP TABLE hrms_018_results AS
SELECT
  guards.first_start_without_bos_blocked,
  guards.end_without_eod_blocked,
  guards.end_during_break_blocked,
  guards.reopened_end_without_fresh_eod_blocked,
  required_flow.initial_requirements_clear,
  required_flow.bos_submitted_on_first_start,
  required_flow.attendance_started_with_work,
  required_flow.switch_did_not_repeat_bos,
  required_flow.final_session_ended,
  required_flow.eod_submitted_on_end_day,
  required_flow.attendance_completed_with_end_day,
  required_flow.same_day_reopen_started,
  required_flow.reopen_preserved_bos_and_cleared_eod,
  required_flow.reopen_preserved_check_in_and_cleared_check_out,
  required_flow.fresh_eod_closed_reopened_day,
  required_flow.final_end_day_completed_attendance,
  NOT optional_state.bos_required
    AND NOT optional_state.eod_required
    AND optional_state.has_work_today
    AND optional_end.ended_at IS NOT NULL
    AS exempt_employee_can_start_and_end_without_reports,
  optional_reopened_session.ended_at IS NULL
    AND optional_reopened_attendance.check_out IS NULL
    AND optional_final_end.ended_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.daily_reports report
      JOIN hrms_018_actor actor
        ON actor.employee_id = report.employee_id
      WHERE report.date = current_date
    ) AS exempt_employee_can_reopen_without_reports,
  (
    SELECT count(*) = 3
    FROM pg_proc
    WHERE oid IN (
      to_regprocedure('public.current_work_day_requirements()'),
      to_regprocedure('public.start_work_day(uuid,uuid,text,text)'),
      to_regprocedure('public.end_work_day(uuid,text)')
    )
  ) AS work_day_rpcs_exist,
  has_function_privilege(
    'authenticated',
    'public.current_work_day_requirements()',
    'EXECUTE'
  )
    AND has_function_privilege(
      'authenticated',
      'public.start_work_day(uuid,uuid,text,text)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.end_work_day(uuid,text)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.start_work_session(uuid,uuid,text)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.end_work_session(uuid)',
      'EXECUTE'
    ) AS authenticated_uses_enforced_work_day_rpcs,
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'daily_reports'
      AND column_name LIKE '%session%'
  ) AS reports_remain_daily_not_per_session
FROM hrms_018_guards guards
CROSS JOIN hrms_018_required_flow required_flow
CROSS JOIN hrms_018_optional_state optional_state
CROSS JOIN hrms_018_optional_end optional_end
CROSS JOIN hrms_018_optional_reopened_session optional_reopened_session
CROSS JOIN hrms_018_optional_reopened_attendance optional_reopened_attendance
CROSS JOIN hrms_018_optional_final_end optional_final_end;

SELECT
  (
    SELECT bool_and(check_value::boolean)
    FROM hrms_018_results result
    CROSS JOIN LATERAL jsonb_each_text(to_jsonb(result)) check_item(
      check_name,
      check_value
    )
  ) AS all_checks_pass,
  to_jsonb(result) AS checks
FROM hrms_018_results result;

ROLLBACK;
