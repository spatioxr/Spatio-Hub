-- HRMS-006 read-only verification. Expected result: every value is true.

BEGIN;

WITH expected(table_name) AS (
  VALUES
    ('employees'),
    ('attendance'),
    ('daily_reports'),
    ('leaves'),
    ('leave_balances'),
    ('holidays'),
    ('projects'),
    ('activities'),
    ('project_managers'),
    ('project_members'),
    ('work_entries'),
    ('break_entries'),
    ('work_entry_audit'),
    ('employee_work_settings'),
    ('daily_report_settings_audit')
),
actual AS (
  SELECT
    expected.table_name,
    pg_class.oid IS NOT NULL AS table_exists,
    COALESCE(pg_class.relrowsecurity, false) AS rls_enabled,
    CASE
      WHEN pg_class.oid IS NULL THEN false
      ELSE NOT has_table_privilege(
        'anon',
        format('public.%I', expected.table_name),
        'SELECT'
      )
    END AS anon_select_denied
  FROM expected
  LEFT JOIN pg_class
    ON pg_class.oid = to_regclass(format('public.%I', expected.table_name))
),
policies AS (
  SELECT roles
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (SELECT table_name FROM expected)
),
results AS (
SELECT
  (SELECT count(*) = 15 AND bool_and(table_exists) FROM actual)
    AS all_tables_exist,
  (SELECT bool_and(rls_enabled) FROM actual)
    AS all_rls_enabled,
  (SELECT bool_and(anon_select_denied) FROM actual)
    AS anon_select_denied,
  (SELECT count(*) = 43 FROM policies)
    AS expected_policy_count,
  (SELECT bool_and(roles = ARRAY['authenticated']::name[]) FROM policies)
    AS authenticated_only,
  to_regprocedure('public.current_employee_id()') IS NOT NULL
    AS has_current_employee_id,
  to_regprocedure('public.current_employee_role()') IS NOT NULL
    AS has_current_employee_role,
  to_regprocedure('public.can_access_employee(uuid)') IS NOT NULL
    AS has_employee_scope,
  to_regprocedure('public.can_access_project(uuid)') IS NOT NULL
    AS has_project_scope,
  to_regprocedure('public.can_manage_project(uuid)') IS NOT NULL
    AS has_project_management_scope,
  to_regprocedure('public.can_access_work_entry(uuid)') IS NOT NULL
    AS has_work_entry_scope,
  to_regprocedure('public.can_view_people_directory()') IS NOT NULL
    AND to_regprocedure('public.can_manage_people()') IS NOT NULL
    AND to_regprocedure(
      'public.create_employee_profile(text,text,text,text,text,text,uuid,date,text)'
    ) IS NOT NULL
    AND to_regprocedure(
      'public.update_employee_profile(uuid,text,text,text,text,text,text,uuid,date,text)'
    ) IS NOT NULL
    AND NOT has_table_privilege(
      'authenticated',
      'public.employees',
      'INSERT'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'public.employees',
      'DELETE'
    ) AS has_controlled_people_directory,
  to_regprocedure('public.can_access_admin_settings()') IS NOT NULL
    AND NOT has_function_privilege(
      'anon',
      'public.can_access_admin_settings()',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.can_access_admin_settings()',
      'EXECUTE'
    ) AS has_admin_settings_boundary,
  to_regprocedure(
    'public.activity_administration_overview()'
  ) IS NOT NULL
    AND to_regprocedure(
      'public.update_activity_definition(uuid,text,text)'
    ) IS NOT NULL
    AND NOT has_function_privilege(
      'anon',
      'public.activity_administration_overview()',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.activity_administration_overview()',
      'EXECUTE'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'public.activities',
      'INSERT'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'public.activities',
      'UPDATE'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'public.activities',
      'DELETE'
    ) AS has_controlled_activity_administration,
  to_regprocedure(
    'public.switch_work_session(uuid,uuid,text)'
  ) IS NOT NULL AS has_atomic_work_session_switch,
  to_regprocedure(
    'public.current_work_day_requirements()'
  ) IS NOT NULL
    AND to_regprocedure(
      'public.start_work_day(uuid,uuid,text,text)'
    ) IS NOT NULL
    AND to_regprocedure(
      'public.end_work_day(uuid,text)'
    ) IS NOT NULL AS has_daily_report_workflow,
  to_regprocedure(
    'public.app_current_date(timestamptz)'
  ) IS NOT NULL
    AND to_regprocedure(
      'public.app_day_start(date)'
    ) IS NOT NULL
    AND to_regprocedure(
      'public.app_clock_time(timestamptz)'
    ) IS NOT NULL AS has_kolkata_time_standard,
  to_regprocedure(
    'public.set_daily_report_requirements(uuid,boolean,boolean)'
  ) IS NOT NULL AS has_daily_report_requirements_control,
  to_regprocedure(
    'public.live_work_status()'
  ) IS NOT NULL
    AND NOT has_function_privilege(
      'anon',
      'public.live_work_status()',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.live_work_status()',
      'EXECUTE'
    ) AS has_scoped_live_work_status,
  to_regprocedure(
    'public.personal_timesheet_entries(timestamptz,timestamptz)'
  ) IS NOT NULL
    AND NOT has_function_privilege(
      'anon',
      'public.personal_timesheet_entries(timestamptz,timestamptz)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.personal_timesheet_entries(timestamptz,timestamptz)',
      'EXECUTE'
    ) AS has_scoped_personal_timesheet,
  to_regprocedure(
    'public.timesheet_scope_members(text)'
  ) IS NOT NULL
    AND to_regprocedure(
      'public.scoped_timesheet_entries(timestamptz,timestamptz,text,uuid)'
    ) IS NOT NULL
    AND NOT has_function_privilege(
      'anon',
      'public.timesheet_scope_members(text)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.scoped_timesheet_entries(timestamptz,timestamptz,text,uuid)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.timesheet_scope_members(text)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.scoped_timesheet_entries(timestamptz,timestamptz,text,uuid)',
      'EXECUTE'
    ) AS has_role_scoped_timesheets,
  to_regprocedure(
    'public.create_manual_work_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,text)'
  ) IS NOT NULL
    AND to_regprocedure(
      'public.correct_work_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,text)'
    ) IS NOT NULL AS has_audited_work_entry_corrections,
  to_regprocedure(
    'public.manual_time_entry_contexts(uuid)'
  ) IS NOT NULL
    AND to_regprocedure(
      'public.create_manual_time_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,text)'
    ) IS NOT NULL
    AND to_regprocedure(
      'public.correct_manual_time_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,text)'
    ) IS NOT NULL
    AND NOT has_function_privilege(
      'anon',
      'public.manual_time_entry_contexts(uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
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
      'public.manual_time_entry_contexts(uuid)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.create_manual_time_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,text)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.correct_manual_time_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,text)',
      'EXECUTE'
    ) AS has_manual_time_entry_workflow,
  to_regprocedure(
    'public.work_entry_change_history(uuid)'
  ) IS NOT NULL
    AND NOT has_function_privilege(
      'anon',
      'public.work_entry_change_history(uuid)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.work_entry_change_history(uuid)',
      'EXECUTE'
    ) AS has_scoped_change_history,
  NOT EXISTS (
    SELECT 1
    FROM public.employees employee
    LEFT JOIN public.employee_work_settings settings
      ON settings.employee_id = employee.id
    WHERE settings.employee_id IS NULL
  ) AS all_employees_have_work_settings,
  NOT has_table_privilege(
    'authenticated',
    'public.employee_work_settings',
    'INSERT'
  )
    AND NOT has_table_privilege(
      'authenticated',
      'public.employee_work_settings',
      'UPDATE'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'public.employee_work_settings',
      'DELETE'
    ) AS direct_work_settings_writes_denied,
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.daily_reports'::regclass
      AND tgname = 'daily_reports_guard_write'
      AND NOT tgisinternal
  ) AS daily_report_timestamp_guard,
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.work_entry_audit'::regclass
      AND tgname = 'work_entry_audit_prevent_mutation'
      AND NOT tgisinternal
  ) AS work_entry_audit_immutable,
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.daily_report_settings_audit'::regclass
      AND tgname = 'daily_report_settings_audit_prevent_mutation'
      AND NOT tgisinternal
  ) AS daily_report_settings_audit_immutable,
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
    ) AS direct_work_entry_audit_writes_denied,
  NOT has_table_privilege(
    'authenticated',
    'public.daily_report_settings_audit',
    'INSERT'
  )
    AND NOT has_table_privilege(
      'authenticated',
      'public.daily_report_settings_audit',
      'UPDATE'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'public.daily_report_settings_audit',
      'DELETE'
    ) AS direct_daily_report_settings_audit_writes_denied,
  (
    SELECT count(*) = 5
    FROM public.activities
    WHERE name IN (
      'Pre-sales',
      'Proposal making',
      'Estimation',
      'Demo video making',
      'Marketing material making'
    )
  ) AS expected_seed_activities,
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.work_entries'::regclass
      AND contype = 'x'
  ) AS work_entry_overlap_guard,
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.break_entries'::regclass
      AND contype = 'x'
  ) AS break_overlap_guard
)
SELECT
  (
    SELECT bool_and(check_value::boolean)
    FROM results result
    CROSS JOIN LATERAL jsonb_each_text(to_jsonb(result)) check_item(
      check_name,
      check_value
    )
  ) AS all_checks_pass,
  to_jsonb(result) AS checks
FROM results result;

ROLLBACK;
