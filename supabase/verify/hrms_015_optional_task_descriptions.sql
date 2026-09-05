-- HRMS-015/016 corrected task-description workflow verification.
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
  blank_switch_blocked BOOLEAN := false;
  non_superadmin_settings_blocked BOOLEAN := false;
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

  IF first_activity_id IS NULL OR second_activity_id IS NULL THEN
    RAISE EXCEPTION 'Two active activities are required';
  END IF;

  INSERT INTO auth.users (id, email)
  VALUES (target_auth_id, 'hrms-015-verify@example.invalid');

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
      AND NOT settings.task_description_required
  ) THEN
    RAISE EXCEPTION 'Compatibility task setting did not default to false';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', superadmin_auth_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  saved_settings := public.set_daily_report_requirements(
    target_employee_id,
    false,
    true
  );

  IF saved_settings.bos_required
    OR NOT saved_settings.eod_required
    OR saved_settings.task_description_required
  THEN
    RAISE EXCEPTION 'BOS/EOD requirements were not saved independently';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.daily_report_settings_audit audit
    WHERE audit.employee_id = target_employee_id
      AND audit.old_bos_required
      AND NOT audit.new_bos_required
      AND audit.old_eod_required = audit.new_eod_required
      AND audit.old_task_description_required = audit.new_task_description_required
  ) THEN
    RAISE EXCEPTION 'BOS/EOD settings change was not audited correctly';
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
    RAISE EXCEPTION 'First work start did not store a blank task description';
  END IF;

  BEGIN
    PERFORM public.switch_work_session(
      NULL,
      second_activity_id,
      '   '
    );
  EXCEPTION
    WHEN OTHERS THEN
      blank_switch_blocked := true;
  END;

  IF NOT blank_switch_blocked THEN
    RAISE EXCEPTION 'Context switch accepted a blank task description';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.work_entries entry
    WHERE entry.id = first_session.id
      AND entry.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Rejected switch did not preserve the open session';
  END IF;

  switched_session := public.switch_work_session(
    NULL,
    second_activity_id,
    '  Describe switched work.  '
  );

  IF switched_session.task_description <> 'Describe switched work.'
    OR switched_session.id = first_session.id
  THEN
    RAISE EXCEPTION 'Valid switch did not create a normalized described session';
  END IF;

  PERFORM public.end_work_session(switched_session.id);

  BEGIN
    PERFORM public.set_daily_report_requirements(
      target_employee_id,
      true,
      true
    );
  EXCEPTION
    WHEN OTHERS THEN
      non_superadmin_settings_blocked := true;
  END;

  IF NOT non_superadmin_settings_blocked THEN
    RAISE EXCEPTION 'A non-superadmin changed BOS/EOD requirements';
  END IF;

  IF to_regprocedure(
    'public.set_employee_work_requirements(uuid,boolean,boolean,boolean)'
  ) IS NOT NULL
    OR to_regprocedure(
      'public.set_task_description_requirement_for_all(boolean)'
    ) IS NOT NULL
  THEN
    RAISE EXCEPTION 'Task-description configuration functions still exist';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.start_work_session(uuid,uuid,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.set_daily_report_requirements(uuid,boolean,boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Work-entry function privileges are too broad';
  END IF;
END
$$;

SELECT
  true AS all_checks_pass,
  jsonb_build_object(
    'first_start_omits_task_description', true,
    'switch_rejects_blank_description', true,
    'rejected_switch_is_atomic', true,
    'switch_accepts_and_normalizes_description', true,
    'task_configuration_removed', true,
    'bos_eod_control_retained', true,
    'bos_eod_change_audited', true,
    'non_superadmin_settings_change_denied', true,
    'function_privileges_scoped', true
  ) AS checks;

ROLLBACK;
