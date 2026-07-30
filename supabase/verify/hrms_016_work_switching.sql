-- HRMS-016 rollback-only behavioural verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_016_actor AS
SELECT id AS employee_id, auth_id
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
FROM hrms_016_actor actor;

CREATE TEMP TABLE hrms_016_project AS
SELECT project.*
FROM hrms_016_actor actor
CROSS JOIN LATERAL public.create_project_with_manager(
  'HRMS016VERIFY',
  'HRMS-016 Verification Project',
  'Rollback-only atomic work-switch verification.',
  actor.employee_id
) AS project;

CREATE TEMP TABLE hrms_016_initial_session AS
SELECT session.*
FROM public.activities activity
CROSS JOIN LATERAL public.start_work_session(
  NULL,
  activity.id,
  'Initial activity work.'
) AS session
WHERE activity.name = 'Pre-sales'
  AND activity.archived_at IS NULL;

SELECT pg_sleep(0.02);

CREATE TEMP TABLE hrms_016_project_session AS
SELECT switched.*
FROM hrms_016_project project
CROSS JOIN LATERAL public.switch_work_session(
  project.id,
  NULL,
  '  Switched project work.  '
) AS switched;

CREATE TEMP TABLE hrms_016_current_project AS
SELECT * FROM public.current_work_session();

DO $$
DECLARE
  project_id UUID;
  activity_id UUID;
  same_context_blocked BOOLEAN := false;
  both_targets_blocked BOOLEAN := false;
  blank_task_blocked BOOLEAN := false;
BEGIN
  SELECT id INTO project_id FROM hrms_016_project;
  SELECT id INTO activity_id
  FROM public.activities
  WHERE name = 'Estimation'
    AND archived_at IS NULL;

  BEGIN
    PERFORM public.switch_work_session(
      project_id,
      NULL,
      'A same-context switch must be rejected.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      same_context_blocked := true;
  END;

  BEGIN
    PERFORM public.switch_work_session(
      project_id,
      activity_id,
      'Both targets must be rejected.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      both_targets_blocked := true;
  END;

  BEGIN
    PERFORM public.switch_work_session(
      NULL,
      activity_id,
      '   '
    );
  EXCEPTION
    WHEN OTHERS THEN
      blank_task_blocked := true;
  END;

  IF NOT same_context_blocked
    OR NOT both_targets_blocked
    OR NOT blank_task_blocked
  THEN
    RAISE EXCEPTION 'Switch input enforcement failed';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_016_break AS
SELECT * FROM public.start_work_break();

DO $$
DECLARE
  activity_id UUID;
  switch_during_break_blocked BOOLEAN := false;
BEGIN
  SELECT id INTO activity_id
  FROM public.activities
  WHERE name = 'Estimation'
    AND archived_at IS NULL;

  BEGIN
    PERFORM public.switch_work_session(
      NULL,
      activity_id,
      'Switching during a break must be rejected.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      switch_during_break_blocked := true;
  END;

  IF NOT switch_during_break_blocked THEN
    RAISE EXCEPTION 'An active break did not block switching';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_016_resumed_break AS
SELECT * FROM public.resume_work_session();

SELECT pg_sleep(0.02);

CREATE TEMP TABLE hrms_016_activity_session AS
SELECT switched.*
FROM public.activities activity
CROSS JOIN LATERAL public.switch_work_session(
  NULL,
  activity.id,
  'Switched activity work.'
) AS switched
WHERE activity.name = 'Estimation'
  AND activity.archived_at IS NULL;

CREATE TEMP TABLE hrms_016_initial_closed AS
SELECT entry.*
FROM public.work_entries entry
JOIN hrms_016_initial_session initial_session
  ON initial_session.id = entry.id;

CREATE TEMP TABLE hrms_016_project_closed AS
SELECT entry.*
FROM public.work_entries entry
JOIN hrms_016_project_session project_session
  ON project_session.id = entry.id;

CREATE TEMP TABLE hrms_016_current_activity AS
SELECT * FROM public.current_work_session();

CREATE TEMP TABLE hrms_016_ended_activity AS
SELECT ended.*
FROM hrms_016_activity_session activity_session
CROSS JOIN LATERAL public.end_work_session(activity_session.id) AS ended;

CREATE TEMP TABLE hrms_016_results AS
SELECT
  initial_closed.ended_at = project_session.started_at
    AS activity_to_project_boundary_is_atomic,
  project_closed.ended_at = activity_session.started_at
    AS project_to_activity_boundary_is_atomic,
  initial_closed.id <> project_session.id
    AND project_session.id <> activity_session.id
    AND initial_closed.id <> activity_session.id
    AS switches_create_separate_entries,
  current_project.id = project_session.id
    AS current_project_restored,
  current_activity.id = activity_session.id
    AS current_activity_restored,
  project_session.project_id IS NOT NULL
    AND project_session.activity_id IS NULL
    AND activity_session.project_id IS NULL
    AND activity_session.activity_id IS NOT NULL
    AS switched_targets_have_exactly_one_context,
  project_session.task_description = 'Switched project work.'
    AS switched_task_normalised,
  resumed_break.id = started_break.id
    AND resumed_break.ended_at IS NOT NULL
    AS break_resumed_before_switch,
  public.work_entry_worked_seconds(project_closed.id)
    < EXTRACT(
      EPOCH FROM (project_closed.ended_at - project_closed.started_at)
    ) AS break_excluded_from_closed_session_total,
  ended_activity.ended_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.current_work_session()
    ) AS no_open_session_after_final_end,
  to_regprocedure(
    'public.switch_work_session(uuid,uuid,text)'
  ) IS NOT NULL
    AND has_function_privilege(
      'authenticated',
      'public.switch_work_session(uuid,uuid,text)',
      'EXECUTE'
    ) AS switch_rpc_available_to_authenticated,
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
    ) AS direct_work_entry_writes_remain_denied
FROM hrms_016_initial_closed initial_closed
CROSS JOIN hrms_016_project_session project_session
CROSS JOIN hrms_016_current_project current_project
CROSS JOIN hrms_016_break started_break
CROSS JOIN hrms_016_resumed_break resumed_break
CROSS JOIN hrms_016_project_closed project_closed
CROSS JOIN hrms_016_activity_session activity_session
CROSS JOIN hrms_016_current_activity current_activity
CROSS JOIN hrms_016_ended_activity ended_activity;

SELECT
  (
    SELECT bool_and(check_value::boolean)
    FROM hrms_016_results result
    CROSS JOIN LATERAL jsonb_each_text(to_jsonb(result)) check_item(
      check_name,
      check_value
    )
  ) AS all_checks_pass,
  to_jsonb(result) AS checks
FROM hrms_016_results result;

ROLLBACK;
