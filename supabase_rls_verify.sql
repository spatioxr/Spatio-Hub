-- Read-only HRMS-004 verification. Every query should return the expected value.

BEGIN;

WITH expected(table_name) AS (
  VALUES
    ('employees'),
    ('attendance'),
    ('daily_reports'),
    ('leaves'),
    ('leave_balances'),
    ('holidays')
)
SELECT
  expected.table_name,
  COALESCE(pg_class.relrowsecurity, false) AS rls_enabled
FROM expected
LEFT JOIN pg_class
  ON pg_class.oid = format('public.%I', expected.table_name)::regclass
ORDER BY expected.table_name;

SELECT
  tablename,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'employees',
    'attendance',
    'daily_reports',
    'leaves',
    'leave_balances',
    'holidays'
  )
ORDER BY tablename, policyname;

SELECT
  table_name,
  has_table_privilege('anon', format('public.%I', table_name), 'SELECT') AS anon_can_select,
  has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT') AS authenticated_can_select
FROM (
  VALUES
    ('employees'),
    ('attendance'),
    ('daily_reports'),
    ('leaves'),
    ('leave_balances'),
    ('holidays')
) AS expected(table_name)
ORDER BY table_name;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', auth_id::text,
    'role', 'authenticated',
    'email', email
  )::text,
  true
) AS simulated_superadmin_claims
FROM public.employees
WHERE role = 'superadmin'
  AND status = 'Active'
LIMIT 1;

SELECT
  public.current_employee_role() AS current_role,
  public.is_superadmin() AS is_superadmin,
  public.has_organisation_access() AS has_organisation_access;

ROLLBACK;
