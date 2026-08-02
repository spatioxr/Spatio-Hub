-- HRMS-042 rollback-only temporary-password gate verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_042_actors (
  actor_name TEXT PRIMARY KEY,
  employee_id UUID NOT NULL,
  auth_id UUID NOT NULL
);

WITH actor_seed(actor_name, emp_code, email, must_change_password) AS (
  VALUES
    ('temporary', 'HRMS042TMP', 'hrms-042-temporary@example.invalid', true),
    ('normal', 'HRMS042NRM', 'hrms-042-normal@example.invalid', false)
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
    status,
    must_change_password,
    temporary_password_issued_at
  )
  SELECT
    auth_user.id,
    actor.emp_code,
    initcap(actor.actor_name) || ' Password User',
    actor.email,
    'HRMS-042 Verification',
    'Verification',
    'employee',
    'Active',
    actor.must_change_password,
    CASE WHEN actor.must_change_password THEN now() ELSE NULL END
  FROM actor_seed actor
  JOIN inserted_auth auth_user ON auth_user.email = actor.email
  RETURNING id, auth_id, emp_code
)
INSERT INTO hrms_042_actors (actor_name, employee_id, auth_id)
SELECT
  CASE employee.emp_code
    WHEN 'HRMS042TMP' THEN 'temporary'
    WHEN 'HRMS042NRM' THEN 'normal'
  END,
  employee.id,
  employee.auth_id
FROM inserted_employees employee;

CREATE TEMP TABLE hrms_042_results (
  check_name TEXT PRIMARY KEY,
  check_value BOOLEAN NOT NULL
);

GRANT SELECT ON hrms_042_actors TO authenticated;
GRANT SELECT, INSERT ON hrms_042_results TO authenticated;

INSERT INTO hrms_042_results VALUES (
  'temporary_password_columns_exist',
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employees'
      AND column_name = 'must_change_password'
      AND is_nullable = 'NO'
  )
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'employees'
        AND column_name = 'temporary_password_issued_at'
    )
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'employees'
        AND column_name = 'temporary_password_issued_by'
    )
);

INSERT INTO hrms_042_results VALUES (
  'all_phase1_writes_have_temporary_password_gate',
  (
    SELECT count(*) = 15
    FROM pg_trigger trigger_row
    WHERE trigger_row.tgname = 'temporary_password_write_gate'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgrelid = ANY (ARRAY[
        'public.employees'::regclass,
        'public.attendance'::regclass,
        'public.daily_reports'::regclass,
        'public.leaves'::regclass,
        'public.leave_balances'::regclass,
        'public.holidays'::regclass,
        'public.projects'::regclass,
        'public.activities'::regclass,
        'public.project_managers'::regclass,
        'public.project_members'::regclass,
        'public.work_entries'::regclass,
        'public.break_entries'::regclass,
        'public.work_entry_audit'::regclass,
        'public.employee_work_settings'::regclass,
        'public.daily_report_settings_audit'::regclass
      ])
  )
    AND NOT has_function_privilege(
      'authenticated',
      'public.prevent_temporary_password_data_write()',
      'EXECUTE'
    )
);

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_042_actors
WHERE actor_name = 'temporary';

SET LOCAL ROLE authenticated;

INSERT INTO hrms_042_results VALUES (
  'temporary_user_sees_only_own_profile',
  (SELECT count(*) = 1 FROM public.employees)
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = (
        SELECT employee_id
        FROM hrms_042_actors
        WHERE actor_name = 'temporary'
      )
        AND employee.must_change_password
    )
);

INSERT INTO hrms_042_results VALUES (
  'temporary_user_has_no_application_identity',
  public.current_employee_id() IS NULL
    AND public.current_employee_role() IS NULL
);

DO $$
DECLARE
  affected_rows INTEGER;
BEGIN
  UPDATE public.employees
  SET must_change_password = false
  WHERE id = (
    SELECT employee_id
    FROM hrms_042_actors
    WHERE actor_name = 'temporary'
  );

  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  INSERT INTO hrms_042_results VALUES (
    'temporary_user_cannot_clear_gate_directly',
    affected_rows = 0
  );
END
$$;

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_042_actors
WHERE actor_name = 'normal';

SET LOCAL ROLE authenticated;

INSERT INTO hrms_042_results VALUES (
  'normal_user_retains_application_identity',
  public.current_employee_id() = (
    SELECT employee_id
    FROM hrms_042_actors
    WHERE actor_name = 'normal'
  )
    AND public.current_employee_role() = 'employee'
);

DO $$
DECLARE
  metadata_write_denied BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE public.employees
    SET temporary_password_issued_at = now()
    WHERE id = (
      SELECT employee_id
      FROM hrms_042_actors
      WHERE actor_name = 'normal'
    );
  EXCEPTION WHEN OTHERS THEN
    metadata_write_denied := true;
  END;

  INSERT INTO hrms_042_results VALUES (
    'credential_metadata_direct_write_denied',
    metadata_write_denied
  );
END
$$;

RESET ROLE;

SELECT
  bool_and(check_value) AS all_checks_pass,
  jsonb_object_agg(check_name, check_value ORDER BY check_name) AS checks
FROM hrms_042_results;

ROLLBACK;
