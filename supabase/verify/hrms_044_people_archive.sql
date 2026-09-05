-- HRMS-044 rollback-only employee archive/access verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_044_archive_actors (
  actor_name TEXT PRIMARY KEY,
  employee_id UUID NOT NULL,
  auth_id UUID NOT NULL
);

WITH actor_seed(actor_name, emp_code, name, email, role) AS (
  VALUES
    ('admin', 'HRMS044ARCHADM', 'HRMS-044 Archive Admin', 'hrms-044-archive-admin@example.invalid', 'admin'),
    ('target', 'HRMS044ARCHUSR', 'HRMS-044 Archive Target', 'hrms-044-archive-target@example.invalid', 'employee')
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
    'Archive Verification',
    'Verification',
    actor.role,
    'Active'
  FROM actor_seed actor
  JOIN inserted_auth auth_user
    ON auth_user.email = actor.email
  RETURNING id, auth_id, emp_code
)
INSERT INTO hrms_044_archive_actors (actor_name, employee_id, auth_id)
SELECT
  CASE employee.emp_code
    WHEN 'HRMS044ARCHADM' THEN 'admin'
    WHEN 'HRMS044ARCHUSR' THEN 'target'
  END,
  employee.id,
  employee.auth_id
FROM inserted_employees employee;

-- Direct fixture inserts do not bootstrap balances like the People RPC.
INSERT INTO public.leave_balances (employee_id)
SELECT employee_id FROM hrms_044_archive_actors;

INSERT INTO public.activities (name, description)
VALUES ('HRMS-044 Archive Activity', 'Rollback-only archive-access fixture.');

INSERT INTO public.holidays (name, date)
VALUES ('HRMS-044 Archive Holiday', DATE '2099-08-06');

INSERT INTO public.attendance (employee_id, date, status)
SELECT employee_id, DATE '2099-08-06', 'Present'
FROM hrms_044_archive_actors
WHERE actor_name = 'target';

CREATE TEMP TABLE hrms_044_archive_results (
  check_name TEXT PRIMARY KEY,
  check_value BOOLEAN NOT NULL
);

GRANT SELECT ON hrms_044_archive_actors TO authenticated;
GRANT SELECT, INSERT ON hrms_044_archive_results TO authenticated;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_044_archive_actors
WHERE actor_name = 'admin';

SET LOCAL ROLE authenticated;

CREATE TEMP TABLE hrms_044_archived_profile AS
SELECT archived.*
FROM hrms_044_archive_actors target
CROSS JOIN LATERAL public.update_employee_profile(
  target.employee_id,
  'HRMS044ARCHUSR',
  'HRMS-044 Archive Target',
  'hrms-044-archive-target@example.invalid',
  'Archive Verification',
  'Verification',
  'employee',
  NULL,
  NULL,
  'Released'
) archived
WHERE target.actor_name = 'target';

-- Inspect retained history as owner; work-settings RLS is intentionally narrower.
RESET ROLE;

INSERT INTO hrms_044_archive_results (check_name, check_value)
SELECT
  'admin_can_archive_with_history_retained',
  archived.status = 'Released'
    AND EXISTS (
      SELECT 1
      FROM public.attendance attendance_row
      WHERE attendance_row.employee_id = archived.id
        AND attendance_row.date = DATE '2099-08-06'
    )
    AND EXISTS (
      SELECT 1
      FROM public.leave_balances balance
      WHERE balance.employee_id = archived.id
    )
    AND EXISTS (
      SELECT 1
      FROM public.employee_work_settings settings
      WHERE settings.employee_id = archived.id
    )
FROM hrms_044_archived_profile archived;

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_044_archive_actors
WHERE actor_name = 'target';

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  activity_count INTEGER;
  holiday_count INTEGER;
  own_profile_count INTEGER;
  updated_profile_count INTEGER;
  controlled_update_denied BOOLEAN := false;
BEGIN
  SELECT count(*) INTO activity_count
  FROM public.activities
  WHERE name = 'HRMS-044 Archive Activity';

  SELECT count(*) INTO holiday_count
  FROM public.holidays
  WHERE name = 'HRMS-044 Archive Holiday';

  SELECT count(*) INTO own_profile_count
  FROM public.employees
  WHERE id = (
    SELECT employee_id
    FROM hrms_044_archive_actors
    WHERE actor_name = 'target'
  );

  UPDATE public.employees
  SET avatar_url = 'https://example.invalid/archived-avatar.png'
  WHERE id = (
    SELECT employee_id
    FROM hrms_044_archive_actors
    WHERE actor_name = 'target'
  );
  GET DIAGNOSTICS updated_profile_count = ROW_COUNT;

  BEGIN
    PERFORM public.update_employee_profile(
      (SELECT employee_id FROM hrms_044_archive_actors WHERE actor_name = 'target'),
      'HRMS044ARCHUSR',
      'HRMS-044 Archive Target',
      'hrms-044-archive-target@example.invalid',
      'Archive Verification',
      'Verification',
      'employee',
      NULL,
      NULL,
      'Active'
    );
  EXCEPTION WHEN OTHERS THEN
    controlled_update_denied := true;
  END;

  INSERT INTO hrms_044_archive_results (check_name, check_value)
  VALUES (
    'archived_user_access_is_blocked',
    public.current_employee_id() IS NULL
      AND public.current_employee_role() IS NULL
      AND NOT public.is_active_employee()
      AND NOT public.can_view_people_directory()
      AND NOT public.can_manage_people()
      AND activity_count = 0
      AND holiday_count = 0
      AND own_profile_count = 1
      AND updated_profile_count = 0
      AND controlled_update_denied
  );
END
$$;

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_044_archive_actors
WHERE actor_name = 'admin';

SET LOCAL ROLE authenticated;

CREATE TEMP TABLE hrms_044_restored_profile AS
SELECT restored.*
FROM hrms_044_archive_actors target
CROSS JOIN LATERAL public.update_employee_profile(
  target.employee_id,
  'HRMS044ARCHUSR',
  'HRMS-044 Archive Target',
  'hrms-044-archive-target@example.invalid',
  'Archive Verification',
  'Verification',
  'employee',
  NULL,
  NULL,
  'Active'
) restored
WHERE target.actor_name = 'target';

INSERT INTO hrms_044_archive_results (check_name, check_value)
SELECT
  'admin_can_restore_archived_user',
  restored.status = 'Active'
    AND restored.auth_id = (
      SELECT auth_id
      FROM hrms_044_archive_actors
      WHERE actor_name = 'target'
    )
FROM hrms_044_restored_profile restored;

RESET ROLE;

INSERT INTO hrms_044_archive_results (check_name, check_value)
SELECT
  'archive_security_objects_exist',
  to_regprocedure('public.is_active_employee()') IS NOT NULL
    AND has_function_privilege(
      'authenticated',
      'public.is_active_employee()',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.is_active_employee()',
      'EXECUTE'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'activities'
        AND policyname = 'activities_select_active_employee'
        AND qual LIKE '%is_active_employee%'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'holidays'
        AND policyname = 'holidays_read_active_employee'
        AND qual LIKE '%is_active_employee%'
    );

SELECT
  bool_and(check_value) AS all_checks_pass,
  jsonb_object_agg(check_name, check_value ORDER BY check_name) AS checks
FROM hrms_044_archive_results;

ROLLBACK;
