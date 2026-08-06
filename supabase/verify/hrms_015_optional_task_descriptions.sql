-- HRMS-015 revision rollback-only verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

DO $$
DECLARE
  superadmin_auth_id UUID;
  target_employee_id UUID;
  target_auth_id UUID := gen_random_uuid();
  first_activity_id UUID;
  second_activity_id UUID;
  first_session public.work_entries;
  switched_session public.work_entries;
  saved_settings public.employee_work_settings;
  required_description_blocked BOOLEAN := false;
  non_superadmin_individual_blocked BOOLEAN := false;
  non_superadmin_bulk_blocked BOOLEAN := false;
BEGIN
  SELECT employee.auth_id
  INTO superadmin_auth_id
  FROM public.employees employee
  WHERE employee.role = 'superadmin'
    AND employee.status = 'Active'
    AND employee.auth_id IS NOT NULL
  LIMIT 1;

  IF superadmin_auth_id IS NULL THEN
    RAISE EXCEPTION 'An Auth-linked active superadmin is required';
  END IF;

  SELECT activity.id
  INTO first_activity_id
  FROM public.activities activity
  WHERE activity.archived_at IS NULL
  ORDER BY activity.id
  LIMIT 1;

  SELECT activity.id
  INTO second_activity_id
  FROM public.activities activity
  WHERE activity.archived_at IS NULL
    AND activity.id <> first_activity_id
  ORDER BY activity.id
  LIMIT 1;

  IF first_activity_id IS NULL
    OR second_activity_id IS NULL
    OR first_activity_id = second_activity_id
  THEN
    RAISE EXCEPTION 'Two active activities are required';
  END IF;

  INSERT INTO public.employees (
    auth_id,
    emp_code,
    name,
    email,
    role,
    status
  )
  VALUES (
    target_auth_id,
    'HRMS015VERIFY',
    'HRMS-015 Verification Employee',
    'hrms-015-verify@example.invalid',
    'employee',
    'Active'
  )
  RETURNING id INTO target_employee_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employee_work_settings settings
    WHERE settings.employee_id = target_employee_id
      AND settings.task_description_required
  ) THEN
    RAISE EXCEPTION 'Task descriptions did not default to required';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', superadmin_auth_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  saved_settings := public.set_employee_work_requirements(
    target_employee_id,
    true,
    true,
    false
  );

  IF saved_settings.task_description_required THEN
    RAISE EXCEPTION 'Individual task-description exception was not saved';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.daily_report_settings_audit audit
    WHERE audit.employee_id = target_employee_id
      AND audit.old_task_description_required
      AND NOT audit.new_task_description_required
      AND audit.old_bos_required = audit.new_bos_required
      AND audit.old_eod_required = audit.new_eod_required
  ) THEN
    RAISE EXCEPTION 'Task-description change was not audited';
  END IF;

  saved_settings := public.set_daily_report_requirements(
    target_employee_id,
    false,
    true
  );

  IF saved_settings.task_description_required THEN
    RAISE EXCEPTION 'Legacy BOS/EOD control overwrote the task-description setting';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', target_auth_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  first_session := public.start_work_day(
    NULL,
    first_activity_id,
    NULL,
    NULL
  );

  IF first_session.task_description <> '' THEN
    RAISE EXCEPTION 'Optional blank task description was not normalised safely';
  END IF;

  switched_session := public.switch_work_session(
    NULL,
    second_activity_id,
    '   '
  );

  IF switched_session.task_description <> ''
    OR first_session.id = switched_session.id
  THEN
    RAISE EXCEPTION 'Optional blank description was not accepted while switching';
  END IF;

  PERFORM public.end_work_session(switched_session.id);

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', superadmin_auth_id::text,
      'role', 'authenticated'
    )::text,
    true
  );
  PERFORM public.set_employee_work_requirements(
    target_employee_id,
    false,
    true,
    true
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', target_auth_id::text,
      'role', 'authenticated'
    )::text,
    true
  );
  BEGIN
    PERFORM public.start_work_day(NULL, first_activity_id, '   ', NULL);
  EXCEPTION
    WHEN OTHERS THEN
      required_description_blocked := true;
  END;

  IF NOT required_description_blocked THEN
    RAISE EXCEPTION 'Required blank task description was accepted';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', superadmin_auth_id::text,
      'role', 'authenticated'
    )::text,
    true
  );
  PERFORM public.set_task_description_requirement_for_all(false);

  IF EXISTS (
    SELECT 1
    FROM public.employees employee
    LEFT JOIN public.employee_work_settings settings
      ON settings.employee_id = employee.id
    WHERE employee.status = 'Active'
      AND COALESCE(settings.task_description_required, true)
  ) THEN
    RAISE EXCEPTION 'Bulk task-description exception missed an active employee';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employee_work_settings settings
    WHERE settings.employee_id = target_employee_id
      AND NOT settings.bos_required
      AND settings.eod_required
  ) THEN
    RAISE EXCEPTION 'Bulk task-description change altered BOS/EOD requirements';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', target_auth_id::text,
      'role', 'authenticated'
    )::text,
    true
  );
  BEGIN
    PERFORM public.set_employee_work_requirements(
      target_employee_id,
      true,
      true,
      true
    );
  EXCEPTION
    WHEN OTHERS THEN
      non_superadmin_individual_blocked := true;
  END;

  BEGIN
    PERFORM public.set_task_description_requirement_for_all(true);
  EXCEPTION
    WHEN OTHERS THEN
      non_superadmin_bulk_blocked := true;
  END;

  IF NOT non_superadmin_individual_blocked OR NOT non_superadmin_bulk_blocked THEN
    RAISE EXCEPTION 'A non-superadmin changed task-description requirements';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.start_work_session(uuid,uuid,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.set_employee_work_requirements(uuid,boolean,boolean,boolean)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.set_task_description_requirement_for_all(boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Task-description function privileges are too broad';
  END IF;
END
$$;

SELECT
  true AS all_checks_pass,
  jsonb_build_object(
    'required_by_default', true,
    'individual_exception_saved', true,
    'task_setting_audited', true,
    'bos_eod_update_preserves_task_setting', true,
    'optional_start_allows_blank', true,
    'optional_switch_allows_blank', true,
    'required_start_rejects_blank', true,
    'bulk_update_covers_active_employees', true,
    'bulk_update_preserves_bos_eod', true,
    'non_superadmin_changes_denied', true,
    'function_privileges_scoped', true
  ) AS checks;

ROLLBACK;
