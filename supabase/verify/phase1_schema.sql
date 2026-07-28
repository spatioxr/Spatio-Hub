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
    ('employee_work_settings')
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
)
SELECT
  (SELECT count(*) = 14 AND bool_and(table_exists) FROM actual)
    AS all_tables_exist,
  (SELECT bool_and(rls_enabled) FROM actual)
    AS all_rls_enabled,
  (SELECT bool_and(anon_select_denied) FROM actual)
    AS anon_select_denied,
  (SELECT count(*) = 44 FROM policies)
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
  ) AS break_overlap_guard;

ROLLBACK;
