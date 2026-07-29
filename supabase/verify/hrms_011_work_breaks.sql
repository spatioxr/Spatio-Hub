-- HRMS-011 rollback-only behavioural verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_011_actor AS
SELECT id AS employee_id, auth_id
FROM public.employees
WHERE role = 'superadmin'
  AND status = 'Active'
LIMIT 1;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_011_actor actor;

CREATE TEMP TABLE hrms_011_session AS
SELECT session.*
FROM public.activities activity
CROSS JOIN LATERAL public.start_work_session(
  NULL,
  activity.id,
  'Verify a simple break against an active work session.'
) AS session
WHERE activity.name = 'Pre-sales'
  AND activity.archived_at IS NULL;

CREATE TEMP TABLE hrms_011_break AS
SELECT * FROM public.start_work_break();

DO $$
DECLARE
  work_entry_id UUID;
  duplicate_start_blocked BOOLEAN := false;
  end_while_break_blocked BOOLEAN := false;
BEGIN
  SELECT id INTO work_entry_id FROM hrms_011_session;

  BEGIN
    PERFORM public.start_work_break();
  EXCEPTION
    WHEN OTHERS THEN
      duplicate_start_blocked := true;
  END;

  BEGIN
    PERFORM public.end_work_session(work_entry_id);
  EXCEPTION
    WHEN OTHERS THEN
      end_while_break_blocked := true;
  END;

  IF NOT duplicate_start_blocked OR NOT end_while_break_blocked THEN
    RAISE EXCEPTION 'Active-break transition guards failed';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_011_current_break AS
SELECT * FROM public.current_work_break();

SELECT pg_sleep(0.02);

CREATE TEMP TABLE hrms_011_resumed_break AS
SELECT * FROM public.resume_work_session();

DO $$
DECLARE
  repeated_resume_blocked BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.resume_work_session();
  EXCEPTION
    WHEN OTHERS THEN
      repeated_resume_blocked := true;
  END;

  IF NOT repeated_resume_blocked THEN
    RAISE EXCEPTION 'Repeated resume was not blocked';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_011_ended_session AS
SELECT ended.*
FROM hrms_011_session session
CROSS JOIN LATERAL public.end_work_session(session.id) AS ended;

DO $$
DECLARE
  break_without_work_blocked BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.start_work_break();
  EXCEPTION
    WHEN OTHERS THEN
      break_without_work_blocked := true;
  END;

  IF NOT break_without_work_blocked THEN
    RAISE EXCEPTION 'A break started without an active work session';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_011_results AS
SELECT
  started_break.work_entry_id = session.id
    AS break_linked_to_active_session,
  current_break.id = started_break.id
    AS current_break_restored,
  resumed_break.id = started_break.id
    AND resumed_break.ended_at IS NOT NULL
    AS resume_closed_break,
  NOT EXISTS (
    SELECT 1
    FROM public.current_work_break()
  ) AS no_break_after_resume,
  ended_session.ended_at IS NOT NULL
    AS session_ended_after_resume,
  public.work_entry_worked_seconds(session.id)
    < EXTRACT(
      EPOCH FROM (ended_session.ended_at - session.started_at)
    ) AS break_excluded_from_worked_time,
  public.work_entry_worked_seconds(session.id) >= 0
    AS worked_time_non_negative,
  (
    SELECT count(*) = 4
    FROM pg_proc
    WHERE oid IN (
      to_regprocedure('public.start_work_break()'),
      to_regprocedure('public.current_work_break()'),
      to_regprocedure('public.resume_work_session()'),
      to_regprocedure('public.work_entry_worked_seconds(uuid)')
    )
  ) AS break_rpcs_exist,
  NOT has_table_privilege(
    'authenticated',
    'public.break_entries',
    'INSERT'
  )
    AND NOT has_table_privilege(
      'authenticated',
      'public.break_entries',
      'UPDATE'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'public.break_entries',
      'DELETE'
    ) AS direct_break_writes_denied,
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.break_entries'::regclass
      AND contype = 'x'
  ) AS overlap_guard_exists,
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'break_entries'
      AND column_name IN ('type', 'category', 'break_type')
  ) AS no_break_categories
FROM hrms_011_session session
CROSS JOIN hrms_011_break started_break
CROSS JOIN hrms_011_current_break current_break
CROSS JOIN hrms_011_resumed_break resumed_break
CROSS JOIN hrms_011_ended_session ended_session;

SELECT
  (
    SELECT bool_and(check_value::boolean)
    FROM hrms_011_results result
    CROSS JOIN LATERAL jsonb_each_text(to_jsonb(result)) check_item(
      check_name,
      check_value
    )
  ) AS all_checks_pass,
  to_jsonb(result) AS checks
FROM hrms_011_results result;

ROLLBACK;
