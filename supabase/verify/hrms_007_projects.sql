-- HRMS-007 read-only behavioural verification.
-- Expected result: every value is true. The transaction is rolled back.

BEGIN;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', auth_id::text,
    'role', 'authenticated',
    'email', email
  )::text,
  true
)
FROM public.employees
WHERE role = 'superadmin'
  AND status = 'Active'
LIMIT 1;

CREATE TEMP TABLE hrms_007_project AS
WITH actor AS (
  SELECT public.current_employee_id() AS employee_id
)
SELECT project.*
FROM actor
CROSS JOIN LATERAL public.create_project_with_manager(
  'HRMS007VERIFY',
  'HRMS-007 Verification Project',
  'Rollback-only project invariant verification.',
  actor.employee_id
) AS project;

DO $$
DECLARE
  verification_project_id UUID;
  removal_blocked BOOLEAN := false;
BEGIN
  SELECT id
  INTO verification_project_id
  FROM hrms_007_project;

  BEGIN
    DELETE FROM public.project_managers
    WHERE project_id = verification_project_id;
  EXCEPTION
    WHEN OTHERS THEN
      removal_blocked := true;
  END;

  IF NOT removal_blocked THEN
    RAISE EXCEPTION 'Removing the final manager from an active project was not blocked';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_007_archived AS
SELECT project.*
FROM hrms_007_project created
CROSS JOIN LATERAL public.set_project_archived(
  created.id,
  true
) AS project;

SELECT
  created.code = 'HRMS007VERIFY' AS code_normalised,
  public.project_has_active_manager(created.id) AS has_active_manager,
  archived.archived_at IS NOT NULL AS archived,
  EXISTS (
    SELECT 1
    FROM public.projects project
    WHERE project.id = created.id
  ) AS archived_project_retained,
  to_regprocedure(
    'public.create_project_with_manager(text,text,text,uuid)'
  ) IS NOT NULL AS create_rpc_exists,
  to_regprocedure(
    'public.set_project_archived(uuid,boolean)'
  ) IS NOT NULL AS archive_rpc_exists,
  (
    SELECT count(*) = 3
    FROM pg_trigger
    WHERE tgname IN (
      'projects_require_active_manager',
      'project_manager_changes_preserve_owner',
      'employee_manager_changes_preserve_projects'
    )
      AND NOT tgisinternal
  ) AS ownership_guards_exist,
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'work_entries'
      AND policyname = 'work_entries_insert_own'
      AND with_check LIKE '%archived_at IS NULL%'
  ) AS archived_project_entry_guard_exists
FROM hrms_007_project created
CROSS JOIN hrms_007_archived archived;

ROLLBACK;
