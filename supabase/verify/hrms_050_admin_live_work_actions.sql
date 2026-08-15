-- Feedback SI32 rollback-only verification. Expected: all_checks_pass=true.

BEGIN;

DO $$
DECLARE
  original_admin_id UUID;
  actor_auth_id UUID;
  admin_actor_id UUID;
  target_employee_id UUID;
  employee_actor_id UUID;
  target_project_id UUID;
  target_activity_id UUID;
  active_entry public.work_entries;
BEGIN
  SELECT employee.id, employee.auth_id INTO original_admin_id, actor_auth_id
  FROM public.employees employee
  WHERE employee.role = 'superadmin' AND employee.status = 'Active' AND employee.auth_id IS NOT NULL
  LIMIT 1;
  IF original_admin_id IS NULL THEN RAISE EXCEPTION 'An Auth-linked superadmin is required'; END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', actor_auth_id::text, 'role', 'authenticated')::text, true);
  UPDATE public.employees SET auth_id = NULL WHERE id = original_admin_id;
  INSERT INTO public.employees (auth_id, emp_code, name, email, department, role, status)
  VALUES
    (actor_auth_id, 'HRMS050ADM', 'HRMS-050 Admin', 'hrms-050-admin@example.invalid', 'Operations', 'admin', 'Active'),
    (NULL, 'HRMS050EMP', 'HRMS-050 Employee', 'hrms-050-employee@example.invalid', 'Delivery', 'employee', 'Active'),
    (NULL, 'HRMS050ACT', 'HRMS-050 Employee Actor', 'hrms-050-actor@example.invalid', 'Delivery', 'employee', 'Active');
  SELECT id INTO admin_actor_id FROM public.employees WHERE emp_code = 'HRMS050ADM';
  SELECT id INTO target_employee_id FROM public.employees WHERE emp_code = 'HRMS050EMP';
  SELECT id INTO employee_actor_id FROM public.employees WHERE emp_code = 'HRMS050ACT';

  INSERT INTO public.projects (code, name, created_by)
  VALUES ('HRMS050', 'HRMS-050 Assigned Project', original_admin_id)
  RETURNING id INTO target_project_id;
  INSERT INTO public.activities (name, created_by)
  VALUES ('HRMS-050 Internal Activity', original_admin_id)
  RETURNING id INTO target_activity_id;
  INSERT INTO public.project_members (project_id, employee_id, assigned_by)
  VALUES (target_project_id, target_employee_id, admin_actor_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_employee_work_contexts(target_employee_id) context
    WHERE context.context_type = 'project' AND context.context_id = target_project_id
  ) THEN RAISE EXCEPTION 'Admin could not load the employee assigned project'; END IF;

  SELECT * INTO active_entry FROM public.admin_start_work_day(
    target_employee_id, target_project_id, NULL, 'Plan created by admin.', 'office'
  );
  IF active_entry.id IS NULL THEN RAISE EXCEPTION 'Admin start did not create a live entry'; END IF;

  PERFORM public.admin_start_work_break(target_employee_id);
  IF (SELECT state.work_status FROM public.admin_employee_work_state(target_employee_id) state) <> 'Break' THEN
    RAISE EXCEPTION 'Admin break did not update live state';
  END IF;
  PERFORM public.admin_resume_work_session(target_employee_id);
  SELECT * INTO active_entry FROM public.admin_switch_work_session(
    target_employee_id, NULL, target_activity_id, 'Switch recorded by admin.'
  );
  SELECT * INTO active_entry FROM public.admin_end_work_day(
    target_employee_id, active_entry.id, 'Summary created by admin.'
  );

  IF (SELECT count(*) FROM public.admin_work_action_audit audit WHERE audit.employee_id = target_employee_id) <> 5 THEN
    RAISE EXCEPTION 'Every delegated action was not immutably audited';
  END IF;
  IF (SELECT state.work_status FROM public.admin_employee_work_state(target_employee_id) state) <> 'Out' THEN
    RAISE EXCEPTION 'Admin end day did not update live state';
  END IF;

  UPDATE public.employees SET auth_id = NULL WHERE id = admin_actor_id;
  UPDATE public.employees SET auth_id = actor_auth_id WHERE id = employee_actor_id;
  BEGIN
    PERFORM * FROM public.admin_employee_work_state(target_employee_id);
    RAISE EXCEPTION 'Employee received delegated live work access';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Employee received delegated live work access' THEN RAISE; END IF;
  END;
END
$$;

SELECT true AS all_checks_pass, jsonb_build_object(
  'admin_can_start_break_resume_switch_and_end', true,
  'delegated_actions_are_audited', true,
  'employee_is_denied', true
) AS checks;

ROLLBACK;
