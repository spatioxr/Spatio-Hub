-- Employee private details rollback-only access verification.

BEGIN;

CREATE TEMP TABLE hrms_052_results (
  check_name TEXT PRIMARY KEY,
  check_value BOOLEAN NOT NULL
);

GRANT SELECT, INSERT ON TABLE hrms_052_results TO authenticated;

WITH fixture_auth AS (
  INSERT INTO auth.users (id, email)
  VALUES
    (gen_random_uuid(), 'hrms-052-admin@example.invalid'),
    (gen_random_uuid(), 'hrms-052-manager@example.invalid')
  RETURNING id, email
), fixture_people AS (
  INSERT INTO public.employees (auth_id, emp_code, name, email, role, status)
  SELECT
    id,
    CASE WHEN email LIKE '%admin%' THEN 'HRMS052ADM' ELSE 'HRMS052MGR' END,
    CASE WHEN email LIKE '%admin%' THEN 'HRMS-052 Admin' ELSE 'HRMS-052 Manager' END,
    email,
    CASE WHEN email LIKE '%admin%' THEN 'admin' ELSE 'manager' END,
    'Active'
  FROM fixture_auth
  RETURNING id, auth_id, role
)
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM fixture_people
WHERE role = 'admin';

SET LOCAL ROLE authenticated;

CREATE TEMP TABLE hrms_052_saved AS
SELECT details.*
FROM public.employees target
CROSS JOIN LATERAL public.upsert_employee_private_details(
  target_employee_id => target.id,
  personal_email_value => ' PRIVATE@EXAMPLE.INVALID ',
  gender_value => 'Female',
  date_of_birth_value => DATE '1992-03-04',
  marital_status_value => 'Single',
  blood_group_value => 'O+',
  address_value => 'Test address',
  qualification_value => 'BSc',
  emergency_contact_number_value => '+91 90000 00000',
  emergency_contact_name_value => 'Test Contact'
) details
WHERE target.emp_code = 'HRMS052MGR';

INSERT INTO hrms_052_results VALUES (
  'admin_can_save_and_read_private_details',
  (SELECT personal_email = 'private@example.invalid' FROM hrms_052_saved)
  AND (SELECT count(*) = 1 FROM public.employee_private_details)
);

DO $$
DECLARE
  direct_write_denied BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE public.employee_private_details SET gender = 'Changed';
  EXCEPTION WHEN insufficient_privilege THEN
    direct_write_denied := true;
  END;

  INSERT INTO hrms_052_results VALUES ('direct_write_is_denied', direct_write_denied);
END
$$;

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM public.employees
WHERE emp_code = 'HRMS052MGR';

SET LOCAL ROLE authenticated;

INSERT INTO hrms_052_results VALUES (
  'manager_cannot_read_private_details',
  (SELECT count(*) = 0 FROM public.employee_private_details)
);

DO $$
DECLARE
  function_denied BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.upsert_employee_private_details(
      target_employee_id => id,
      personal_email_value => 'changed@example.invalid'
    )
    FROM public.employees
    WHERE emp_code = 'HRMS052MGR';
  EXCEPTION WHEN OTHERS THEN
    function_denied := SQLERRM LIKE 'Only an admin or superadmin%';
  END;

  INSERT INTO hrms_052_results VALUES ('manager_function_is_denied', function_denied);
END
$$;

RESET ROLE;

INSERT INTO hrms_052_results VALUES (
  'private_details_security_objects_exist',
  to_regclass('public.employee_private_details') IS NOT NULL
  AND to_regprocedure(
    'public.upsert_employee_private_details(uuid,text,text,date,text,text,text,text,text,text)'
  ) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_private_details'
      AND column_name IN ('aadhaar_number', 'last_working_date')
  )
  AND (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.employee_private_details'::regclass
  )
  AND NOT has_table_privilege('anon', 'public.employee_private_details', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.employee_private_details', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.employee_private_details', 'UPDATE')
  AND NOT has_function_privilege(
    'anon',
    'public.upsert_employee_private_details(uuid,text,text,date,text,text,text,text,text,text)',
    'EXECUTE'
  )
);

SELECT
  bool_and(check_value) AS all_checks_pass,
  jsonb_object_agg(check_name, check_value ORDER BY check_name) AS checks
FROM hrms_052_results;

ROLLBACK;
