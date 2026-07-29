-- HRMS-026 rollback-only project-administration verification.
-- Expected result: every value is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_026_actor AS
SELECT id AS employee_id, auth_id
FROM public.employees
WHERE role = 'superadmin'
  AND status = 'Active'
LIMIT 1;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_026_actor actor;

CREATE TEMP TABLE hrms_026_people AS
WITH inserted AS (
  INSERT INTO public.employees (
    emp_code,
    name,
    email,
    department,
    role,
    status
  )
  VALUES
    ('HRMS026MGR', 'HRMS-026 Manager', 'hrms026-manager@verification.invalid', 'Verification', 'manager', 'Active'),
    ('HRMS026MEM', 'HRMS-026 Member', 'hrms026-member@verification.invalid', 'Verification', 'employee', 'Active'),
    ('HRMS026OUT', 'HRMS-026 Outside Manager', 'hrms026-outside@verification.invalid', 'Verification', 'manager', 'Active')
  RETURNING id, emp_code
)
SELECT * FROM inserted;

CREATE TEMP TABLE hrms_026_owned AS
SELECT project.*
FROM hrms_026_people manager
CROSS JOIN LATERAL public.create_project_with_manager(
  'HRMS026OWN',
  'HRMS-026 Owned Project',
  'Rollback-only project administration verification.',
  manager.id
) AS project
WHERE manager.emp_code = 'HRMS026MGR';

CREATE TEMP TABLE hrms_026_other AS
SELECT project.*
FROM hrms_026_people manager
CROSS JOIN LATERAL public.create_project_with_manager(
  'HRMS026OTHER',
  'HRMS-026 Other Project',
  'Rollback-only project scope verification.',
  manager.id
) AS project
WHERE manager.emp_code = 'HRMS026OUT';

SELECT public.assign_project_member(project.id, member.id)
FROM hrms_026_owned project
CROSS JOIN hrms_026_people member
WHERE member.emp_code = 'HRMS026MEM';

CREATE TEMP TABLE hrms_026_updated AS
SELECT updated.*
FROM hrms_026_owned project
CROSS JOIN LATERAL public.update_project_definition(
  project.id,
  'hrms026edit',
  'HRMS-026 Edited Project',
  'Edited through the controlled RPC.'
) AS updated;

ALTER TABLE public.employees DISABLE TRIGGER guard_employee_self_update;
UPDATE public.employees actor
SET role = 'manager'
FROM hrms_026_people manager
WHERE actor.id = (SELECT employee_id FROM hrms_026_actor)
  AND manager.emp_code = 'HRMS026MGR';
ALTER TABLE public.employees ENABLE TRIGGER guard_employee_self_update;

INSERT INTO public.project_managers (project_id, employee_id)
SELECT project.id, actor.employee_id
FROM hrms_026_owned project
CROSS JOIN hrms_026_actor actor;

CREATE TEMP TABLE hrms_026_manager_overview AS
SELECT * FROM public.project_administration_overview();

CREATE TEMP TABLE hrms_026_manager_candidates AS
SELECT candidate.*
FROM hrms_026_owned project
CROSS JOIN LATERAL public.project_assignment_candidates(project.id) candidate;

DO $$
DECLARE
  other_project_id UUID;
  denied BOOLEAN := false;
BEGIN
  SELECT id INTO other_project_id FROM hrms_026_other;

  BEGIN
    PERFORM public.project_assignment_candidates(other_project_id);
  EXCEPTION
    WHEN OTHERS THEN denied := true;
  END;

  IF NOT denied THEN
    RAISE EXCEPTION 'Manager read candidates for an unowned project';
  END IF;
END
$$;

SELECT
  updated.code = 'HRMS026EDIT' AS definition_code_normalised,
  updated.name = 'HRMS-026 Edited Project' AS definition_updated,
  (
    SELECT count(*) = 1
    FROM hrms_026_manager_overview
  ) AS manager_sees_only_owned_project,
  (
    SELECT jsonb_array_length(managers) >= 1
      AND jsonb_array_length(members) = 1
    FROM hrms_026_manager_overview
  ) AS overview_includes_assignments,
  (
    SELECT count(*) >= 3
    FROM hrms_026_manager_candidates
  ) AS owned_project_candidates_visible,
  to_regprocedure('public.project_administration_overview()') IS NOT NULL
    AS overview_rpc_exists,
  to_regprocedure('public.project_assignment_candidates(uuid)') IS NOT NULL
    AS candidate_rpc_exists,
  to_regprocedure('public.update_project_definition(uuid,text,text,text)') IS NOT NULL
    AS update_rpc_exists
FROM hrms_026_updated updated;

ROLLBACK;
