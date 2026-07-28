-- HRMS-009 rollback-only behavioural verification.
-- Expected result: every value is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_009_actor AS
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
FROM hrms_009_actor actor;

CREATE TEMP TABLE hrms_009_employees AS
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
    (
      'HRMS009MGR',
      'HRMS-009 Manager',
      'hrms009-manager@verification.invalid',
      'Verification',
      'manager',
      'Active'
    ),
    (
      'HRMS009MEMBER',
      'HRMS-009 Member',
      'hrms009-member@verification.invalid',
      'Verification',
      'employee',
      'Active'
    ),
    (
      'HRMS009SECOND',
      'HRMS-009 Second Member',
      'hrms009-second@verification.invalid',
      'Another Department',
      'employee',
      'Active'
    ),
    (
      'HRMS009OUTSIDE',
      'HRMS-009 Outside Employee',
      'hrms009-outside@verification.invalid',
      'Verification',
      'employee',
      'Active'
    )
  RETURNING id, emp_code
)
SELECT * FROM inserted;

UPDATE public.employees outside_employee
SET reports_to = actor.employee_id
FROM hrms_009_actor actor
JOIN hrms_009_employees outside_row
  ON outside_row.emp_code = 'HRMS009OUTSIDE'
WHERE outside_employee.id = outside_row.id;

CREATE TEMP TABLE hrms_009_owned_project AS
SELECT project.*
FROM hrms_009_actor actor
CROSS JOIN LATERAL public.create_project_with_manager(
  'HRMS009OWNED',
  'HRMS-009 Owned Project',
  'Rollback-only assignment verification.',
  actor.employee_id
) AS project;

CREATE TEMP TABLE hrms_009_other_project AS
SELECT project.*
FROM hrms_009_employees manager
CROSS JOIN LATERAL public.create_project_with_manager(
  'HRMS009OTHER',
  'HRMS-009 Other Project',
  'Rollback-only boundary verification.',
  manager.id
) AS project
WHERE manager.emp_code = 'HRMS009MGR';

CREATE TEMP TABLE hrms_009_admin_manager_assignment AS
SELECT assignment.*
FROM hrms_009_owned_project project
CROSS JOIN hrms_009_employees manager
CROSS JOIN LATERAL public.assign_project_manager(
  project.id,
  manager.id
) AS assignment
WHERE manager.emp_code = 'HRMS009MGR';

CREATE TEMP TABLE hrms_009_admin_assignment AS
SELECT assignment.*
FROM hrms_009_owned_project project
CROSS JOIN hrms_009_employees member
CROSS JOIN LATERAL public.assign_project_member(
  project.id,
  member.id
) AS assignment
WHERE member.emp_code = 'HRMS009MEMBER';

INSERT INTO public.project_members (
  project_id,
  employee_id
)
SELECT project.id, actor.employee_id
FROM hrms_009_owned_project project
CROSS JOIN hrms_009_actor actor;

UPDATE public.employees
SET role = 'manager'
WHERE id = (SELECT employee_id FROM hrms_009_actor);

CREATE TEMP TABLE hrms_009_manager_assignment AS
SELECT assignment.*
FROM hrms_009_owned_project project
CROSS JOIN hrms_009_employees member
CROSS JOIN LATERAL public.assign_project_member(
  project.id,
  member.id
) AS assignment
WHERE member.emp_code = 'HRMS009SECOND';

DO $$
DECLARE
  other_project_id UUID;
  outside_employee_id UUID;
  denied BOOLEAN := false;
BEGIN
  SELECT id INTO other_project_id FROM hrms_009_other_project;
  SELECT id INTO outside_employee_id
  FROM hrms_009_employees
  WHERE emp_code = 'HRMS009OUTSIDE';

  BEGIN
    PERFORM public.assign_project_member(
      other_project_id,
      outside_employee_id
    );
  EXCEPTION
    WHEN OTHERS THEN
      denied := true;
  END;

  IF NOT denied THEN
    RAISE EXCEPTION 'Manager assigned a member outside an owned project';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_009_manager_scope AS
SELECT
  public.can_access_employee(member.id) AS assigned_member_visible,
  NOT public.can_access_employee(outside_employee.id)
    AS reports_to_fallback_removed,
  public.can_access_project(owned.id) AS owned_project_visible,
  NOT public.can_access_project(other_project.id)
    AS unassigned_project_hidden
FROM hrms_009_employees member
CROSS JOIN hrms_009_employees outside_employee
CROSS JOIN hrms_009_owned_project owned
CROSS JOIN hrms_009_other_project other_project
WHERE member.emp_code = 'HRMS009MEMBER'
  AND outside_employee.emp_code = 'HRMS009OUTSIDE';

-- Switch the rollback-only actor from Manager to employee so the same verified
-- Auth identity can exercise employee project visibility. The normal profile
-- self-update guard is disabled only for this transaction-local test change.
ALTER TABLE public.employees
  DISABLE TRIGGER guard_employee_self_update;
UPDATE public.employees
SET role = 'employee'
WHERE id = (SELECT employee_id FROM hrms_009_actor);
ALTER TABLE public.employees
  ENABLE TRIGGER guard_employee_self_update;

CREATE TEMP TABLE hrms_009_employee_scope AS
SELECT
  public.can_access_project(owned.id) AS assigned_project_visible,
  NOT public.can_access_project(other_project.id)
    AS unassigned_project_hidden
FROM hrms_009_owned_project owned
CROSS JOIN hrms_009_other_project other_project;

CREATE TEMP TABLE hrms_009_results AS
SELECT
  EXISTS (
    SELECT 1
    FROM hrms_009_admin_manager_assignment
  ) AS admin_assigned_manager,
  EXISTS (
    SELECT 1
    FROM hrms_009_admin_assignment
  ) AS admin_assigned_team,
  EXISTS (
    SELECT 1
    FROM hrms_009_manager_assignment
  ) AS manager_assigned_owned_team,
  manager_scope.assigned_member_visible,
  manager_scope.reports_to_fallback_removed,
  manager_scope.owned_project_visible,
  manager_scope.unassigned_project_hidden
    AS manager_unassigned_project_hidden,
  employee_scope.assigned_project_visible,
  employee_scope.unassigned_project_hidden
    AS employee_unassigned_project_hidden,
  admin_manager.assigned_by = actor.employee_id
    AS manager_assignment_actor_stamped,
  admin_assignment.assigned_by = actor.employee_id
    AND manager_assignment.assigned_by = actor.employee_id
    AS team_assignment_actor_stamped,
  member.department = 'Verification'
    AND second_member.department = 'Another Department'
    AS department_remains_profile_derived,
  (
    SELECT count(*) = 4
    FROM pg_proc
    WHERE oid IN (
      to_regprocedure('public.assign_project_manager(uuid,uuid)'),
      to_regprocedure('public.remove_project_manager(uuid,uuid)'),
      to_regprocedure('public.assign_project_member(uuid,uuid)'),
      to_regprocedure('public.remove_project_member(uuid,uuid)')
    )
  ) AS assignment_rpcs_exist,
  (
    SELECT count(*) = 2
    FROM pg_trigger
    WHERE tgname IN (
      'project_managers_stamp_actor',
      'project_members_stamp_actor'
    )
      AND NOT tgisinternal
  ) AS assignment_stamp_guards_exist
FROM hrms_009_manager_scope manager_scope
CROSS JOIN hrms_009_employee_scope employee_scope
CROSS JOIN hrms_009_actor actor
CROSS JOIN hrms_009_admin_manager_assignment admin_manager
CROSS JOIN hrms_009_admin_assignment admin_assignment
CROSS JOIN hrms_009_manager_assignment manager_assignment
CROSS JOIN hrms_009_employees member_row
CROSS JOIN public.employees member
CROSS JOIN hrms_009_employees second_member_row
CROSS JOIN public.employees second_member
WHERE member_row.emp_code = 'HRMS009MEMBER'
  AND member.id = member_row.id
  AND second_member_row.emp_code = 'HRMS009SECOND'
  AND second_member.id = second_member_row.id;

SELECT
  (
    SELECT bool_and(check_value::boolean)
    FROM hrms_009_results result
    CROSS JOIN LATERAL jsonb_each_text(to_jsonb(result)) check_item(
      check_name,
      check_value
    )
  ) AS all_checks_pass,
  to_jsonb(result) AS checks
FROM hrms_009_results result;

ROLLBACK;
