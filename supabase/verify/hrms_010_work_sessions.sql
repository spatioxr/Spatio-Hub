-- HRMS-010 rollback-only behavioural verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_010_actor AS
SELECT id AS employee_id, auth_id, department
FROM public.employees
WHERE role = 'superadmin'
  AND status = 'Active'
  AND auth_id IS NOT NULL
LIMIT 1;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_010_actor actor;

CREATE TEMP TABLE hrms_010_project AS
SELECT project.*
FROM hrms_010_actor actor
CROSS JOIN LATERAL public.create_project_with_manager(
  'HRMS010VERIFY',
  'HRMS-010 Verification Project',
  'Rollback-only work-session verification.',
  actor.employee_id
) AS project;

CREATE TEMP TABLE hrms_010_activity_session AS
SELECT session.*
FROM public.activities activity
CROSS JOIN LATERAL public.start_work_session(
  NULL,
  activity.id,
  '  Verify an activity-backed work session.  '
) AS session
WHERE activity.name = 'Pre-sales'
  AND activity.archived_at IS NULL;

DO $$
DECLARE
  activity_id UUID;
  second_open_session_blocked BOOLEAN := false;
BEGIN
  SELECT id INTO activity_id
  FROM public.activities
  WHERE name = 'Estimation'
    AND archived_at IS NULL;

  BEGIN
    PERFORM public.start_work_session(
      NULL,
      activity_id,
      'This second open session must be rejected.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      second_open_session_blocked := true;
  END;

  IF NOT second_open_session_blocked THEN
    RAISE EXCEPTION 'A second overlapping open session was not blocked';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_010_current_activity AS
SELECT * FROM public.current_work_session();

CREATE TEMP TABLE hrms_010_ended_activity AS
SELECT ended.*
FROM hrms_010_activity_session session
CROSS JOIN LATERAL public.end_work_session(session.id) AS ended;

CREATE TEMP TABLE hrms_010_project_session AS
SELECT session.*
FROM hrms_010_project project
CROSS JOIN LATERAL public.start_work_session(
  project.id,
  NULL,
  'Verify a project-backed work session.'
) AS session;

CREATE TEMP TABLE hrms_010_current_project AS
SELECT * FROM public.current_work_session();

CREATE TEMP TABLE hrms_010_ended_project AS
SELECT ended.*
FROM hrms_010_project_session session
CROSS JOIN LATERAL public.end_work_session(session.id) AS ended;

DO $$
DECLARE
  project_id UUID;
  activity_id UUID;
  both_targets_blocked BOOLEAN := false;
  no_target_blocked BOOLEAN := false;
BEGIN
  SELECT id INTO project_id FROM hrms_010_project;
  SELECT id INTO activity_id
  FROM public.activities
  WHERE name = 'Estimation'
    AND archived_at IS NULL;

  BEGIN
    PERFORM public.start_work_session(
      project_id,
      activity_id,
      'Both targets must be rejected.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      both_targets_blocked := true;
  END;

  BEGIN
    PERFORM public.start_work_session(
      NULL,
      NULL,
      'No target must be rejected.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      no_target_blocked := true;
  END;

  IF NOT both_targets_blocked OR NOT no_target_blocked THEN
    RAISE EXCEPTION 'Exactly-one project/activity enforcement failed';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_010_results AS
SELECT
  activity_session.project_id IS NULL
    AND activity_session.activity_id IS NOT NULL
    AS activity_session_has_one_target,
  project_session.project_id IS NOT NULL
    AND project_session.activity_id IS NULL
    AS project_session_has_one_target,
  activity_session.task_description =
    'Verify an activity-backed work session.'
    AS task_description_normalised,
  current_activity.id = activity_session.id
    AS current_activity_restored,
  current_project.id = project_session.id
    AS current_project_restored,
  ended_activity.ended_at IS NOT NULL
    AND ended_project.ended_at IS NOT NULL
    AS sessions_ended,
  project_session.started_at >= ended_activity.ended_at
    AS sessions_ordered,
  NOT EXISTS (
    SELECT 1
    FROM public.current_work_session()
  ) AS no_open_session_after_end,
  employee.department IS NOT DISTINCT FROM actor.department
    AS department_derivable_from_employee,
  (
    SELECT count(*) = 3
    FROM pg_proc
    WHERE oid IN (
      to_regprocedure('public.start_work_session(uuid,uuid,text)'),
      to_regprocedure('public.current_work_session()'),
      to_regprocedure('public.end_work_session(uuid)')
    )
  ) AS session_rpcs_exist,
  NOT has_table_privilege(
    'authenticated',
    'public.work_entries',
    'INSERT'
  )
    AND NOT has_table_privilege(
      'authenticated',
      'public.work_entries',
      'UPDATE'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'public.work_entries',
      'DELETE'
    ) AS direct_session_writes_denied,
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.work_entries'::regclass
      AND contype = 'x'
  ) AS overlap_guard_exists
FROM hrms_010_activity_session activity_session
CROSS JOIN hrms_010_current_activity current_activity
CROSS JOIN hrms_010_ended_activity ended_activity
CROSS JOIN hrms_010_project_session project_session
CROSS JOIN hrms_010_current_project current_project
CROSS JOIN hrms_010_ended_project ended_project
CROSS JOIN hrms_010_actor actor
JOIN public.employees employee
  ON employee.id = actor.employee_id;

SELECT
  (
    SELECT bool_and(check_value::boolean)
    FROM hrms_010_results result
    CROSS JOIN LATERAL jsonb_each_text(to_jsonb(result)) check_item(
      check_name,
      check_value
    )
  ) AS all_checks_pass,
  to_jsonb(result) AS checks
FROM hrms_010_results result;

ROLLBACK;
