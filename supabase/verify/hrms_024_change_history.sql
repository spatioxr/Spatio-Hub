-- HRMS-024 rollback-only change-history verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_024_superadmin AS
SELECT id AS employee_id, auth_id
FROM public.employees
WHERE role = 'superadmin'
  AND status = 'Active'
  AND auth_id IS NOT NULL
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hrms_024_superadmin) THEN
    RAISE EXCEPTION 'An Auth-linked active superadmin is required';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_024_actors AS
WITH auth_actor AS (
  INSERT INTO auth.users (id, email)
  VALUES
    (gen_random_uuid(), 'hrms-024-admin@example.invalid'),
    (gen_random_uuid(), 'hrms-024-manager@example.invalid'),
    (gen_random_uuid(), 'hrms-024-employee@example.invalid'),
    (gen_random_uuid(), 'hrms-024-outside@example.invalid')
  RETURNING id, email
),
employee_actor AS (
  INSERT INTO public.employees (
    auth_id,
    emp_code,
    name,
    email,
    role,
    status
  )
  SELECT
    auth_actor.id,
    CASE auth_actor.email
      WHEN 'hrms-024-admin@example.invalid' THEN 'HRMS024ADMIN'
      WHEN 'hrms-024-manager@example.invalid' THEN 'HRMS024MANAGER'
      WHEN 'hrms-024-employee@example.invalid' THEN 'HRMS024EMPLOYEE'
      ELSE 'HRMS024OUTSIDE'
    END,
    CASE auth_actor.email
      WHEN 'hrms-024-admin@example.invalid' THEN 'HRMS-024 Admin'
      WHEN 'hrms-024-manager@example.invalid' THEN 'HRMS-024 Manager'
      WHEN 'hrms-024-employee@example.invalid' THEN 'HRMS-024 Employee'
      ELSE 'HRMS-024 Outside Employee'
    END,
    auth_actor.email,
    CASE auth_actor.email
      WHEN 'hrms-024-admin@example.invalid' THEN 'admin'
      WHEN 'hrms-024-manager@example.invalid' THEN 'manager'
      ELSE 'employee'
    END,
    'Active'
  FROM auth_actor
  RETURNING id AS employee_id, auth_id, role, emp_code
)
SELECT *
FROM employee_actor;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::TEXT,
    'role', 'authenticated'
  )::TEXT,
  true
)
FROM hrms_024_superadmin actor;

CREATE TEMP TABLE hrms_024_project AS
SELECT project.*
FROM hrms_024_actors manager
CROSS JOIN LATERAL public.create_project_with_manager(
  'HRMS024VERIFY',
  'HRMS-024 Verification Project',
  'Rollback-only change-history verification.',
  manager.employee_id
) AS project
WHERE manager.role = 'manager';

CREATE TEMP TABLE hrms_024_member_assignment AS
SELECT assignment.*
FROM hrms_024_project project
CROSS JOIN hrms_024_actors employee
CROSS JOIN LATERAL public.assign_project_member(
  project.id,
  employee.employee_id
) AS assignment
WHERE employee.emp_code = 'HRMS024EMPLOYEE';

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::TEXT,
    'role', 'authenticated'
  )::TEXT,
  true
)
FROM hrms_024_actors actor
WHERE actor.role = 'admin';

CREATE TEMP TABLE hrms_024_member_entry AS
SELECT created.*
FROM hrms_024_actors employee
CROSS JOIN hrms_024_project project
CROSS JOIN LATERAL public.create_manual_time_entry(
  employee.employee_id,
  project.id,
  NULL,
  'Initial project task.',
  TIMESTAMPTZ '2099-03-10 09:00:00+00',
  TIMESTAMPTZ '2099-03-10 11:00:00+00',
  jsonb_build_array(
    jsonb_build_object(
      'started_at', '2099-03-10T10:00:00+00',
      'ended_at', '2099-03-10T10:10:00+00'
    )
  ),
  'Add the verified project entry.'
) AS created
WHERE employee.emp_code = 'HRMS024EMPLOYEE';

CREATE TEMP TABLE hrms_024_corrected_entry AS
SELECT corrected.*
FROM hrms_024_member_entry entry
CROSS JOIN public.activities activity
CROSS JOIN LATERAL public.correct_manual_time_entry(
  entry.id,
  NULL,
  activity.id,
  'Corrected activity task.',
  TIMESTAMPTZ '2099-03-10 08:45:00+00',
  TIMESTAMPTZ '2099-03-10 11:15:00+00',
  jsonb_build_array(
    jsonb_build_object(
      'started_at', '2099-03-10T09:45:00+00',
      'ended_at', '2099-03-10T10:00:00+00'
    )
  ),
  'Correct context, task, range, and break.'
) AS corrected
WHERE activity.name = 'Estimation'
  AND activity.archived_at IS NULL;

CREATE TEMP TABLE hrms_024_outside_entry AS
SELECT created.*
FROM hrms_024_actors employee
CROSS JOIN public.activities activity
CROSS JOIN LATERAL public.create_manual_time_entry(
  employee.employee_id,
  NULL,
  activity.id,
  'Outside organisation task.',
  TIMESTAMPTZ '2099-03-11 09:00:00+00',
  TIMESTAMPTZ '2099-03-11 10:00:00+00',
  '[]'::JSONB,
  'Add the outside-scope entry.'
) AS created
WHERE employee.emp_code = 'HRMS024OUTSIDE'
  AND activity.name = 'Pre-sales'
  AND activity.archived_at IS NULL;

CREATE TEMP TABLE hrms_024_admin_history AS
SELECT history.*
FROM hrms_024_member_entry entry
CROSS JOIN LATERAL public.work_entry_change_history(entry.id) history;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::TEXT,
    'role', 'authenticated'
  )::TEXT,
  true
)
FROM hrms_024_superadmin actor;

CREATE TEMP TABLE hrms_024_superadmin_history AS
SELECT history.*
FROM hrms_024_outside_entry entry
CROSS JOIN LATERAL public.work_entry_change_history(entry.id) history;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::TEXT,
    'role', 'authenticated'
  )::TEXT,
  true
)
FROM hrms_024_actors actor
WHERE actor.role = 'manager';

CREATE TEMP TABLE hrms_024_manager_history AS
SELECT history.*
FROM hrms_024_member_entry entry
CROSS JOIN LATERAL public.work_entry_change_history(entry.id) history;

CREATE TEMP TABLE hrms_024_guards (
  manager_outside_denied BOOLEAN NOT NULL DEFAULT false,
  employee_outside_denied BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO hrms_024_guards DEFAULT VALUES;

DO $$
DECLARE
  outside_entry_id UUID;
BEGIN
  SELECT id INTO outside_entry_id FROM hrms_024_outside_entry;
  BEGIN
    PERFORM * FROM public.work_entry_change_history(outside_entry_id);
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE hrms_024_guards SET manager_outside_denied = true;
  END;
END
$$;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::TEXT,
    'role', 'authenticated'
  )::TEXT,
  true
)
FROM hrms_024_actors actor
WHERE actor.emp_code = 'HRMS024EMPLOYEE';

CREATE TEMP TABLE hrms_024_employee_history AS
SELECT history.*
FROM hrms_024_member_entry entry
CROSS JOIN LATERAL public.work_entry_change_history(entry.id) history;

DO $$
DECLARE
  outside_entry_id UUID;
BEGIN
  SELECT id INTO outside_entry_id FROM hrms_024_outside_entry;
  BEGIN
    PERFORM * FROM public.work_entry_change_history(outside_entry_id);
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE hrms_024_guards SET employee_outside_denied = true;
  END;
END
$$;

CREATE TEMP TABLE hrms_024_results AS
SELECT
  (
    SELECT count(*) = 2
      AND bool_and(editor_name = 'HRMS-024 Admin')
      AND bool_and(editor_code = 'HRMS024ADMIN')
      AND bool_and(change_reason <> '')
      AND bool_and(changed_at IS NOT NULL)
    FROM hrms_024_admin_history
  ) AS editor_timestamp_and_reason_visible,
  EXISTS (
    SELECT 1
    FROM hrms_024_admin_history
    WHERE change_kind = 'created'
      AND old_record ->> 'context_type' IS NULL
      AND new_record ->> 'context_type' = 'project'
      AND new_record ->> 'context_label' =
        'HRMS024VERIFY · HRMS-024 Verification Project'
      AND new_record ? 'breaks'
  ) AS creation_snapshot_is_readable,
  EXISTS (
    SELECT 1
    FROM hrms_024_admin_history
    WHERE change_kind = 'corrected'
      AND old_record ->> 'task_description' = 'Initial project task.'
      AND old_record ->> 'context_type' = 'project'
      AND new_record ->> 'task_description' = 'Corrected activity task.'
      AND new_record ->> 'context_type' = 'activity'
      AND new_record ->> 'context_label' = 'Estimation'
      AND old_record ? 'breaks'
      AND new_record ? 'breaks'
  ) AS correction_before_and_after_visible,
  (SELECT count(*) = 1 FROM hrms_024_superadmin_history)
    AS superadmin_organisation_history_allowed,
  (SELECT count(*) = 2 FROM hrms_024_manager_history)
    AS manager_assigned_team_history_allowed,
  guards.manager_outside_denied
    AS manager_outside_scope_history_denied,
  (SELECT count(*) = 2 FROM hrms_024_employee_history)
    AS employee_own_history_allowed,
  guards.employee_outside_denied
    AS employee_other_history_denied,
  to_regprocedure(
    'public.work_entry_change_history(uuid)'
  ) IS NOT NULL
    AND NOT has_function_privilege(
      'anon',
      'public.work_entry_change_history(uuid)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.work_entry_change_history(uuid)',
      'EXECUTE'
    ) AS history_rpc_execution_restricted,
  NOT has_table_privilege(
    'authenticated',
    'public.work_entry_audit',
    'INSERT'
  )
    AND NOT has_table_privilege(
      'authenticated',
      'public.work_entry_audit',
      'UPDATE'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'public.work_entry_audit',
      'DELETE'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = 'public.work_entry_audit'::regclass
        AND tgname = 'work_entry_audit_prevent_mutation'
        AND NOT tgisinternal
    ) AS history_remains_immutable
FROM hrms_024_guards guards;

SELECT
  (
    SELECT bool_and(check_value::BOOLEAN)
    FROM hrms_024_results result
    CROSS JOIN LATERAL jsonb_each_text(to_jsonb(result)) check_item(
      check_name,
      check_value
    )
  ) AS all_checks_pass,
  to_jsonb(result) AS checks
FROM hrms_024_results result;

ROLLBACK;
