-- HRMS-046 extension rollback verification for Office/WFH attendance modes.
-- Expected result: all_checks_pass is true. No verification rows are retained.

BEGIN;

CREATE TEMP TABLE hrms_046_wfh_superadmin AS
SELECT id AS employee_id, auth_id
FROM public.employees
WHERE role = 'superadmin'
  AND status = 'Active'
  AND auth_id IS NOT NULL
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hrms_046_wfh_superadmin) THEN
    RAISE EXCEPTION 'An Auth-linked active superadmin is required';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_046_wfh_actor AS
WITH auth_actor AS (
  INSERT INTO auth.users (id, email)
  VALUES (gen_random_uuid(), 'hrms-046-wfh-employee@example.invalid')
  RETURNING id, email
),
employee_actor AS (
  INSERT INTO public.employees (
    auth_id,
    emp_code,
    name,
    email,
    role,
    status
  )
  SELECT
    auth_actor.id,
    'HRMS046WFH',
    'HRMS-046 WFH Employee',
    auth_actor.email,
    'employee',
    'Active'
  FROM auth_actor
  RETURNING id AS employee_id, auth_id
)
SELECT * FROM employee_actor;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::TEXT,
    'role', 'authenticated'
  )::TEXT,
  true
)
FROM hrms_046_wfh_actor actor;

CREATE TEMP TABLE hrms_046_wfh_started AS
SELECT started.*
FROM (
  SELECT id
  FROM public.activities
  WHERE archived_at IS NULL
  ORDER BY name
  LIMIT 1
) activity
CROSS JOIN LATERAL public.start_work_day(
  NULL,
  activity.id,
  'Work started',
  'Verify a WFH first start.',
  'wfh'
) started;

CREATE TEMP TABLE hrms_046_wfh_invalid_guard (
  invalid_mode_blocked BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO hrms_046_wfh_invalid_guard DEFAULT VALUES;

DO $$
BEGIN
  BEGIN
    PERFORM public.start_work_day(
      NULL,
      (SELECT activity_id FROM hrms_046_wfh_started),
      'Work started',
      NULL,
      'somewhere'
    );
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE hrms_046_wfh_invalid_guard
      SET invalid_mode_blocked = true;
  END;
END
$$;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::TEXT,
    'role', 'authenticated'
  )::TEXT,
  true
)
FROM hrms_046_wfh_superadmin actor;

CREATE TEMP TABLE hrms_046_wfh_target AS
WITH target AS (
  INSERT INTO public.employees (
    emp_code,
    name,
    email,
    role,
    status
  )
  VALUES (
    'HRMS046MODE',
    'HRMS-046 Mode Target',
    'hrms-046-mode-target@example.invalid',
    'employee',
    'Active'
  )
  RETURNING id
)
SELECT id AS employee_id
FROM target;

CREATE TEMP TABLE hrms_046_wfh_manual_entry AS
SELECT created.*
FROM hrms_046_wfh_target target
CROSS JOIN (
  SELECT id
  FROM public.activities
  WHERE archived_at IS NULL
  ORDER BY name
  LIMIT 1
) activity
CROSS JOIN LATERAL public.create_manual_time_entry(
  target.employee_id,
  NULL,
  activity.id,
  'Verify manual attendance mode.',
  TIMESTAMPTZ '2099-06-10 03:30:00+00',
  TIMESTAMPTZ '2099-06-10 05:30:00+00',
  '[]'::JSONB,
  'Add an Office entry for verification.',
  'office'
) created;

CREATE TEMP TABLE hrms_046_wfh_mode_only_correction AS
SELECT corrected.*
FROM hrms_046_wfh_manual_entry entry
CROSS JOIN LATERAL public.correct_manual_time_entry(
  entry.id,
  entry.project_id,
  entry.activity_id,
  entry.task_description,
  entry.started_at,
  entry.ended_at,
  '[]'::JSONB,
  'Correct only the daily work mode.',
  'wfh'
) corrected;

CREATE TEMP TABLE hrms_046_wfh_results AS
SELECT
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'attendance'
      AND column_name = 'work_mode'
  ) AS attendance_has_work_mode,
  EXISTS (
    SELECT 1
    FROM public.attendance attendance
    JOIN hrms_046_wfh_actor actor
      ON actor.employee_id = attendance.employee_id
    WHERE attendance.date = public.app_current_date(statement_timestamp())
      AND attendance.work_mode = 'wfh'
  ) AS first_start_records_wfh,
  guard.invalid_mode_blocked AS invalid_mode_rejected,
  EXISTS (
    SELECT 1
    FROM public.attendance attendance
    JOIN hrms_046_wfh_target target
      ON target.employee_id = attendance.employee_id
    WHERE attendance.date = DATE '2099-06-10'
      AND attendance.work_mode = 'wfh'
  ) AS manual_mode_only_correction_saved,
  EXISTS (
    SELECT 1
    FROM public.work_entry_audit audit
    JOIN hrms_046_wfh_manual_entry entry
      ON entry.id = audit.work_entry_id
    WHERE audit.change_reason = 'Correct only the daily work mode.'
      AND audit.old_record ->> 'work_mode' = 'office'
      AND audit.new_record ->> 'work_mode' = 'wfh'
  ) AS manual_mode_change_audited,
  EXISTS (
    SELECT 1
    FROM public.live_attendance_work_modes() mode
    JOIN hrms_046_wfh_actor actor
      ON actor.employee_id = mode.employee_id
    WHERE mode.work_mode = 'wfh'
  ) AS live_projection_exposes_wfh,
  EXISTS (
    SELECT 1
    FROM public.scoped_attendance_work_modes(
      DATE '2099-06-10',
      DATE '2099-06-11',
      'organisation',
      NULL
    ) mode
    JOIN hrms_046_wfh_target target
      ON target.employee_id = mode.employee_id
    WHERE mode.work_mode = 'wfh'
  ) AS timesheet_projection_exposes_wfh,
  to_regprocedure(
    'public.start_work_day(uuid,uuid,text,text,text)'
  ) IS NOT NULL
    AND to_regprocedure(
      'public.create_manual_time_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,text,text)'
    ) IS NOT NULL
    AND to_regprocedure(
      'public.correct_manual_time_entry(uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,text,text)'
    ) IS NOT NULL AS controlled_work_mode_rpcs_exist,
  NOT has_function_privilege(
    'anon',
    'public.start_work_day(uuid,uuid,text,text,text)',
    'EXECUTE'
  )
    AND has_function_privilege(
      'authenticated',
      'public.start_work_day(uuid,uuid,text,text,text)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.apply_attendance_work_mode(uuid,timestamptz,timestamptz,text)',
      'EXECUTE'
    ) AS work_mode_writes_are_controlled
FROM hrms_046_wfh_invalid_guard guard;

SELECT
  (
    SELECT bool_and(check_value::BOOLEAN)
    FROM hrms_046_wfh_results result
    CROSS JOIN LATERAL jsonb_each_text(to_jsonb(result)) check_item(
      check_name,
      check_value
    )
  ) AS all_checks_pass,
  to_jsonb(result) AS checks
FROM hrms_046_wfh_results result;

ROLLBACK;
