-- HRMS-020 rollback-only behavioural verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

DO $$
DECLARE
  original_actor_id UUID;
  actor_auth_id UUID;
  board_actor_id UUID;
  in_employee_id UUID;
  break_employee_id UUID;
  out_employee_id UUID;
  stale_employee_id UUID;
  manager_employee_id UUID;
  activity_id UUID;
  project_id UUID;
  break_work_entry_id UUID;
  in_started_at TIMESTAMPTZ := public.app_day_start(
    public.app_current_date(statement_timestamp())
  );
  switched_started_at TIMESTAMPTZ := statement_timestamp();
  break_started_at TIMESTAMPTZ := statement_timestamp() - INTERVAL '30 minutes';
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
  VALUES (
    actor_auth_id,
    'HRMS020ACTOR',
    'HRMS-020 Board Viewer',
    'hrms-020-viewer@example.invalid',
    'employee',
    'Active'
  )
  RETURNING id INTO board_actor_id;

  INSERT INTO public.employees (emp_code, name, email, role, status)
  VALUES
    (
      'HRMS020IN',
      'HRMS-020 In Employee',
      'hrms-020-in@example.invalid',
      'employee',
      'Active'
    ),
    (
      'HRMS020BREAK',
      'HRMS-020 Break Employee',
      'hrms-020-break@example.invalid',
      'employee',
      'Active'
    ),
    (
      'HRMS020OUT',
      'HRMS-020 Out Employee',
      'hrms-020-out@example.invalid',
      'employee',
      'Active'
    ),
    (
      'HRMS020STALE',
      'HRMS-020 Stale Employee',
      'hrms-020-stale@example.invalid',
      'employee',
      'Active'
    ),
    (
      'HRMS020MANAGER',
      'HRMS-020 Project Manager',
      'hrms-020-manager@example.invalid',
      'manager',
      'Active'
    );

  SELECT id INTO in_employee_id
  FROM public.employees WHERE emp_code = 'HRMS020IN';
  SELECT id INTO break_employee_id
  FROM public.employees WHERE emp_code = 'HRMS020BREAK';
  SELECT id INTO out_employee_id
  FROM public.employees WHERE emp_code = 'HRMS020OUT';
  SELECT id INTO stale_employee_id
  FROM public.employees WHERE emp_code = 'HRMS020STALE';
  SELECT id INTO manager_employee_id
  FROM public.employees WHERE emp_code = 'HRMS020MANAGER';
  SELECT id INTO activity_id
  FROM public.activities
  WHERE name = 'Pre-sales'
    AND archived_at IS NULL;

  INSERT INTO public.projects (code, name, description, created_by)
  VALUES (
    'HRMS020VERIFY',
    'HRMS-020 Restricted Project',
    'Rollback-only live-board context verification.',
    original_actor_id
  )
  RETURNING id INTO project_id;

  INSERT INTO public.project_managers (
    project_id,
    employee_id,
    assigned_by
  )
  VALUES (project_id, manager_employee_id, original_actor_id);

  INSERT INTO public.work_entries (
    employee_id,
    activity_id,
    task_description,
    started_at,
    ended_at
  )
  VALUES (
    in_employee_id,
    activity_id,
    'Live-board first check-in verification.',
    in_started_at,
    switched_started_at
  );

  INSERT INTO public.work_entries (
    employee_id,
    activity_id,
    task_description,
    started_at
  )
  VALUES (
    in_employee_id,
    activity_id,
    'Live-board switched-session verification.',
    switched_started_at
  );

  INSERT INTO public.work_entries (
    employee_id,
    activity_id,
    task_description,
    started_at
  )
  VALUES (
    break_employee_id,
    activity_id,
    'Live-board Break verification.',
    statement_timestamp() - INTERVAL '2 hours'
  )
  RETURNING id INTO break_work_entry_id;

  INSERT INTO public.break_entries (
    work_entry_id,
    started_at
  )
  VALUES (
    break_work_entry_id,
    break_started_at
  );

  INSERT INTO public.work_entries (
    employee_id,
    project_id,
    task_description,
    started_at
  )
  VALUES (
    stale_employee_id,
    project_id,
    'Live-board stale verification.',
    statement_timestamp() - INTERVAL '25 hours'
  );

  IF (
    SELECT count(*)
    FROM public.live_work_status() board
    WHERE board.employee_id IN (
      board_actor_id,
      in_employee_id,
      break_employee_id,
      out_employee_id,
      stale_employee_id,
      manager_employee_id
    )
  ) <> 6 THEN
    RAISE EXCEPTION 'Employee viewer could not see every active board fixture';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.live_work_status() board
    WHERE board.employee_id = in_employee_id
      AND board.employee_name = 'HRMS-020 In Employee'
      AND board.employee_code = 'HRMS020IN'
      AND board.work_status = 'In'
      AND board.status_started_at = in_started_at
      AND board.context_type = 'activity'
      AND board.context_id = activity_id
      AND board.context_label = 'Pre-sales'
      AND NOT board.is_stale
  ) THEN
    RAISE EXCEPTION 'In status projection is incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.live_work_status() board
    WHERE board.employee_id = break_employee_id
      AND board.work_status = 'Break'
      AND board.status_started_at = break_started_at
      AND board.context_label = 'Pre-sales'
      AND NOT board.is_stale
  ) THEN
    RAISE EXCEPTION 'Break status projection is incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.live_work_status() board
    WHERE board.employee_id = out_employee_id
      AND board.work_status = 'Out'
      AND board.status_started_at IS NULL
      AND board.context_type IS NULL
      AND board.context_id IS NULL
      AND board.context_label IS NULL
      AND NOT board.is_stale
  ) THEN
    RAISE EXCEPTION 'Out status projection is incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.live_work_status() board
    WHERE board.employee_id = stale_employee_id
      AND board.work_status = 'In'
      AND board.is_stale
      AND board.context_type IS NULL
      AND board.context_id IS NULL
      AND board.context_label IS NULL
  ) THEN
    RAISE EXCEPTION 'Stale or restricted-project projection is incorrect';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.live_work_status()',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.live_work_status()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Live-board function grants are incorrect';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', gen_random_uuid()::text,
      'role', 'authenticated'
    )::text,
    true
  );
  IF EXISTS (SELECT 1 FROM public.live_work_status()) THEN
    RAISE EXCEPTION 'An unlinked identity received live-board data';
  END IF;
END
$$;

SELECT
  true AS all_checks_pass,
  jsonb_build_object(
    'employee_can_see_all_active_names', true,
    'in_status_uses_first_check_in_after_switch', true,
    'break_status_and_start_time_correct', true,
    'out_status_correct', true,
    'permitted_activity_context_visible', true,
    'restricted_project_context_hidden', true,
    'stale_open_entry_flagged', true,
    'anonymous_execute_denied', true,
    'authenticated_execute_granted', true,
    'unlinked_identity_denied', true
  ) AS checks;

ROLLBACK;
