-- HRMS-023 rollback-only manual time-entry verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_023_superadmin AS
SELECT id AS employee_id, auth_id
FROM public.employees
WHERE role = 'superadmin'
  AND status = 'Active'
  AND auth_id IS NOT NULL
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hrms_023_superadmin) THEN
    RAISE EXCEPTION 'An Auth-linked active superadmin is required';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_023_actors AS
WITH auth_actor AS (
  INSERT INTO auth.users (id, email)
  VALUES
    (gen_random_uuid(), 'hrms-023-admin@example.invalid'),
    (gen_random_uuid(), 'hrms-023-manager@example.invalid'),
    (gen_random_uuid(), 'hrms-023-employee@example.invalid')
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
      WHEN 'hrms-023-admin@example.invalid' THEN 'HRMS023ADMIN'
      WHEN 'hrms-023-manager@example.invalid' THEN 'HRMS023MANAGER'
      ELSE 'HRMS023EMPLOYEE'
    END,
    CASE auth_actor.email
      WHEN 'hrms-023-admin@example.invalid' THEN 'HRMS-023 Admin'
      WHEN 'hrms-023-manager@example.invalid' THEN 'HRMS-023 Manager'
      ELSE 'HRMS-023 Employee'
    END,
    auth_actor.email,
    CASE auth_actor.email
      WHEN 'hrms-023-admin@example.invalid' THEN 'admin'
      WHEN 'hrms-023-manager@example.invalid' THEN 'manager'
      ELSE 'employee'
    END,
    'Active'
  FROM auth_actor
  RETURNING id AS employee_id, auth_id, role
)
SELECT *
FROM employee_actor;

CREATE TEMP TABLE hrms_023_targets AS
WITH target AS (
  INSERT INTO public.employees (
    emp_code,
    name,
    email,
    role,
    status
  )
  VALUES
    (
      'HRMS023MEMBER',
      'HRMS-023 Team Member',
      'hrms-023-member@example.invalid',
      'employee',
      'Active'
    ),
    (
      'HRMS023OUTSIDE',
      'HRMS-023 Outside Employee',
      'hrms-023-outside@example.invalid',
      'employee',
      'Active'
    )
  RETURNING id, emp_code
)
SELECT *
FROM target;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::TEXT,
    'role', 'authenticated'
  )::TEXT,
  true
)
FROM hrms_023_superadmin actor;

CREATE TEMP TABLE hrms_023_project AS
SELECT project.*
FROM hrms_023_actors manager
CROSS JOIN LATERAL public.create_project_with_manager(
  'HRMS023VERIFY',
  'HRMS-023 Verification Project',
  'Rollback-only manual time-entry verification.',
  manager.employee_id
) AS project
WHERE manager.role = 'manager';

CREATE TEMP TABLE hrms_023_member_assignment AS
SELECT assignment.*
FROM hrms_023_project project
CROSS JOIN hrms_023_targets target
CROSS JOIN LATERAL public.assign_project_member(
  project.id,
  target.id
) AS assignment
WHERE target.emp_code = 'HRMS023MEMBER';

CREATE TEMP TABLE hrms_023_superadmin_contexts AS
SELECT context.*
FROM hrms_023_targets target
CROSS JOIN LATERAL public.manual_time_entry_contexts(target.id) context
WHERE target.emp_code = 'HRMS023OUTSIDE';

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::TEXT,
    'role', 'authenticated'
  )::TEXT,
  true
)
FROM hrms_023_actors actor
WHERE actor.role = 'admin';

CREATE TEMP TABLE hrms_023_admin_contexts AS
SELECT context.*
FROM hrms_023_targets target
CROSS JOIN LATERAL public.manual_time_entry_contexts(target.id) context
WHERE target.emp_code = 'HRMS023OUTSIDE';

CREATE TEMP TABLE hrms_023_admin_entry AS
SELECT created.*
FROM hrms_023_targets target
CROSS JOIN public.activities activity
CROSS JOIN LATERAL public.create_manual_time_entry(
  target.id,
  NULL,
  activity.id,
  '  Admin-created internal work.  ',
  TIMESTAMPTZ '2099-02-10 09:00:00+00',
  TIMESTAMPTZ '2099-02-10 11:00:00+00',
  jsonb_build_array(
    jsonb_build_object(
      'started_at', '2099-02-10T10:00:00+00',
      'ended_at', '2099-02-10T10:15:00+00'
    )
  ),
  '  Add verified organisation time.  '
) AS created
WHERE target.emp_code = 'HRMS023OUTSIDE'
  AND activity.name = 'Pre-sales'
  AND activity.archived_at IS NULL;

CREATE TEMP TABLE hrms_023_initial_breaks AS
SELECT break_entry.*
FROM public.break_entries break_entry
JOIN hrms_023_admin_entry entry
  ON entry.id = break_entry.work_entry_id;

CREATE TEMP TABLE hrms_023_corrected_entry AS
SELECT corrected.*
FROM hrms_023_admin_entry entry
CROSS JOIN public.activities activity
CROSS JOIN LATERAL public.correct_manual_time_entry(
  entry.id,
  NULL,
  activity.id,
  'Corrected organisation activity work.',
  TIMESTAMPTZ '2099-02-10 08:45:00+00',
  TIMESTAMPTZ '2099-02-10 11:30:00+00',
  jsonb_build_array(
    jsonb_build_object(
      'started_at', '2099-02-10T09:30:00+00',
      'ended_at', '2099-02-10T09:45:00+00'
    ),
    jsonb_build_object(
      'started_at', '2099-02-10T10:30:00+00',
      'ended_at', '2099-02-10T10:45:00+00'
    )
  ),
  'Correct the context, range, task, and breaks.'
) AS corrected
WHERE activity.name = 'Estimation'
  AND activity.archived_at IS NULL;

CREATE TEMP TABLE hrms_023_guards (
  overlap_blocked BOOLEAN NOT NULL DEFAULT false,
  invalid_break_blocked BOOLEAN NOT NULL DEFAULT false,
  blank_reason_blocked BOOLEAN NOT NULL DEFAULT false,
  no_change_blocked BOOLEAN NOT NULL DEFAULT false,
  manager_outside_scope_blocked BOOLEAN NOT NULL DEFAULT false,
  employee_write_blocked BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO hrms_023_guards DEFAULT VALUES;

DO $$
DECLARE
  target_id UUID;
  activity_id UUID;
  entry public.work_entries;
BEGIN
  SELECT id INTO target_id
  FROM hrms_023_targets
  WHERE emp_code = 'HRMS023OUTSIDE';

  SELECT id INTO activity_id
  FROM public.activities
  WHERE name = 'Proposal making'
    AND archived_at IS NULL;

  SELECT * INTO entry FROM hrms_023_corrected_entry;

  BEGIN
    PERFORM public.create_manual_time_entry(
      target_id,
      NULL,
      activity_id,
      'Overlapping entry must fail.',
      TIMESTAMPTZ '2099-02-10 11:00:00+00',
      TIMESTAMPTZ '2099-02-10 12:00:00+00',
      '[]'::JSONB,
      'Verify session overlap rejection.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE hrms_023_guards SET overlap_blocked = true;
  END;

  BEGIN
    PERFORM public.create_manual_time_entry(
      target_id,
      NULL,
      activity_id,
      'Invalid break must fail.',
      TIMESTAMPTZ '2099-02-11 09:00:00+00',
      TIMESTAMPTZ '2099-02-11 10:00:00+00',
      jsonb_build_array(
        jsonb_build_object(
          'started_at', '2099-02-11T08:45:00+00',
          'ended_at', '2099-02-11T09:15:00+00'
        )
      ),
      'Verify break containment.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE hrms_023_guards SET invalid_break_blocked = true;
  END;

  BEGIN
    PERFORM public.correct_manual_time_entry(
      entry.id,
      NULL,
      entry.activity_id,
      'A blank reason must fail.',
      entry.started_at,
      entry.ended_at,
      '[]'::JSONB,
      '   '
    );
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE hrms_023_guards SET blank_reason_blocked = true;
  END;

  BEGIN
    PERFORM public.correct_manual_time_entry(
      entry.id,
      NULL,
      entry.activity_id,
      entry.task_description,
      entry.started_at,
      entry.ended_at,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'started_at', break_entry.started_at,
            'ended_at', break_entry.ended_at
          )
          ORDER BY break_entry.started_at
        )
        FROM public.break_entries break_entry
        WHERE break_entry.work_entry_id = entry.id
      ),
      'A reason cannot make a no-op valid.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE hrms_023_guards SET no_change_blocked = true;
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
FROM hrms_023_actors actor
WHERE actor.role = 'manager';

CREATE TEMP TABLE hrms_023_manager_contexts AS
SELECT context.*
FROM hrms_023_targets target
CROSS JOIN LATERAL public.manual_time_entry_contexts(target.id) context
WHERE target.emp_code = 'HRMS023MEMBER';

CREATE TEMP TABLE hrms_023_manager_entry AS
SELECT created.*
FROM hrms_023_project project
CROSS JOIN hrms_023_targets target
CROSS JOIN LATERAL public.create_manual_time_entry(
  target.id,
  project.id,
  NULL,
  'Manager-created project work.',
  TIMESTAMPTZ '2099-02-12 09:00:00+00',
  TIMESTAMPTZ '2099-02-12 10:00:00+00',
  jsonb_build_array(
    jsonb_build_object(
      'started_at', '2099-02-12T09:20:00+00',
      'ended_at', '2099-02-12T09:30:00+00'
    )
  ),
  'Add time for an assigned project member.'
) AS created
WHERE target.emp_code = 'HRMS023MEMBER';

DO $$
DECLARE
  outside_id UUID;
  activity_id UUID;
BEGIN
  SELECT id INTO outside_id
  FROM hrms_023_targets
  WHERE emp_code = 'HRMS023OUTSIDE';

  SELECT id INTO activity_id
  FROM public.activities
  WHERE name = 'Proposal making'
    AND archived_at IS NULL;

  BEGIN
    PERFORM public.create_manual_time_entry(
      outside_id,
      NULL,
      activity_id,
      'Manager outside-scope write must fail.',
      TIMESTAMPTZ '2099-02-13 09:00:00+00',
      TIMESTAMPTZ '2099-02-13 10:00:00+00',
      '[]'::JSONB,
      'Verify manager scope denial.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE hrms_023_guards SET manager_outside_scope_blocked = true;
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
FROM hrms_023_actors actor
WHERE actor.role = 'employee';

DO $$
DECLARE
  target_id UUID;
  activity_id UUID;
BEGIN
  SELECT id INTO target_id
  FROM hrms_023_targets
  WHERE emp_code = 'HRMS023MEMBER';

  SELECT id INTO activity_id
  FROM public.activities
  WHERE name = 'Proposal making'
    AND archived_at IS NULL;

  BEGIN
    PERFORM public.create_manual_time_entry(
      target_id,
      NULL,
      activity_id,
      'Employee write must fail.',
      TIMESTAMPTZ '2099-02-14 09:00:00+00',
      TIMESTAMPTZ '2099-02-14 10:00:00+00',
      '[]'::JSONB,
      'Employees cannot add corrections.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE hrms_023_guards SET employee_write_blocked = true;
  END;
END
$$;

CREATE TEMP TABLE hrms_023_results AS
SELECT
  EXISTS (
    SELECT 1
    FROM hrms_023_superadmin_contexts
    WHERE context_type = 'activity'
  ) AS superadmin_receives_organisation_contexts,
  EXISTS (
    SELECT 1
    FROM hrms_023_admin_contexts
    WHERE context_type = 'activity'
  ) AS admin_receives_organisation_contexts,
  admin_entry.task_description = 'Admin-created internal work.'
    AND admin_entry.correction_reason =
      'Add verified organisation time.'
    AS admin_manual_entry_created,
  (
    SELECT count(*) = 1
    FROM hrms_023_initial_breaks
  ) AS initial_break_created,
  corrected_entry.activity_id <> admin_entry.activity_id
    AND corrected_entry.task_description =
      'Corrected organisation activity work.'
    AND corrected_entry.started_at =
      TIMESTAMPTZ '2099-02-10 08:45:00+00'
    AND corrected_entry.ended_at =
      TIMESTAMPTZ '2099-02-10 11:30:00+00'
    AS authorised_fields_corrected,
  (
    SELECT count(*) = 2
    FROM public.break_entries break_entry
    WHERE break_entry.work_entry_id = corrected_entry.id
  ) AS breaks_replaced,
  (
    SELECT count(*) = 2
      AND bool_and(audit.change_reason <> '')
      AND bool_and(audit.new_record ? 'breaks')
    FROM public.work_entry_audit audit
    WHERE audit.work_entry_id = corrected_entry.id
  ) AS every_change_audited_with_breaks,
  guards.overlap_blocked
    AND guards.invalid_break_blocked
    AND guards.blank_reason_blocked
    AND guards.no_change_blocked
    AS invalid_manual_changes_rejected,
  EXISTS (
    SELECT 1
    FROM hrms_023_manager_contexts context
    JOIN hrms_023_project project
      ON project.id = context.context_id
    WHERE context.context_type = 'project'
  ) AS manager_receives_assigned_context,
  manager_entry.project_id = project.id
    AND manager_entry.employee_id = target.id
    AS manager_assigned_team_allowed,
  guards.manager_outside_scope_blocked
    AS manager_outside_scope_denied,
  guards.employee_write_blocked
    AS employee_manual_write_denied,
  (
    SELECT count(*) = 3
    FROM pg_proc
    WHERE oid IN (
      to_regprocedure(
        'public.manual_time_entry_contexts(uuid)'
      ),
      to_regprocedure(
        'public.create_manual_time_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,text)'
      ),
      to_regprocedure(
        'public.correct_manual_time_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,text)'
      )
    )
  ) AS manual_time_entry_rpcs_exist,
  NOT has_function_privilege(
    'anon',
    'public.create_manual_time_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,text)',
    'EXECUTE'
  )
    AND has_function_privilege(
      'authenticated',
      'public.create_manual_time_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,text)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.correct_manual_time_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,text)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.correct_manual_time_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,text)',
      'EXECUTE'
    ) AS manual_rpc_execution_restricted,
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
    ) AS direct_entry_and_break_writes_denied
FROM hrms_023_admin_entry admin_entry
CROSS JOIN hrms_023_corrected_entry corrected_entry
CROSS JOIN hrms_023_manager_entry manager_entry
CROSS JOIN hrms_023_project project
CROSS JOIN hrms_023_targets target
CROSS JOIN hrms_023_guards guards
WHERE target.emp_code = 'HRMS023MEMBER';

SELECT
  (
    SELECT bool_and(check_value::BOOLEAN)
    FROM hrms_023_results result
    CROSS JOIN LATERAL jsonb_each_text(to_jsonb(result)) check_item(
      check_name,
      check_value
    )
  ) AS all_checks_pass,
  to_jsonb(result) AS checks
FROM hrms_023_results result;

ROLLBACK;
