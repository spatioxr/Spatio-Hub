-- HRMS-027 rollback-only Manager assignment-boundary verification.
-- Expected result: all_checks_pass and every value in checks are true.

BEGIN;

CREATE TEMP TABLE hrms_027_actor AS
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
FROM hrms_027_actor actor;

CREATE TEMP TABLE hrms_027_people AS
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
      'HRMS027MGR',
      'HRMS-027 Other Manager',
      'hrms027-manager@verification.invalid',
      'Verification',
      'manager',
      'Active'
    ),
    (
      'HRMS027OWN',
      'HRMS-027 Owned Member',
      'hrms027-owned@verification.invalid',
      'Verification',
      'employee',
      'Active'
    ),
    (
      'HRMS027OUT',
      'HRMS-027 Outside Member',
      'hrms027-outside@verification.invalid',
      'Verification',
      'employee',
      'Active'
    )
  RETURNING id, emp_code
)
SELECT * FROM inserted;

CREATE TEMP TABLE hrms_027_owned_project AS
SELECT project.*
FROM hrms_027_actor actor
CROSS JOIN LATERAL public.create_project_with_manager(
  'HRMS027OWN',
  'HRMS-027 Owned Project',
  'Rollback-only owned-project verification.',
  actor.employee_id
) AS project;

CREATE TEMP TABLE hrms_027_other_project AS
SELECT project.*
FROM hrms_027_people manager
CROSS JOIN LATERAL public.create_project_with_manager(
  'HRMS027OTHER',
  'HRMS-027 Other Project',
  'Rollback-only outside-project verification.',
  manager.id
) AS project
WHERE manager.emp_code = 'HRMS027MGR';

-- Seed an outside-project member and a second valid owner while the actor is
-- still a superadmin. The second owner permits the same Auth identity to be
-- switched to Employee later without violating the active-manager invariant.
SELECT public.assign_project_member(project.id, member.id)
FROM hrms_027_other_project project
CROSS JOIN hrms_027_people member
WHERE member.emp_code = 'HRMS027OUT';

SELECT public.assign_project_manager(project.id, manager.id)
FROM hrms_027_owned_project project
CROSS JOIN hrms_027_people manager
WHERE manager.emp_code = 'HRMS027MGR';

CREATE TEMP TABLE hrms_027_results (
  manager_added_owned_member BOOLEAN NOT NULL DEFAULT false,
  manager_removed_owned_member BOOLEAN NOT NULL DEFAULT false,
  duplicate_assignment_denied BOOLEAN NOT NULL DEFAULT false,
  manager_outside_add_denied BOOLEAN NOT NULL DEFAULT false,
  manager_outside_remove_denied BOOLEAN NOT NULL DEFAULT false,
  manager_create_denied BOOLEAN NOT NULL DEFAULT false,
  manager_archive_denied BOOLEAN NOT NULL DEFAULT false,
  manager_definition_edit_denied BOOLEAN NOT NULL DEFAULT false,
  manager_owner_assignment_denied BOOLEAN NOT NULL DEFAULT false,
  admin_override_add_allowed BOOLEAN NOT NULL DEFAULT false,
  admin_override_remove_allowed BOOLEAN NOT NULL DEFAULT false,
  employee_assignment_denied BOOLEAN NOT NULL DEFAULT false,
  employee_removal_denied BOOLEAN NOT NULL DEFAULT false,
  employee_admin_overview_hidden BOOLEAN NOT NULL DEFAULT false,
  membership_primary_key_exists BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO hrms_027_results DEFAULT VALUES;

ALTER TABLE public.employees DISABLE TRIGGER guard_employee_self_update;
UPDATE public.employees
SET role = 'manager'
WHERE id = (SELECT employee_id FROM hrms_027_actor);
ALTER TABLE public.employees ENABLE TRIGGER guard_employee_self_update;

SELECT public.assign_project_member(project.id, member.id)
FROM hrms_027_owned_project project
CROSS JOIN hrms_027_people member
WHERE member.emp_code = 'HRMS027OWN';

UPDATE hrms_027_results
SET manager_added_owned_member = EXISTS (
  SELECT 1
  FROM public.project_members assignment
  CROSS JOIN hrms_027_owned_project project
  CROSS JOIN hrms_027_people member
  WHERE assignment.project_id = project.id
    AND member.emp_code = 'HRMS027OWN'
    AND assignment.employee_id = member.id
);

DO $$
DECLARE
  owned_project_id UUID;
  other_project_id UUID;
  owned_member_id UUID;
  outside_member_id UUID;
  other_manager_id UUID;
BEGIN
  SELECT id INTO owned_project_id FROM hrms_027_owned_project;
  SELECT id INTO other_project_id FROM hrms_027_other_project;
  SELECT id INTO owned_member_id
  FROM hrms_027_people WHERE emp_code = 'HRMS027OWN';
  SELECT id INTO outside_member_id
  FROM hrms_027_people WHERE emp_code = 'HRMS027OUT';
  SELECT id INTO other_manager_id
  FROM hrms_027_people WHERE emp_code = 'HRMS027MGR';

  BEGIN
    PERFORM public.assign_project_member(owned_project_id, owned_member_id);
  EXCEPTION WHEN unique_violation THEN
    UPDATE hrms_027_results SET duplicate_assignment_denied = true;
  END;

  BEGIN
    PERFORM public.assign_project_member(other_project_id, owned_member_id);
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_027_results SET manager_outside_add_denied = true;
  END;

  BEGIN
    PERFORM public.remove_project_member(other_project_id, outside_member_id);
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_027_results SET manager_outside_remove_denied = true;
  END;

  BEGIN
    PERFORM public.create_project_with_manager(
      'HRMS027DENIED',
      'HRMS-027 Denied Project',
      'Manager creation must fail.',
      other_manager_id
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_027_results SET manager_create_denied = true;
  END;

  BEGIN
    PERFORM public.set_project_archived(owned_project_id, true);
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_027_results SET manager_archive_denied = true;
  END;

  BEGIN
    PERFORM public.update_project_definition(
      owned_project_id,
      'HRMS027EDIT',
      'HRMS-027 Denied Edit',
      'Manager definition changes must fail.'
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_027_results SET manager_definition_edit_denied = true;
  END;

  BEGIN
    PERFORM public.assign_project_manager(owned_project_id, other_manager_id);
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_027_results SET manager_owner_assignment_denied = true;
  END;
END
$$;

SELECT public.remove_project_member(project.id, member.id)
FROM hrms_027_owned_project project
CROSS JOIN hrms_027_people member
WHERE member.emp_code = 'HRMS027OWN';

UPDATE hrms_027_results
SET manager_removed_owned_member = NOT EXISTS (
  SELECT 1
  FROM public.project_members assignment
  CROSS JOIN hrms_027_owned_project project
  CROSS JOIN hrms_027_people member
  WHERE assignment.project_id = project.id
    AND member.emp_code = 'HRMS027OWN'
    AND assignment.employee_id = member.id
);

ALTER TABLE public.employees DISABLE TRIGGER guard_employee_self_update;
UPDATE public.employees
SET role = 'admin'
WHERE id = (SELECT employee_id FROM hrms_027_actor);
ALTER TABLE public.employees ENABLE TRIGGER guard_employee_self_update;

SELECT public.assign_project_member(project.id, member.id)
FROM hrms_027_other_project project
CROSS JOIN hrms_027_people member
WHERE member.emp_code = 'HRMS027OWN';

UPDATE hrms_027_results
SET admin_override_add_allowed = EXISTS (
  SELECT 1
  FROM public.project_members assignment
  CROSS JOIN hrms_027_other_project project
  CROSS JOIN hrms_027_people member
  WHERE assignment.project_id = project.id
    AND member.emp_code = 'HRMS027OWN'
    AND assignment.employee_id = member.id
);

SELECT public.remove_project_member(project.id, member.id)
FROM hrms_027_other_project project
CROSS JOIN hrms_027_people member
WHERE member.emp_code = 'HRMS027OUT';

UPDATE hrms_027_results
SET admin_override_remove_allowed = NOT EXISTS (
  SELECT 1
  FROM public.project_members assignment
  CROSS JOIN hrms_027_other_project project
  CROSS JOIN hrms_027_people member
  WHERE assignment.project_id = project.id
    AND member.emp_code = 'HRMS027OUT'
    AND assignment.employee_id = member.id
);

ALTER TABLE public.employees DISABLE TRIGGER guard_employee_self_update;
UPDATE public.employees
SET role = 'employee'
WHERE id = (SELECT employee_id FROM hrms_027_actor);
ALTER TABLE public.employees ENABLE TRIGGER guard_employee_self_update;

DO $$
DECLARE
  owned_project_id UUID;
  other_project_id UUID;
  owned_member_id UUID;
BEGIN
  SELECT id INTO owned_project_id FROM hrms_027_owned_project;
  SELECT id INTO other_project_id FROM hrms_027_other_project;
  SELECT id INTO owned_member_id
  FROM hrms_027_people WHERE emp_code = 'HRMS027OWN';

  BEGIN
    PERFORM public.assign_project_member(owned_project_id, owned_member_id);
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_027_results SET employee_assignment_denied = true;
  END;

  BEGIN
    PERFORM public.remove_project_member(other_project_id, owned_member_id);
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_027_results SET employee_removal_denied = true;
  END;
END
$$;

UPDATE hrms_027_results
SET employee_admin_overview_hidden = (
      SELECT count(*) = 0
      FROM public.project_administration_overview()
    ),
    membership_primary_key_exists = EXISTS (
      SELECT 1
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = 'public.project_members'::regclass
        AND constraint_row.contype = 'p'
        AND pg_get_constraintdef(constraint_row.oid)
          = 'PRIMARY KEY (project_id, employee_id)'
    );

SELECT
  (
    SELECT bool_and(check_value::boolean)
    FROM hrms_027_results result
    CROSS JOIN LATERAL jsonb_each_text(to_jsonb(result)) check_item(
      check_name,
      check_value
    )
  ) AS all_checks_pass,
  to_jsonb(result) AS checks
FROM hrms_027_results result;

ROLLBACK;
