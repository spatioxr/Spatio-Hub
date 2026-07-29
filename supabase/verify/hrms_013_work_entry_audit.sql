-- HRMS-013 rollback-only behavioural verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_013_actor AS
SELECT id AS employee_id, auth_id
FROM public.employees
WHERE role = 'superadmin'
  AND status = 'Active'
  AND auth_id IS NOT NULL
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hrms_013_actor) THEN
    RAISE EXCEPTION 'An Auth-linked active superadmin is required';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_013_employee_actor AS
WITH inserted_auth_user AS (
  INSERT INTO auth.users (
    id,
    email
  )
  VALUES (
    gen_random_uuid(),
    'hrms-013-employee-actor@example.invalid'
  )
  RETURNING id
),
inserted_employee AS (
  INSERT INTO public.employees (
    auth_id,
    emp_code,
    name,
    email,
    role,
    status
  )
  SELECT
    auth_user.id,
    'HRMS013ACTOR',
    'HRMS-013 Employee Actor',
    'hrms-013-employee-actor@example.invalid',
    'employee',
    'Active'
  FROM inserted_auth_user auth_user
  RETURNING id AS employee_id, auth_id
)
SELECT *
FROM inserted_employee;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_013_actor actor;

CREATE TEMP TABLE hrms_013_employees AS
WITH inserted_employee AS (
  INSERT INTO public.employees (
    emp_code,
    name,
    email,
    role,
    status
  )
  VALUES
    (
      'HRMS013MEMBER',
      'HRMS-013 Project Member',
      'hrms-013-member@example.invalid',
      'employee',
      'Active'
    ),
    (
      'HRMS013OUTSIDE',
      'HRMS-013 Outside Employee',
      'hrms-013-outside@example.invalid',
      'employee',
      'Active'
    )
  RETURNING id, emp_code
)
SELECT *
FROM inserted_employee;

CREATE TEMP TABLE hrms_013_project AS
SELECT project.*
FROM hrms_013_actor actor
CROSS JOIN LATERAL public.create_project_with_manager(
  'HRMS013VERIFY',
  'HRMS-013 Verification Project',
  'Rollback-only correction audit verification.',
  actor.employee_id
) AS project;

CREATE TEMP TABLE hrms_013_member_assignment AS
SELECT assignment.*
FROM hrms_013_project project
CROSS JOIN hrms_013_employees employee
CROSS JOIN LATERAL public.assign_project_member(
  project.id,
  employee.id
) AS assignment
WHERE employee.emp_code = 'HRMS013MEMBER';

CREATE TEMP TABLE hrms_013_created_entry AS
SELECT created.*
FROM hrms_013_project project
CROSS JOIN hrms_013_employees employee
CROSS JOIN LATERAL public.create_manual_work_entry(
  employee.id,
  project.id,
  NULL,
  '  Initial manually added work.  ',
  TIMESTAMPTZ '2099-01-10 09:00:00+00',
  TIMESTAMPTZ '2099-01-10 10:00:00+00',
  '  Add a verified historical entry.  '
) AS created
WHERE employee.emp_code = 'HRMS013MEMBER';

CREATE TEMP TABLE hrms_013_created_audit AS
SELECT audit.*
FROM public.work_entry_audit audit
JOIN hrms_013_created_entry entry
  ON entry.id = audit.work_entry_id;

CREATE TEMP TABLE hrms_013_corrected_entry AS
SELECT corrected.*
FROM hrms_013_created_entry entry
CROSS JOIN LATERAL public.correct_work_entry(
  entry.id,
  entry.project_id,
  NULL,
  'Corrected manually added work.',
  entry.started_at,
  entry.ended_at + INTERVAL '30 minutes',
  '  Correct the task and end time.  '
) AS corrected;

CREATE TEMP TABLE hrms_013_correction_audit AS
SELECT audit.*
FROM public.work_entry_audit audit
JOIN hrms_013_created_entry entry
  ON entry.id = audit.work_entry_id
WHERE audit.old_record <> '{}'::jsonb;

DO $$
DECLARE
  audit_id UUID;
  entry_id UUID;
  immutable_update_blocked BOOLEAN := false;
  immutable_delete_blocked BOOLEAN := false;
  blank_reason_blocked BOOLEAN := false;
  no_change_blocked BOOLEAN := false;
BEGIN
  SELECT id INTO audit_id FROM hrms_013_created_audit;
  SELECT id INTO entry_id FROM hrms_013_corrected_entry;

  BEGIN
    UPDATE public.work_entry_audit
    SET change_reason = 'Tampered'
    WHERE id = audit_id;
  EXCEPTION
    WHEN OTHERS THEN
      immutable_update_blocked := true;
  END;

  BEGIN
    DELETE FROM public.work_entry_audit
    WHERE id = audit_id;
  EXCEPTION
    WHEN OTHERS THEN
      immutable_delete_blocked := true;
  END;

  BEGIN
    PERFORM public.correct_work_entry(
      entry_id,
      (SELECT project_id FROM hrms_013_corrected_entry),
      NULL,
      'Another task value.',
      (SELECT started_at FROM hrms_013_corrected_entry),
      (SELECT ended_at FROM hrms_013_corrected_entry),
      '   '
    );
  EXCEPTION
    WHEN OTHERS THEN
      blank_reason_blocked := true;
  END;

  BEGIN
    PERFORM public.correct_work_entry(
      entry_id,
      (SELECT project_id FROM hrms_013_corrected_entry),
      NULL,
      (SELECT task_description FROM hrms_013_corrected_entry),
      (SELECT started_at FROM hrms_013_corrected_entry),
      (SELECT ended_at FROM hrms_013_corrected_entry),
      'A reason cannot make a no-op valid.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      no_change_blocked := true;
  END;

  IF NOT immutable_update_blocked
    OR NOT immutable_delete_blocked
    OR NOT blank_reason_blocked
    OR NOT no_change_blocked
  THEN
    RAISE EXCEPTION 'Audit immutability or correction validation failed';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_013_outside_entry AS
SELECT created.*
FROM public.activities activity
CROSS JOIN hrms_013_employees employee
CROSS JOIN LATERAL public.create_manual_work_entry(
  employee.id,
  NULL,
  activity.id,
  'Outside employee activity entry.',
  TIMESTAMPTZ '2099-01-11 09:00:00+00',
  TIMESTAMPTZ '2099-01-11 10:00:00+00',
  'Create an out-of-scope verification entry.'
) AS created
WHERE employee.emp_code = 'HRMS013OUTSIDE'
  AND activity.name = 'Estimation'
  AND activity.archived_at IS NULL;

ALTER TABLE public.employees
  DISABLE TRIGGER guard_employee_self_update;
UPDATE public.employees
SET role = 'manager'
WHERE id = (SELECT employee_id FROM hrms_013_actor);
ALTER TABLE public.employees
  ENABLE TRIGGER guard_employee_self_update;

CREATE TEMP TABLE hrms_013_manager_correction AS
SELECT corrected.*
FROM hrms_013_corrected_entry entry
CROSS JOIN LATERAL public.correct_work_entry(
  entry.id,
  entry.project_id,
  NULL,
  'Manager-scoped corrected work.',
  entry.started_at,
  entry.ended_at,
  'Manager correction within an owned project.'
) AS corrected;

DO $$
DECLARE
  outside_entry public.work_entries;
  outside_scope_blocked BOOLEAN := false;
BEGIN
  SELECT * INTO outside_entry FROM hrms_013_outside_entry;

  BEGIN
    PERFORM public.correct_work_entry(
      outside_entry.id,
      NULL,
      outside_entry.activity_id,
      'Manager must not change this entry.',
      outside_entry.started_at,
      outside_entry.ended_at,
      'This manager does not own the outside employee scope.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      outside_scope_blocked := true;
  END;

  IF NOT outside_scope_blocked THEN
    RAISE EXCEPTION 'Manager corrected an out-of-scope work entry';
  END IF;
END
$$;

ALTER TABLE public.employees
  DISABLE TRIGGER guard_employee_self_update;
UPDATE public.employees
SET role = 'superadmin'
WHERE id = (SELECT employee_id FROM hrms_013_actor);
ALTER TABLE public.employees
  ENABLE TRIGGER guard_employee_self_update;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_013_employee_actor actor;

DO $$
DECLARE
  entry_id UUID;
  project_id UUID;
  started_at TIMESTAMPTZ;
  ended_at TIMESTAMPTZ;
  employee_correction_blocked BOOLEAN := false;
BEGIN
  SELECT
    id,
    hrms_013_manager_correction.project_id,
    hrms_013_manager_correction.started_at,
    hrms_013_manager_correction.ended_at
  INTO entry_id, project_id, started_at, ended_at
  FROM hrms_013_manager_correction;

  BEGIN
    PERFORM public.correct_work_entry(
      entry_id,
      project_id,
      NULL,
      'Employee must not correct time.',
      started_at,
      ended_at,
      'Employees do not have correction permission.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      employee_correction_blocked := true;
  END;

  IF NOT employee_correction_blocked THEN
    RAISE EXCEPTION 'Employee corrected a work entry';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_013_results AS
SELECT
  created_entry.task_description = 'Initial manually added work.'
    AND created_entry.correction_reason =
      'Add a verified historical entry.'
    AS manual_entry_normalised,
  created_audit.changed_by = actor.employee_id
    AND created_audit.employee_id = created_entry.employee_id
    AND created_audit.change_reason =
      'Add a verified historical entry.'
    AS create_audit_actor_and_reason,
  created_audit.old_record = '{}'::jsonb
    AND created_audit.new_record ->> 'id' = created_entry.id::text
    AS create_audit_snapshot,
  corrected_entry.task_description = 'Corrected manually added work.'
    AND corrected_entry.ended_at =
      created_entry.ended_at + INTERVAL '30 minutes'
    AS manual_correction_applied,
  correction_audit.old_record ->> 'task_description' =
      'Initial manually added work.'
    AND correction_audit.new_record ->> 'task_description' =
      'Corrected manually added work.'
    AND correction_audit.change_reason =
      'Correct the task and end time.'
    AS correction_old_new_snapshot,
  manager_correction.task_description =
    'Manager-scoped corrected work.'
    AS manager_owned_scope_allowed,
  (
    SELECT count(*) = 3
    FROM public.work_entry_audit audit
    WHERE audit.work_entry_id = created_entry.id
  ) AS every_manual_change_audited,
  (
    SELECT count(*) = 4
    FROM pg_proc
    WHERE oid IN (
      to_regprocedure(
        'public.can_create_manual_work_entry(uuid,uuid)'
      ),
      to_regprocedure('public.can_correct_work_entry(uuid)'),
      to_regprocedure(
        'public.create_manual_work_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,text)'
      ),
      to_regprocedure(
        'public.correct_work_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,text)'
      )
    )
  ) AS correction_rpcs_exist,
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.work_entry_audit'::regclass
      AND tgname = 'work_entry_audit_prevent_mutation'
      AND NOT tgisinternal
  ) AS audit_immutability_trigger_exists,
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
    ) AS direct_audit_writes_denied,
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
    ) AS direct_work_entry_writes_still_denied
FROM hrms_013_created_entry created_entry
CROSS JOIN hrms_013_created_audit created_audit
CROSS JOIN hrms_013_corrected_entry corrected_entry
CROSS JOIN hrms_013_correction_audit correction_audit
CROSS JOIN hrms_013_manager_correction manager_correction
CROSS JOIN hrms_013_actor actor;

SELECT
  (
    SELECT bool_and(check_value::boolean)
    FROM hrms_013_results result
    CROSS JOIN LATERAL jsonb_each_text(to_jsonb(result)) check_item(
      check_name,
      check_value
    )
  ) AS all_checks_pass,
  to_jsonb(result) AS checks
FROM hrms_013_results result;

ROLLBACK;
