-- HRMS-044 rollback-only People directory verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_044_actors (
  actor_name TEXT PRIMARY KEY,
  employee_id UUID NOT NULL,
  auth_id UUID NOT NULL
);

WITH actor_seed(actor_name, emp_code, name, email, role) AS (
  VALUES
    ('employee', 'HRMS044EMP', 'HRMS-044 Employee', 'hrms-044-employee@example.invalid', 'employee'),
    ('member', 'HRMS044MEM', 'HRMS-044 Team Member', 'hrms-044-member@example.invalid', 'employee'),
    ('outside', 'HRMS044OUT', 'HRMS-044 Outside', 'hrms-044-outside@example.invalid', 'employee'),
    ('manager', 'HRMS044MGR', 'HRMS-044 Manager', 'hrms-044-manager@example.invalid', 'manager'),
    ('admin', 'HRMS044ADM', 'HRMS-044 Admin', 'hrms-044-admin@example.invalid', 'admin'),
    ('superadmin', 'HRMS044SUP', 'HRMS-044 Superadmin', 'hrms-044-superadmin@example.invalid', 'superadmin')
),
inserted_auth AS (
  INSERT INTO auth.users (id, email)
  SELECT gen_random_uuid(), actor.email
  FROM actor_seed actor
  RETURNING id, email
),
inserted_employees AS (
  INSERT INTO public.employees (
    auth_id,
    emp_code,
    name,
    email,
    department,
    designation,
    role,
    status
  )
  SELECT
    auth_user.id,
    actor.emp_code,
    actor.name,
    actor.email,
    'HRMS-044 Verification',
    'Verification',
    actor.role,
    'Active'
  FROM actor_seed actor
  JOIN inserted_auth auth_user
    ON auth_user.email = actor.email
  RETURNING id, auth_id, emp_code
)
INSERT INTO hrms_044_actors (actor_name, employee_id, auth_id)
SELECT
  CASE employee.emp_code
    WHEN 'HRMS044EMP' THEN 'employee'
    WHEN 'HRMS044MEM' THEN 'member'
    WHEN 'HRMS044OUT' THEN 'outside'
    WHEN 'HRMS044MGR' THEN 'manager'
    WHEN 'HRMS044ADM' THEN 'admin'
    WHEN 'HRMS044SUP' THEN 'superadmin'
  END,
  employee.id,
  employee.auth_id
FROM inserted_employees employee;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_044_actors
WHERE actor_name = 'admin';

CREATE TEMP TABLE hrms_044_project AS
WITH inserted AS (
  INSERT INTO public.projects (code, name, description, created_by)
  VALUES (
    'HRMS044VERIFY',
    'HRMS-044 Verification Project',
    'Rollback-only People scope verification.',
    (SELECT employee_id FROM hrms_044_actors WHERE actor_name = 'admin')
  )
  RETURNING id
)
SELECT id FROM inserted;

INSERT INTO public.project_managers (project_id, employee_id, assigned_by)
SELECT
  project.id,
  manager.employee_id,
  admin.employee_id
FROM hrms_044_project project
CROSS JOIN hrms_044_actors manager
CROSS JOIN hrms_044_actors admin
WHERE manager.actor_name = 'manager'
  AND admin.actor_name = 'admin';

INSERT INTO public.project_members (project_id, employee_id, assigned_by)
SELECT
  project.id,
  member.employee_id,
  admin.employee_id
FROM hrms_044_project project
CROSS JOIN hrms_044_actors member
CROSS JOIN hrms_044_actors admin
WHERE member.actor_name = 'member'
  AND admin.actor_name = 'admin';

CREATE TEMP TABLE hrms_044_results (
  check_name TEXT PRIMARY KEY,
  check_value BOOLEAN NOT NULL
);

GRANT SELECT ON hrms_044_actors TO authenticated;
GRANT SELECT ON hrms_044_project TO authenticated;
GRANT SELECT, INSERT ON hrms_044_results TO authenticated;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_044_actors
WHERE actor_name = 'employee';

SET LOCAL ROLE authenticated;

INSERT INTO hrms_044_results (check_name, check_value)
VALUES (
  'employee_directory_denied',
  NOT public.can_view_people_directory()
  AND (
    SELECT count(*) = 1
    FROM public.employees
    WHERE id IN (SELECT employee_id FROM hrms_044_actors)
  )
);

DO $$
DECLARE
  create_denied BOOLEAN := false;
  update_denied BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.create_employee_profile(
      'HRMS044DENY',
      'Denied Person',
      'hrms-044-denied@example.invalid',
      'Verification',
      'Denied',
      'employee',
      NULL,
      DATE '2099-04-04',
      'Active'
    );
  EXCEPTION WHEN OTHERS THEN
    create_denied := true;
  END;

  BEGIN
    PERFORM public.update_employee_profile(
      (SELECT employee_id FROM hrms_044_actors WHERE actor_name = 'outside'),
      'HRMS044OUT',
      'Tampered Outside',
      'hrms-044-outside@example.invalid',
      'Verification',
      'Tampered',
      'employee',
      NULL,
      DATE '2099-04-04',
      'Active'
    );
  EXCEPTION WHEN OTHERS THEN
    update_denied := true;
  END;

  INSERT INTO hrms_044_results VALUES (
    'employee_people_writes_denied',
    create_denied AND update_denied
  );
END
$$;

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_044_actors
WHERE actor_name = 'manager';

SET LOCAL ROLE authenticated;

INSERT INTO hrms_044_results (check_name, check_value)
VALUES (
  'manager_project_team_read_only',
  public.can_view_people_directory()
  AND NOT public.can_manage_people()
  AND (
    SELECT count(*) = 2
    FROM public.employees
    WHERE id IN (SELECT employee_id FROM hrms_044_actors)
  )
  AND EXISTS (
    SELECT 1
    FROM public.employees
    WHERE id = (SELECT employee_id FROM hrms_044_actors WHERE actor_name = 'member')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.employees
    WHERE id = (SELECT employee_id FROM hrms_044_actors WHERE actor_name = 'outside')
  )
);

DO $$
DECLARE
  manager_write_denied BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.update_employee_profile(
      (SELECT employee_id FROM hrms_044_actors WHERE actor_name = 'member'),
      'HRMS044MEM',
      'Changed Team Member',
      'hrms-044-member@example.invalid',
      'Verification',
      'Changed',
      'employee',
      NULL,
      DATE '2099-04-04',
      'Active'
    );
  EXCEPTION WHEN OTHERS THEN
    manager_write_denied := true;
  END;

  INSERT INTO hrms_044_results VALUES (
    'manager_people_write_denied',
    manager_write_denied
  );
END
$$;

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_044_actors
WHERE actor_name = 'admin';

SET LOCAL ROLE authenticated;

CREATE TEMP TABLE hrms_044_admin_created AS
SELECT created.*
FROM public.create_employee_profile(
  'hrms044new',
  '  HRMS-044 New Person  ',
  'HRMS-044-NEW@EXAMPLE.INVALID',
  ' People ',
  ' Coordinator ',
  'manager',
  (SELECT employee_id FROM hrms_044_actors WHERE actor_name = 'manager'),
  DATE '2099-04-05',
  'Active'
) created;

CREATE TEMP TABLE hrms_044_admin_updated AS
SELECT updated.*
FROM hrms_044_admin_created created
CROSS JOIN LATERAL public.update_employee_profile(
  created.id,
  created.emp_code,
  'HRMS-044 Updated Person',
  created.email,
  'People',
  'People Coordinator',
  'manager',
  created.reports_to,
  created.date_of_joining,
  'Released'
) updated;

-- Inspect bootstrap records as the transaction owner because their own RLS
-- intentionally keeps leave balances and work settings out of admin reads.
RESET ROLE;

INSERT INTO hrms_044_results (check_name, check_value)
SELECT
  'admin_create_edit_deactivate',
  public.can_view_people_directory()
    AND public.can_manage_people()
    AND created.emp_code = 'HRMS044NEW'
    AND created.email = 'hrms-044-new@example.invalid'
    AND created.auth_id IS NULL
    AND updated.name = 'HRMS-044 Updated Person'
    AND updated.status = 'Released'
    AND EXISTS (
      SELECT 1
      FROM public.leave_balances balance
      WHERE balance.employee_id = created.id
    )
    AND EXISTS (
      SELECT 1
      FROM public.employee_work_settings settings
      WHERE settings.employee_id = created.id
    )
FROM hrms_044_admin_created created
CROSS JOIN hrms_044_admin_updated updated;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  escalation_denied BOOLEAN := false;
  superadmin_edit_denied BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.update_employee_profile(
      (SELECT employee_id FROM hrms_044_actors WHERE actor_name = 'member'),
      'HRMS044MEM',
      'HRMS-044 Team Member',
      'hrms-044-member@example.invalid',
      'Verification',
      'Verification',
      'superadmin',
      NULL,
      NULL,
      'Active'
    );
  EXCEPTION WHEN OTHERS THEN
    escalation_denied := true;
  END;

  BEGIN
    PERFORM public.update_employee_profile(
      (SELECT employee_id FROM hrms_044_actors WHERE actor_name = 'superadmin'),
      'HRMS044SUP',
      'Changed Superadmin',
      'hrms-044-superadmin@example.invalid',
      'Verification',
      'Verification',
      'superadmin',
      NULL,
      NULL,
      'Active'
    );
  EXCEPTION WHEN OTHERS THEN
    superadmin_edit_denied := true;
  END;

  INSERT INTO hrms_044_results VALUES (
    'admin_superadmin_boundaries',
    escalation_denied AND superadmin_edit_denied
  );
END
$$;

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_044_actors
WHERE actor_name = 'superadmin';

SET LOCAL ROLE authenticated;

CREATE TEMP TABLE hrms_044_super_created AS
SELECT created.*
FROM public.create_employee_profile(
  'HRMS044SUPERNEW',
  'HRMS-044 New Superadmin',
  'hrms-044-new-super@example.invalid',
  'Management',
  'Super Administrator',
  'superadmin',
  NULL,
  DATE '2099-04-06',
  'Active'
) created;

INSERT INTO hrms_044_results (check_name, check_value)
SELECT
  'superadmin_full_people_access',
  public.can_view_people_directory()
    AND public.can_manage_people()
    AND created.role = 'superadmin'
    AND (
      SELECT count(*) = 7
      FROM public.employees
      WHERE id IN (
        SELECT employee_id FROM hrms_044_actors
        UNION ALL
        SELECT id FROM hrms_044_super_created
      )
    )
FROM hrms_044_super_created created;

RESET ROLE;

INSERT INTO hrms_044_results (check_name, check_value)
SELECT
  'controlled_people_security_objects',
  to_regprocedure('public.can_view_people_directory()') IS NOT NULL
    AND to_regprocedure('public.can_manage_people()') IS NOT NULL
    AND to_regprocedure(
      'public.create_employee_profile(text,text,text,text,text,text,uuid,date,text)'
    ) IS NOT NULL
    AND to_regprocedure(
      'public.update_employee_profile(uuid,text,text,text,text,text,text,uuid,date,text)'
    ) IS NOT NULL
    AND NOT has_table_privilege('authenticated', 'public.employees', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.employees', 'DELETE')
    AND NOT has_function_privilege(
      'anon',
      'public.create_employee_profile(text,text,text,text,text,text,uuid,date,text)',
      'EXECUTE'
    );

SELECT
  bool_and(check_value) AS all_checks_pass,
  jsonb_object_agg(check_name, check_value ORDER BY check_name) AS checks
FROM hrms_044_results;

ROLLBACK;
