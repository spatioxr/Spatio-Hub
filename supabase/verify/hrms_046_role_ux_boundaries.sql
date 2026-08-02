-- HRMS-046 rollback-only role boundary verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

DO $$
DECLARE
  original_actor_id UUID;
  actor_auth_id UUID;
  manager_actor_id UUID;
  employee_viewer_id UUID;
  managed_employee_id UUID;
  unrelated_employee_id UUID;
  managed_project_id UUID;
  unrelated_project_id UUID;
  range_start TIMESTAMPTZ := date_trunc('day', statement_timestamp()) - INTERVAL '1 day';
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

  INSERT INTO public.employees (auth_id, emp_code, name, email, department, role, status)
  VALUES
    (actor_auth_id, 'HRMS046MGR', 'HRMS-046 Manager', 'hrms-046-manager@example.invalid', 'Delivery', 'manager', 'Active'),
    (NULL, 'HRMS046VIEW', 'HRMS-046 Employee Viewer', 'hrms-046-viewer@example.invalid', 'Delivery', 'employee', 'Active'),
    (NULL, 'HRMS046OWN', 'HRMS-046 Managed Employee', 'hrms-046-managed@example.invalid', 'Delivery', 'employee', 'Active'),
    (NULL, 'HRMS046OTHER', 'HRMS-046 Unrelated Employee', 'hrms-046-unrelated@example.invalid', 'Operations', 'employee', 'Active');

  SELECT id INTO manager_actor_id FROM public.employees WHERE emp_code = 'HRMS046MGR';
  SELECT id INTO employee_viewer_id FROM public.employees WHERE emp_code = 'HRMS046VIEW';
  SELECT id INTO managed_employee_id FROM public.employees WHERE emp_code = 'HRMS046OWN';
  SELECT id INTO unrelated_employee_id FROM public.employees WHERE emp_code = 'HRMS046OTHER';

  INSERT INTO public.projects (code, name, description, created_by)
  VALUES
    ('HRMS046OWN', 'HRMS-046 Managed Project', 'Manager-scoped analytics fixture.', original_actor_id),
    ('HRMS046OTHER', 'HRMS-046 Unrelated Project', 'Company live-context fixture.', original_actor_id);

  SELECT id INTO managed_project_id FROM public.projects WHERE code = 'HRMS046OWN';
  SELECT id INTO unrelated_project_id FROM public.projects WHERE code = 'HRMS046OTHER';

  INSERT INTO public.project_managers (project_id, employee_id, assigned_by)
  VALUES
    (managed_project_id, manager_actor_id, original_actor_id),
    (unrelated_project_id, original_actor_id, original_actor_id);

  INSERT INTO public.project_members (project_id, employee_id, assigned_by)
  VALUES
    (managed_project_id, managed_employee_id, original_actor_id),
    (unrelated_project_id, unrelated_employee_id, original_actor_id);

  INSERT INTO public.work_entries (
    employee_id,
    project_id,
    task_description,
    started_at,
    ended_at
  )
  VALUES (
    managed_employee_id,
    managed_project_id,
    'Managed analytics fixture.',
    range_start + INTERVAL '9 hours',
    range_start + INTERVAL '10 hours'
  );

  INSERT INTO public.work_entries (
    employee_id,
    project_id,
    task_description,
    started_at
  )
  VALUES (
    unrelated_employee_id,
    unrelated_project_id,
    'Company live rail fixture.',
    statement_timestamp() - INTERVAL '30 minutes'
  );

  IF (
    SELECT count(*)
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '1 day',
      'managed',
      NULL
    ) entry
    WHERE entry.employee_id IN (managed_employee_id, unrelated_employee_id)
  ) <> 1 THEN
    RAISE EXCEPTION 'Manager analytics did not remain restricted to managed projects';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.live_work_status() board
    WHERE board.employee_id = unrelated_employee_id
      AND board.context_type = 'project'
      AND board.context_id = unrelated_project_id
      AND board.context_label = 'HRMS046OTHER · HRMS-046 Unrelated Project'
  ) THEN
    RAISE EXCEPTION 'Manager could not see company current project context';
  END IF;

  UPDATE public.employees SET auth_id = NULL WHERE id = manager_actor_id;
  UPDATE public.employees SET auth_id = actor_auth_id WHERE id = employee_viewer_id;

  IF EXISTS (
    SELECT 1
    FROM public.live_work_status() board
    WHERE board.employee_id = unrelated_employee_id
      AND board.context_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Employee received unrelated project context';
  END IF;

  BEGIN
    PERFORM *
    FROM public.scoped_timesheet_entries(
      range_start,
      range_start + INTERVAL '1 day',
      'managed',
      NULL
    );
    RAISE EXCEPTION 'Employee received managed analytics';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'Employee received managed analytics' THEN
        RAISE;
      END IF;
  END;
END
$$;

SELECT
  true AS all_checks_pass,
  jsonb_build_object(
    'manager_analytics_scoped_to_managed_projects', true,
    'manager_company_live_context_visible', true,
    'employee_unrelated_project_context_hidden', true,
    'employee_managed_analytics_denied', true
  ) AS checks;

ROLLBACK;
