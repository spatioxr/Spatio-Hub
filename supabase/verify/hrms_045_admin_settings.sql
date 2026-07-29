-- HRMS-045 rollback-only Admin Settings verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_045_actors (
  actor_name TEXT PRIMARY KEY,
  employee_id UUID NOT NULL,
  auth_id UUID NOT NULL
);

WITH actor_seed(actor_name, emp_code, name, email, role) AS (
  VALUES
    ('employee', 'HRMS045EMP', 'HRMS-045 Employee', 'hrms-045-employee@example.invalid', 'employee'),
    ('manager', 'HRMS045MGR', 'HRMS-045 Manager', 'hrms-045-manager@example.invalid', 'manager'),
    ('admin', 'HRMS045ADM', 'HRMS-045 Admin', 'hrms-045-admin@example.invalid', 'admin'),
    ('superadmin', 'HRMS045SUP', 'HRMS-045 Superadmin', 'hrms-045-superadmin@example.invalid', 'superadmin')
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
    'HRMS-045 Verification',
    'Verification',
    actor.role,
    'Active'
  FROM actor_seed actor
  JOIN inserted_auth auth_user
    ON auth_user.email = actor.email
  RETURNING id, auth_id, emp_code
)
INSERT INTO hrms_045_actors (actor_name, employee_id, auth_id)
SELECT
  CASE employee.emp_code
    WHEN 'HRMS045EMP' THEN 'employee'
    WHEN 'HRMS045MGR' THEN 'manager'
    WHEN 'HRMS045ADM' THEN 'admin'
    WHEN 'HRMS045SUP' THEN 'superadmin'
  END,
  employee.id,
  employee.auth_id
FROM inserted_employees employee;

CREATE TEMP TABLE hrms_045_results (
  check_name TEXT PRIMARY KEY,
  check_value BOOLEAN NOT NULL
);

GRANT SELECT ON hrms_045_actors TO authenticated;
GRANT SELECT, INSERT ON hrms_045_results TO authenticated;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_045_actors
WHERE actor_name = 'employee';

SET LOCAL ROLE authenticated;

INSERT INTO hrms_045_results VALUES (
  'employee_admin_settings_denied',
  NOT public.can_access_admin_settings()
);

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_045_actors
WHERE actor_name = 'manager';

SET LOCAL ROLE authenticated;

INSERT INTO hrms_045_results VALUES (
  'manager_admin_settings_denied',
  NOT public.can_access_admin_settings()
);

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_045_actors
WHERE actor_name = 'admin';

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  created_employee public.employees;
  updated_employee public.employees;
  create_admin_denied BOOLEAN := false;
  promotion_denied BOOLEAN := false;
  demotion_denied BOOLEAN := false;
  superadmin_edit_denied BOOLEAN := false;
BEGIN
  created_employee := public.create_employee_profile(
    'hrms045new',
    'HRMS-045 New Employee',
    'HRMS-045-NEW@EXAMPLE.INVALID',
    'Verification',
    'Coordinator',
    'employee',
    NULL,
    DATE '2099-04-05',
    'Active'
  );

  updated_employee := public.update_employee_profile(
    created_employee.id,
    created_employee.emp_code,
    'HRMS-045 Updated Employee',
    created_employee.email,
    created_employee.department,
    'Senior Coordinator',
    'manager',
    NULL,
    created_employee.date_of_joining,
    'Active'
  );

  BEGIN
    PERFORM public.create_employee_profile(
      'HRMS045NEWADM',
      'Denied New Admin',
      'hrms-045-new-admin@example.invalid',
      'Verification',
      'Admin',
      'admin',
      NULL,
      NULL,
      'Active'
    );
  EXCEPTION WHEN OTHERS THEN
    create_admin_denied := true;
  END;

  BEGIN
    PERFORM public.update_employee_profile(
      created_employee.id,
      created_employee.emp_code,
      created_employee.name,
      created_employee.email,
      created_employee.department,
      created_employee.designation,
      'admin',
      NULL,
      created_employee.date_of_joining,
      'Active'
    );
  EXCEPTION WHEN OTHERS THEN
    promotion_denied := true;
  END;

  BEGIN
    PERFORM public.update_employee_profile(
      (SELECT employee_id FROM hrms_045_actors WHERE actor_name = 'admin'),
      'HRMS045ADM',
      'HRMS-045 Admin',
      'hrms-045-admin@example.invalid',
      'HRMS-045 Verification',
      'Verification',
      'manager',
      NULL,
      NULL,
      'Active'
    );
  EXCEPTION WHEN OTHERS THEN
    demotion_denied := true;
  END;

  BEGIN
    PERFORM public.update_employee_profile(
      (SELECT employee_id FROM hrms_045_actors WHERE actor_name = 'superadmin'),
      'HRMS045SUP',
      'Changed Superadmin',
      'hrms-045-superadmin@example.invalid',
      'HRMS-045 Verification',
      'Verification',
      'superadmin',
      NULL,
      NULL,
      'Active'
    );
  EXCEPTION WHEN OTHERS THEN
    superadmin_edit_denied := true;
  END;

  INSERT INTO hrms_045_results VALUES (
    'admin_standard_settings_access',
    public.can_access_admin_settings()
      AND created_employee.role = 'employee'
      AND updated_employee.name = 'HRMS-045 Updated Employee'
      AND updated_employee.role = 'manager'
  );

  INSERT INTO hrms_045_results VALUES (
    'admin_privileged_role_changes_denied',
    create_admin_denied
      AND promotion_denied
      AND demotion_denied
      AND superadmin_edit_denied
  );
END
$$;

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_045_actors
WHERE actor_name = 'superadmin';

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  target_employee_id UUID;
  promoted_employee public.employees;
  demoted_employee public.employees;
BEGIN
  target_employee_id := (
    SELECT employee_id
    FROM hrms_045_actors
    WHERE actor_name = 'employee'
  );

  promoted_employee := public.update_employee_profile(
    target_employee_id,
    'HRMS045EMP',
    'HRMS-045 Employee',
    'hrms-045-employee@example.invalid',
    'HRMS-045 Verification',
    'Verification',
    'admin',
    NULL,
    NULL,
    'Active'
  );

  demoted_employee := public.update_employee_profile(
    target_employee_id,
    'HRMS045EMP',
    'HRMS-045 Employee',
    'hrms-045-employee@example.invalid',
    'HRMS-045 Verification',
    'Verification',
    'employee',
    NULL,
    NULL,
    'Active'
  );

  INSERT INTO hrms_045_results VALUES (
    'superadmin_full_admin_settings_access',
    public.can_access_admin_settings()
      AND promoted_employee.role = 'admin'
      AND demoted_employee.role = 'employee'
  );
END
$$;

RESET ROLE;

INSERT INTO hrms_045_results VALUES (
  'admin_settings_security_object',
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
    )
);

SELECT
  bool_and(check_value) AS all_checks_pass,
  jsonb_object_agg(check_name, check_value ORDER BY check_name) AS checks
FROM hrms_045_results;

ROLLBACK;
