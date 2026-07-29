-- HRMS-019 rollback-only behavioural verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

DO $$
DECLARE
  actor_employee_id UUID;
  actor_auth_id UUID;
  target_employee_id UUID;
  saved_settings public.employee_work_settings;
  audit_count_before BIGINT;
  audit_count_after BIGINT;
  mutation_blocked BOOLEAN := false;
  non_superadmin_blocked BOOLEAN := false;
BEGIN
  SELECT employee.id, employee.auth_id
  INTO actor_employee_id, actor_auth_id
  FROM public.employees employee
  WHERE employee.role = 'superadmin'
    AND employee.status = 'Active'
    AND employee.auth_id IS NOT NULL
  LIMIT 1;

  IF actor_employee_id IS NULL THEN
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

  INSERT INTO public.employees (
    emp_code,
    name,
    email,
    role,
    status
  )
  VALUES (
    'HRMS019VERIFY',
    'HRMS-019 Verification Employee',
    'hrms-019-verify@example.invalid',
    'employee',
    'Active'
  )
  RETURNING id INTO target_employee_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employee_work_settings settings
    WHERE settings.employee_id = target_employee_id
      AND settings.bos_required
      AND settings.eod_required
  ) THEN
    RAISE EXCEPTION 'New employee requirements did not default to mandatory';
  END IF;

  saved_settings := public.set_daily_report_requirements(
    target_employee_id,
    false,
    true
  );
  IF saved_settings.bos_required OR NOT saved_settings.eod_required THEN
    RAISE EXCEPTION 'BOS exception was not saved immediately';
  END IF;

  saved_settings := public.set_daily_report_requirements(
    target_employee_id,
    true,
    false
  );
  IF NOT saved_settings.bos_required OR saved_settings.eod_required THEN
    RAISE EXCEPTION 'EOD exception was not saved immediately';
  END IF;
  IF saved_settings.updated_by IS DISTINCT FROM actor_employee_id THEN
    RAISE EXCEPTION 'Settings actor was not stamped';
  END IF;

  SELECT count(*)
  INTO audit_count_before
  FROM public.daily_report_settings_audit audit
  WHERE audit.employee_id = target_employee_id;

  IF audit_count_before <> 2 OR NOT EXISTS (
    SELECT 1
    FROM public.daily_report_settings_audit audit
    WHERE audit.employee_id = target_employee_id
      AND audit.changed_by = actor_employee_id
      AND audit.old_bos_required
      AND NOT audit.new_bos_required
      AND audit.old_eod_required
      AND audit.new_eod_required
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.daily_report_settings_audit audit
    WHERE audit.employee_id = target_employee_id
      AND audit.changed_by = actor_employee_id
      AND NOT audit.old_bos_required
      AND audit.new_bos_required
      AND audit.old_eod_required
      AND NOT audit.new_eod_required
  ) THEN
    RAISE EXCEPTION 'Audit history does not preserve both old/new changes';
  END IF;

  PERFORM public.set_daily_report_requirements(
    target_employee_id,
    true,
    false
  );
  SELECT count(*)
  INTO audit_count_after
  FROM public.daily_report_settings_audit audit
  WHERE audit.employee_id = target_employee_id;
  IF audit_count_after <> audit_count_before THEN
    RAISE EXCEPTION 'An unchanged save created a misleading audit row';
  END IF;

  BEGIN
    UPDATE public.daily_report_settings_audit
    SET new_bos_required = old_bos_required
    WHERE employee_id = target_employee_id;
  EXCEPTION
    WHEN OTHERS THEN
      mutation_blocked := true;
  END;
  IF NOT mutation_blocked THEN
    RAISE EXCEPTION 'Daily-report settings audit mutation was not blocked';
  END IF;

  IF has_table_privilege(
    'authenticated',
    'public.daily_report_settings_audit',
    'INSERT'
  ) OR has_table_privilege(
    'authenticated',
    'public.daily_report_settings_audit',
    'UPDATE'
  ) OR has_table_privilege(
    'authenticated',
    'public.daily_report_settings_audit',
    'DELETE'
  ) THEN
    RAISE EXCEPTION 'Authenticated direct audit writes are not denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.daily_report_settings_audit'::regclass
      AND tgname = 'daily_report_settings_audit_prevent_mutation'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'daily_report_settings_audit'
      AND policyname = 'daily_report_settings_audit_select_superadmin'
      AND roles = ARRAY['authenticated']::name[]
  ) THEN
    RAISE EXCEPTION 'Audit enforcement objects are incomplete';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', gen_random_uuid()::text,
      'role', 'authenticated'
    )::text,
    true
  );
  BEGIN
    PERFORM public.set_daily_report_requirements(
      target_employee_id,
      false,
      false
    );
  EXCEPTION
    WHEN OTHERS THEN
      non_superadmin_blocked := true;
  END;
  IF NOT non_superadmin_blocked THEN
    RAISE EXCEPTION 'A non-superadmin changed BOS/EOD requirements';
  END IF;
END
$$;

SELECT
  true AS all_checks_pass,
  jsonb_build_object(
    'requirements_default_mandatory', true,
    'bos_exception_saved', true,
    'eod_exception_saved', true,
    'settings_actor_stamped', true,
    'every_effective_change_audited', true,
    'audit_old_new_snapshots_accurate', true,
    'unchanged_save_not_audited', true,
    'audit_mutation_blocked', true,
    'direct_audit_writes_denied', true,
    'superadmin_audit_policy_exists', true,
    'non_superadmin_change_denied', true
  ) AS checks;

ROLLBACK;
