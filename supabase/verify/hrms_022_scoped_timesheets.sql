-- HRMS-022 rollback-only role-scope verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

DO $$
DECLARE
  original_actor_id UUID;
  actor_auth_id UUID;
  employee_actor_id UUID;
  manager_actor_id UUID;
  admin_actor_id UUID;
  managed_employee_id UUID;
  unscoped_employee_id UUID;
  activity_id UUID;
  project_id UUID;
  range_start TIMESTAMPTZ := date_trunc('week', statement_timestamp());
BEGIN
  SELECT employee.id, employee.auth_id
  INTO original_actor_id, actor_auth_id
  FROM public.employees employee
  WHERE employee.role = 'superadmin'
    AND employee.status = 'Active'
    AND employee.auth_id IS NOT NULL
  LIMIT 1;

  IF original_actor_id IS NULL THEN
    RAISE EXCEPTION 'An Auth-linked active superadmin is required';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', actor_auth_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  UPDATE public.employees
  SET auth_id = NULL
  WHERE id = original_actor_id;

  INSERT INTO public.employees (
    auth_id,
    emp_code,
    name,
    email,
    role,
    status
  )
  VALUES
    (
      actor_auth_id,
      'HRMS022EMP',
      'HRMS-022 Employee',
      'hrms-022-employee@example.invalid',
      'employee',
      'Active'
    ),
    (
      NULL,
      'HRMS022MGR',
      'HRMS-022 Manager',
      'hrms-022-manager@example.invalid',
      'manager',
      'Active'
    ),
    (
      NULL,
      'HRMS022ADM',
      'HRMS-022 Admin',
      'hrms-022-admin@example.invalid',
      'admin',
      'Active'
    ),
    (
      NULL,
      'HRMS022TEAM',
      'HRMS-022 Managed Employee',
      'hrms-022-managed@example.invalid',
      'employee',
      'Active'
    ),
    (
      NULL,
      'HRMS022OUT',
      'HRMS-022 Unscoped Employee',
      'hrms-022-unscoped@example.invalid',
      'employee',
      'Active'
    );

  SELECT id INTO employee_actor_id
  FROM public.employees WHERE emp_code = 'HRMS022EMP';
  SELECT id INTO manager_actor_id
  FROM public.employees WHERE emp_code = 'HRMS022MGR';
  SELECT id INTO admin_actor_id
  FROM public.employees WHERE emp_code = 'HRMS022ADM';
  SELECT id INTO managed_employee_id
  FROM public.employees WHERE emp_code = 'HRMS022TEAM';
  SELECT id INTO unscoped_employee_id
  FROM public.employees WHERE emp_code = 'HRMS022OUT';
  SELECT id INTO activity_id
  FROM public.activities
  WHERE name = 'Pre-sales'
    AND archived_at IS NULL;

  INSERT INTO public.projects (code, name, description, created_by)
  VALUES (
    'HRMS022VERIFY',
    'HRMS-022 Managed Project',
    'Rollback-only scoped-timesheet verification.',
    original_actor_id
  )
  RETURNING id INTO project_id;

  INSERT INTO public.project_managers (
    project_id,
    employee_id,
    assigned_by
  )
  VALUES (project_id, manager_actor_id, original_actor_id);

  INSERT INTO public.project_members (
    project_id,
    employee_id,
    assigned_by
  )
  VALUES (project_id, managed_employee_id, original_actor_id);

  INSERT INTO public.work_entries (
    employee_id,
    activity_id,
    task_description,
    started_at,
    ended_at
  )
  VALUES
    (
      employee_actor_id,
      activity_id,
      'Personal-only entry.',
      range_start + INTERVAL '9 hours',
      range_start + INTERVAL '10 hours'
    ),
    (
      managed_employee_id,
      activity_id,
      'Managed-team entry.',
      range_start + INTERVAL '10 hours',
      range_start + INTERVAL '12 hours'
    ),
    (
      unscoped_employee_id,
      activity_id,
      'Organisation-only entry.',
      range_start + INTERVAL '12 hours',
      range_start + INTERVAL '15 hours'
    );

  IF (
    SELECT count(*)
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '7 days',
      'personal',
      NULL
    )
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '7 days',
      'personal',
      NULL
    ) entry
    WHERE entry.employee_id = employee_actor_id
      AND entry.employee_name = 'HRMS-022 Employee'
      AND entry.employee_code = 'HRMS022EMP'
  ) THEN
    RAISE EXCEPTION 'Employee personal scope is incorrect';
  END IF;

  IF (
    SELECT count(*)
    FROM public.timesheet_scope_members('personal')
  ) <> 1 THEN
    RAISE EXCEPTION 'Employee personal member scope is incorrect';
  END IF;

  BEGIN
    PERFORM *
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '7 days',
      'managed',
      NULL
    );
    RAISE EXCEPTION 'Employee received managed scope';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'Employee received managed scope' THEN
        RAISE;
      END IF;
  END;

  UPDATE public.employees
  SET auth_id = NULL
  WHERE id = employee_actor_id;
  UPDATE public.employees
  SET auth_id = actor_auth_id
  WHERE id = manager_actor_id;

  IF (
    SELECT count(*)
    FROM public.timesheet_scope_members('managed')
    WHERE employee_id IN (managed_employee_id, unscoped_employee_id)
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM public.timesheet_scope_members('managed')
    WHERE employee_id = managed_employee_id
  ) THEN
    RAISE EXCEPTION 'Manager member scope is incorrect';
  END IF;

  IF (
    SELECT count(*)
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '7 days',
      'managed',
      NULL
    )
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '7 days',
      'managed',
      managed_employee_id
    ) entry
    WHERE entry.employee_id = managed_employee_id
      AND entry.task_description = 'Managed-team entry.'
  ) THEN
    RAISE EXCEPTION 'Manager timesheet scope is incorrect';
  END IF;

  BEGIN
    PERFORM *
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '7 days',
      'managed',
      unscoped_employee_id
    );
    RAISE EXCEPTION 'Manager selected an out-of-scope employee';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'Manager selected an out-of-scope employee' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM *
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '7 days',
      'organisation',
      NULL
    );
    RAISE EXCEPTION 'Manager received organisation scope';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'Manager received organisation scope' THEN
        RAISE;
      END IF;
  END;

  UPDATE public.employees
  SET auth_id = NULL
  WHERE id = manager_actor_id;
  UPDATE public.employees
  SET auth_id = actor_auth_id
  WHERE id = admin_actor_id;

  IF (
    SELECT count(*)
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '7 days',
      'organisation',
      NULL
    )
    WHERE employee_id IN (
      employee_actor_id,
      managed_employee_id,
      unscoped_employee_id
    )
  ) <> 3 THEN
    RAISE EXCEPTION 'Admin organisation scope is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.timesheet_scope_members('organisation')
    WHERE employee_id = unscoped_employee_id
  ) THEN
    RAISE EXCEPTION 'Admin organisation member scope is incomplete';
  END IF;

  UPDATE public.employees
  SET auth_id = NULL
  WHERE id = admin_actor_id;
  UPDATE public.employees
  SET auth_id = actor_auth_id
  WHERE id = original_actor_id;

  IF (
    SELECT count(*)
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '7 days',
      'organisation',
      NULL
    )
    WHERE employee_id IN (
      employee_actor_id,
      managed_employee_id,
      unscoped_employee_id
    )
  ) <> 3 THEN
    RAISE EXCEPTION 'Superadmin organisation scope is incomplete';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.timesheet_scope_members(text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.scoped_timesheet_entries(timestamptz,timestamptz,text,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.timesheet_scope_members(text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.scoped_timesheet_entries(timestamptz,timestamptz,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Scoped-timesheet function grants are incorrect';
  END IF;
END
$$;

SELECT
  true AS all_checks_pass,
  jsonb_build_object(
    'employee_personal_only', true,
    'personal_member_scope', true,
    'employee_managed_denied', true,
    'manager_members_project_assigned_only', true,
    'manager_entries_project_assigned_only', true,
    'manager_employee_filter_enforced', true,
    'manager_organisation_denied', true,
    'admin_organisation_scope', true,
    'admin_individuals_visible', true,
    'superadmin_organisation_scope', true,
    'anonymous_execute_denied', true,
    'authenticated_execute_granted', true
  ) AS checks;

ROLLBACK;
