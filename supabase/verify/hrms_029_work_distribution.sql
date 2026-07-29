-- HRMS-029 rollback-only work-distribution verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

DO $$
DECLARE
  original_actor_id UUID;
  actor_auth_id UUID;
  admin_actor_id UUID;
  manager_actor_id UUID;
  employee_one_id UUID;
  employee_two_id UUID;
  project_id UUID;
  activity_id UUID;
  first_entry_id UUID;
  range_start TIMESTAMPTZ := date_trunc('day', statement_timestamp()) - INTERVAL '2 days';
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
    jsonb_build_object('sub', actor_auth_id::text, 'role', 'authenticated')::text,
    true
  );

  UPDATE public.employees SET auth_id = NULL WHERE id = original_actor_id;

  INSERT INTO public.employees (
    auth_id,
    emp_code,
    name,
    email,
    department,
    role,
    status
  )
  VALUES
    (
      actor_auth_id,
      'HRMS029ADM',
      'HRMS-029 Admin',
      'hrms-029-admin@example.invalid',
      'Operations',
      'admin',
      'Active'
    ),
    (
      NULL,
      'HRMS029MGR',
      'HRMS-029 Manager',
      'hrms-029-manager@example.invalid',
      'Delivery',
      'manager',
      'Active'
    ),
    (
      NULL,
      'HRMS029ONE',
      'HRMS-029 Employee One',
      'hrms-029-one@example.invalid',
      'Delivery',
      'employee',
      'Active'
    ),
    (
      NULL,
      'HRMS029TWO',
      'HRMS-029 Employee Two',
      'hrms-029-two@example.invalid',
      'Operations',
      'employee',
      'Active'
    );

  SELECT id INTO admin_actor_id FROM public.employees WHERE emp_code = 'HRMS029ADM';
  SELECT id INTO manager_actor_id FROM public.employees WHERE emp_code = 'HRMS029MGR';
  SELECT id INTO employee_one_id FROM public.employees WHERE emp_code = 'HRMS029ONE';
  SELECT id INTO employee_two_id FROM public.employees WHERE emp_code = 'HRMS029TWO';

  SELECT id INTO activity_id
  FROM public.activities
  WHERE archived_at IS NULL
  ORDER BY name
  LIMIT 1;

  IF activity_id IS NULL THEN
    RAISE EXCEPTION 'An active activity is required';
  END IF;

  INSERT INTO public.projects (code, name, description, created_by)
  VALUES (
    'HRMS029VERIFY',
    'HRMS-029 Project',
    'Rollback-only work-distribution verification.',
    original_actor_id
  )
  RETURNING id INTO project_id;

  INSERT INTO public.work_entries (
    employee_id,
    project_id,
    task_description,
    started_at,
    ended_at
  )
  VALUES (
    employee_one_id,
    project_id,
    'Project distribution.',
    range_start + INTERVAL '9 hours',
    range_start + INTERVAL '11 hours'
  )
  RETURNING id INTO first_entry_id;

  INSERT INTO public.break_entries (work_entry_id, started_at, ended_at)
  VALUES (
    first_entry_id,
    range_start + INTERVAL '10 hours',
    range_start + INTERVAL '10 hours 15 minutes'
  );

  INSERT INTO public.work_entries (
    employee_id,
    activity_id,
    task_description,
    started_at,
    ended_at
  )
  VALUES (
    employee_two_id,
    activity_id,
    'Activity distribution.',
    range_start + INTERVAL '12 hours',
    range_start + INTERVAL '13 hours'
  );

  IF (
    SELECT count(*)
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '1 day',
      'organisation',
      NULL
    ) entry
    WHERE entry.employee_id IN (employee_one_id, employee_two_id)
  ) <> 2 THEN
    RAISE EXCEPTION 'Organisation sessions are incomplete';
  END IF;

  IF (
    SELECT sum(entry.worked_seconds)
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '1 day',
      'organisation',
      NULL
    ) entry
    WHERE entry.employee_id IN (employee_one_id, employee_two_id)
  ) <> 9900 THEN
    RAISE EXCEPTION 'Worked-time total is incorrect';
  END IF;

  IF (
    SELECT sum(entry.break_seconds)
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '1 day',
      'organisation',
      NULL
    ) entry
    WHERE entry.employee_id IN (employee_one_id, employee_two_id)
  ) <> 900 THEN
    RAISE EXCEPTION 'Break-time total is incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '1 day',
      'organisation',
      NULL
    ) entry
    WHERE entry.employee_id = employee_one_id
      AND entry.context_type = 'project'
      AND entry.context_id = project_id
      AND entry.employee_department = 'Delivery'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '1 day',
      'organisation',
      NULL
    ) entry
    WHERE entry.employee_id = employee_two_id
      AND entry.context_type = 'activity'
      AND entry.context_id = activity_id
      AND entry.employee_department = 'Operations'
  ) THEN
    RAISE EXCEPTION 'Distribution dimensions are incomplete';
  END IF;

  UPDATE public.employees SET auth_id = NULL WHERE id = admin_actor_id;
  UPDATE public.employees SET auth_id = actor_auth_id WHERE id = manager_actor_id;

  BEGIN
    PERFORM *
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '1 day',
      'organisation',
      NULL
    );
    RAISE EXCEPTION 'Manager received organisation analytics';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'Manager received organisation analytics' THEN
        RAISE;
      END IF;
  END;

  UPDATE public.employees SET auth_id = NULL WHERE id = manager_actor_id;
  UPDATE public.employees SET auth_id = actor_auth_id WHERE id = employee_one_id;

  BEGIN
    PERFORM *
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '1 day',
      'organisation',
      NULL
    );
    RAISE EXCEPTION 'Employee received organisation analytics';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'Employee received organisation analytics' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT TRUE AS all_checks_pass;

ROLLBACK;
