-- Feedback 17/18 rollback-only phone/contact verification.

BEGIN;

CREATE TEMP TABLE hrms_051_results (
  check_name TEXT PRIMARY KEY,
  check_value BOOLEAN NOT NULL
);

WITH inserted_auth AS (
  INSERT INTO auth.users (id, email)
  VALUES (gen_random_uuid(), 'hrms-051-admin@example.invalid')
  RETURNING id, email
), inserted_admin AS (
  INSERT INTO public.employees (auth_id, emp_code, name, email, role, status)
  SELECT id, 'HRMS051ADM', 'HRMS-051 Admin', email, 'admin', 'Active'
  FROM inserted_auth
  RETURNING id, auth_id
)
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM inserted_admin;

GRANT SELECT, INSERT ON hrms_051_results TO authenticated;

SET LOCAL ROLE authenticated;

CREATE TEMP TABLE hrms_051_created AS
SELECT created.*
FROM public.create_employee_profile(
  employee_code => 'hrms051new',
  employee_name => 'HRMS-051 Contact',
  work_email => 'HRMS-051-CONTACT@EXAMPLE.INVALID',
  employee_department => 'People',
  employee_designation => 'Coordinator',
  employee_role => 'employee',
  manager_employee_id => NULL,
  joining_date => DATE '2099-05-01',
  employment_status => 'Active',
  employee_phone_number => ' +91 98765 43210 '
) created;

CREATE TEMP TABLE hrms_051_updated AS
SELECT updated.*
FROM hrms_051_created created
CROSS JOIN LATERAL public.update_employee_profile(
  target_employee_id => created.id,
  employee_code => created.emp_code,
  employee_name => created.name,
  work_email => created.email,
  employee_department => created.department,
  employee_designation => created.designation,
  employee_role => created.role,
  manager_employee_id => created.reports_to,
  joining_date => created.date_of_joining,
  employment_status => created.status,
  employee_phone_number => '+91 90000 00000'
) updated;

INSERT INTO hrms_051_results VALUES (
  'admin_can_create_and_update_phone',
  (SELECT phone_number = '+91 98765 43210' FROM hrms_051_created)
  AND (SELECT phone_number = '+91 90000 00000' FROM hrms_051_updated)
);

DO $$
DECLARE
  invalid_phone_denied BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.update_employee_profile(
      target_employee_id => created.id,
      employee_code => created.emp_code,
      employee_name => created.name,
      work_email => created.email,
      employee_department => created.department,
      employee_designation => created.designation,
      employee_role => created.role,
      manager_employee_id => created.reports_to,
      joining_date => created.date_of_joining,
      employment_status => created.status,
      employee_phone_number => 'call-me'
    )
    FROM hrms_051_created created;
  EXCEPTION WHEN check_violation THEN
    invalid_phone_denied := true;
  END;

  INSERT INTO hrms_051_results VALUES (
    'invalid_phone_is_denied',
    invalid_phone_denied
  );
END
$$;

RESET ROLE;

INSERT INTO hrms_051_results VALUES (
  'contact_security_objects_exist',
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employees'
      AND column_name = 'phone_number'
  )
  AND to_regprocedure(
    'public.create_employee_profile(text,text,text,text,text,text,uuid,date,text,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.update_employee_profile(uuid,text,text,text,text,text,text,uuid,date,text,text)'
  ) IS NOT NULL
  AND NOT has_function_privilege(
    'anon',
    'public.update_employee_profile(uuid,text,text,text,text,text,text,uuid,date,text,text)',
    'EXECUTE'
  )
);

SELECT
  bool_and(check_value) AS all_checks_pass,
  jsonb_object_agg(check_name, check_value ORDER BY check_name) AS checks
FROM hrms_051_results;

ROLLBACK;
