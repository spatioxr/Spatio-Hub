-- HRMS-012 rollback-only behavioural verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_012_actor AS
SELECT id AS employee_id, auth_id
FROM public.employees
WHERE role = 'superadmin'
  AND status = 'Active'
  AND auth_id IS NOT NULL
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hrms_012_actor) THEN
    RAISE EXCEPTION 'An Auth-linked active superadmin is required';
  END IF;
END
$$;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_012_actor actor;

CREATE TEMP TABLE hrms_012_employee AS
WITH inserted_employee AS (
  INSERT INTO public.employees (
    emp_code,
    name,
    email,
    role,
    status
  )
  VALUES (
    'HRMS012VERIFY',
    'HRMS-012 Verification Employee',
    'hrms-012-verify@example.invalid',
    'employee',
    'Active'
  )
  RETURNING id
)
SELECT id AS employee_id
FROM inserted_employee;

CREATE TEMP TABLE hrms_012_default_settings AS
SELECT settings.*
FROM hrms_012_employee employee
JOIN public.employee_work_settings settings
  ON settings.employee_id = employee.employee_id;

CREATE TEMP TABLE hrms_012_report AS
WITH inserted_report AS (
  INSERT INTO public.daily_reports (
    employee_id,
    date,
    bos_report,
    bos_submitted_at
  )
  SELECT
    employee.employee_id,
    DATE '2099-12-12',
    '  Verify the beginning-of-day report.  ',
    TIMESTAMPTZ '2000-01-01 00:00:00+00'
  FROM hrms_012_employee employee
  RETURNING *
)
SELECT *
FROM inserted_report;

DO $$
DECLARE
  target_employee_id UUID;
  duplicate_report_blocked BOOLEAN := false;
BEGIN
  SELECT employee_id
  INTO target_employee_id
  FROM hrms_012_employee;

  BEGIN
    INSERT INTO public.daily_reports (
      employee_id,
      date,
      eod_report
    )
    VALUES (
      target_employee_id,
      DATE '2099-12-12',
      'A duplicate employee/date row must be rejected.'
    );
  EXCEPTION
    WHEN unique_violation THEN
      duplicate_report_blocked := true;
  END;

  IF NOT duplicate_report_blocked THEN
    RAISE EXCEPTION 'Duplicate daily report was not blocked';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_012_timestamp_before AS
SELECT bos_submitted_at
FROM hrms_012_report;

CREATE TEMP TABLE hrms_012_timestamp_after AS
WITH updated_report AS (
  UPDATE public.daily_reports report
  SET bos_submitted_at = TIMESTAMPTZ '2001-01-01 00:00:00+00',
      eod_report = '  Verify the end-of-day report.  ',
      eod_submitted_at = TIMESTAMPTZ '2002-01-01 00:00:00+00'
  FROM hrms_012_report inserted_report
  WHERE report.id = inserted_report.id
  RETURNING report.*
)
SELECT *
FROM updated_report;

CREATE TEMP TABLE hrms_012_optional_settings AS
SELECT saved.*
FROM hrms_012_employee employee
CROSS JOIN LATERAL public.set_daily_report_requirements(
  employee.employee_id,
  false,
  true
) AS saved;

CREATE TEMP TABLE hrms_012_eod_optional_settings AS
SELECT saved.*
FROM hrms_012_employee employee
CROSS JOIN LATERAL public.set_daily_report_requirements(
  employee.employee_id,
  true,
  false
) AS saved;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', gen_random_uuid()::text,
    'role', 'authenticated'
  )::text,
  true
);

DO $$
DECLARE
  target_employee_id UUID;
  non_superadmin_blocked BOOLEAN := false;
BEGIN
  SELECT employee_id
  INTO target_employee_id
  FROM hrms_012_employee;

  BEGIN
    PERFORM public.set_daily_report_requirements(
      target_employee_id,
      true,
      false
    );
  EXCEPTION
    WHEN OTHERS THEN
      non_superadmin_blocked := true;
  END;

  IF NOT non_superadmin_blocked THEN
    RAISE EXCEPTION 'A non-superadmin changed BOS/EOD requirements';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_012_results AS
SELECT
  NOT EXISTS (
    SELECT 1
    FROM public.employees employee
    LEFT JOIN public.employee_work_settings settings
      ON settings.employee_id = employee.id
    WHERE settings.employee_id IS NULL
  ) AS every_employee_has_settings,
  default_settings.bos_required
    AND default_settings.eod_required
    AS requirements_default_mandatory,
  inserted_report.bos_report = 'Verify the beginning-of-day report.'
    AS bos_content_normalised,
  inserted_report.bos_submitted_at > TIMESTAMPTZ '2000-01-01 00:00:00+00'
    AS insert_timestamp_server_controlled,
  updated_report.bos_submitted_at = timestamp_before.bos_submitted_at
    AS unchanged_bos_timestamp_preserved,
  updated_report.eod_report = 'Verify the end-of-day report.'
    AND updated_report.eod_submitted_at > TIMESTAMPTZ '2002-01-01 00:00:00+00'
    AS eod_timestamp_server_controlled,
  NOT optional_settings.bos_required
    AND optional_settings.eod_required
    AS superadmin_can_make_bos_optional,
  eod_optional_settings.bos_required
    AND NOT eod_optional_settings.eod_required
    AS superadmin_can_make_eod_optional,
  optional_settings.updated_by = actor.employee_id
    AND eod_optional_settings.updated_by = actor.employee_id
    AS settings_actor_stamped,
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.daily_reports'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) =
        'UNIQUE (employee_id, date)'
  ) AS employee_date_unique,
  (
    SELECT count(*) = 3
    FROM pg_trigger
    WHERE tgrelid IN (
      'public.daily_reports'::regclass,
      'public.employees'::regclass
    )
      AND tgname IN (
        'daily_reports_guard_write',
        'employees_create_default_work_settings',
        'guard_employee_self_update'
      )
      AND NOT tgisinternal
  ) AS report_setting_triggers_exist,
  to_regprocedure(
    'public.set_daily_report_requirements(uuid,boolean,boolean)'
  ) IS NOT NULL AS settings_rpc_exists,
  NOT has_table_privilege(
    'authenticated',
    'public.employee_work_settings',
    'INSERT'
  )
    AND NOT has_table_privilege(
      'authenticated',
      'public.employee_work_settings',
      'UPDATE'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'public.employee_work_settings',
      'DELETE'
    ) AS direct_settings_writes_denied
FROM hrms_012_default_settings default_settings
CROSS JOIN hrms_012_report inserted_report
CROSS JOIN hrms_012_timestamp_before timestamp_before
CROSS JOIN hrms_012_timestamp_after updated_report
CROSS JOIN hrms_012_optional_settings optional_settings
CROSS JOIN hrms_012_eod_optional_settings eod_optional_settings
CROSS JOIN hrms_012_actor actor;

SELECT
  (
    SELECT bool_and(check_value::boolean)
    FROM hrms_012_results result
    CROSS JOIN LATERAL jsonb_each_text(to_jsonb(result)) check_item(
      check_name,
      check_value
    )
  ) AS all_checks_pass,
  to_jsonb(result) AS checks
FROM hrms_012_results result;

ROLLBACK;
