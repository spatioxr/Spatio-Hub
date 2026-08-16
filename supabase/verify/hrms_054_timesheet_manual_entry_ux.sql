-- HRMS-054 rollback-only verification for audited manual-entry voiding.

BEGIN;

CREATE TEMP TABLE hrms_054_actors AS
WITH auth_actor AS (
  INSERT INTO auth.users (id, email)
  VALUES
    (gen_random_uuid(), 'hrms-054-admin@example.invalid'),
    (gen_random_uuid(), 'hrms-054-employee@example.invalid')
  RETURNING id, email
), employee_actor AS (
  INSERT INTO public.employees (auth_id, emp_code, name, email, role, status)
  SELECT
    auth_actor.id,
    CASE WHEN auth_actor.email LIKE '%admin%' THEN 'HRMS054ADMIN' ELSE 'HRMS054EMP' END,
    CASE WHEN auth_actor.email LIKE '%admin%' THEN 'HRMS-054 Admin' ELSE 'HRMS-054 Employee' END,
    auth_actor.email,
    CASE WHEN auth_actor.email LIKE '%admin%' THEN 'admin' ELSE 'employee' END,
    'Active'
  FROM auth_actor
  RETURNING id AS employee_id, auth_id, role
)
SELECT * FROM employee_actor;

CREATE TEMP TABLE hrms_054_target AS
WITH target AS (
  INSERT INTO public.employees (emp_code, name, email, role, status)
  VALUES ('HRMS054TARGET', 'HRMS-054 Target', 'hrms-054-target@example.invalid', 'employee', 'Active')
  RETURNING id AS employee_id
)
SELECT * FROM target;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', actor.auth_id::TEXT, 'role', 'authenticated')::TEXT,
  true
)
FROM hrms_054_actors actor
WHERE actor.role = 'admin';

CREATE TEMP TABLE hrms_054_original AS
SELECT created.*
FROM hrms_054_target target
CROSS JOIN LATERAL (
  SELECT activity.id
  FROM public.activities activity
  WHERE activity.archived_at IS NULL
  ORDER BY activity.name
  LIMIT 1
) activity
CROSS JOIN LATERAL public.create_manual_time_entry(
  target.employee_id,
  NULL,
  activity.id,
  'Original manual work.',
  TIMESTAMPTZ '2099-08-12 03:30:00+00',
  TIMESTAMPTZ '2099-08-12 11:30:00+00',
  jsonb_build_array(jsonb_build_object(
    'started_at', '2099-08-12T07:30:00+00',
    'ended_at', '2099-08-12T08:00:00+00'
  )),
  'Add the original manual entry.',
  'office'
) created;

CREATE TEMP TABLE hrms_054_voided AS
SELECT voided.*
FROM hrms_054_original original
CROSS JOIN LATERAL public.void_manual_time_entry(
  original.id,
  'Incorrect duplicate entry.'
) voided;

CREATE TEMP TABLE hrms_054_replacement AS
SELECT created.*
FROM hrms_054_target target
CROSS JOIN LATERAL (
  SELECT activity.id
  FROM public.activities activity
  WHERE activity.archived_at IS NULL
  ORDER BY activity.name
  LIMIT 1
) activity
CROSS JOIN LATERAL public.create_manual_time_entry(
  target.employee_id,
  NULL,
  activity.id,
  'Replacement manual work.',
  TIMESTAMPTZ '2099-08-12 03:30:00+00',
  TIMESTAMPTZ '2099-08-12 11:30:00+00',
  '[]'::JSONB,
  'Replace the voided duplicate.',
  'office'
) created;

CREATE TEMP TABLE hrms_054_guards (
  blank_reason_blocked BOOLEAN NOT NULL DEFAULT false,
  unauthorised_void_blocked BOOLEAN NOT NULL DEFAULT false,
  voided_mutation_blocked BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO hrms_054_guards DEFAULT VALUES;

DO $$
DECLARE
  original_id UUID := (SELECT id FROM hrms_054_original);
BEGIN
  BEGIN
    PERFORM public.void_manual_time_entry(original_id, '   ');
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_054_guards SET blank_reason_blocked = true;
  END;

  BEGIN
    UPDATE public.work_entries SET task_description = 'Changed after void.'
    WHERE id = original_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_054_guards SET voided_mutation_blocked = true;
  END;
END
$$;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', actor.auth_id::TEXT, 'role', 'authenticated')::TEXT,
  true
)
FROM hrms_054_actors actor
WHERE actor.role = 'employee';

DO $$
DECLARE
  replacement_id UUID := (SELECT id FROM hrms_054_replacement);
BEGIN
  BEGIN
    PERFORM public.void_manual_time_entry(replacement_id, 'Must be denied.');
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_054_guards SET unauthorised_void_blocked = true;
  END;
END
$$;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', actor.auth_id::TEXT, 'role', 'authenticated')::TEXT,
  true
)
FROM hrms_054_actors actor
WHERE actor.role = 'admin';

WITH checks AS (
  SELECT 'void_fields_recorded' AS name,
    EXISTS (
      SELECT 1 FROM hrms_054_voided
      WHERE voided_at IS NOT NULL
        AND voided_by = (SELECT employee_id FROM hrms_054_actors WHERE role = 'admin')
        AND void_reason = 'Incorrect duplicate entry.'
    ) AS passed
  UNION ALL
  SELECT 'void_audit_immutable_record', EXISTS (
    SELECT 1
    FROM public.work_entry_audit audit
    JOIN hrms_054_original original ON original.id = audit.work_entry_id
    WHERE audit.new_record ->> 'void_reason' = 'Incorrect duplicate entry.'
  )
  UNION ALL
  SELECT 'history_labels_void', EXISTS (
    SELECT 1
    FROM hrms_054_original original
    CROSS JOIN LATERAL public.work_entry_change_history(original.id) history
    WHERE history.change_kind = 'voided'
  )
  UNION ALL
  SELECT 'voided_excluded_from_timesheet', NOT EXISTS (
    SELECT 1
    FROM public.scoped_timesheet_entries(
      TIMESTAMPTZ '2099-08-12 00:00:00+00',
      TIMESTAMPTZ '2099-08-13 00:00:00+00',
      'organisation',
      (SELECT employee_id FROM hrms_054_target)
    ) entry
    WHERE entry.work_entry_id = (SELECT id FROM hrms_054_original)
  )
  UNION ALL
  SELECT 'voided_visible_in_scoped_history', EXISTS (
    SELECT 1
    FROM public.scoped_voided_timesheet_entries(
      TIMESTAMPTZ '2099-08-12 00:00:00+00',
      TIMESTAMPTZ '2099-08-13 00:00:00+00',
      'organisation',
      (SELECT employee_id FROM hrms_054_target)
    ) entry
    WHERE entry.work_entry_id = (SELECT id FROM hrms_054_original)
      AND entry.void_reason = 'Incorrect duplicate entry.'
  )
  UNION ALL
  SELECT 'replacement_same_range_allowed', EXISTS (
    SELECT 1 FROM hrms_054_replacement
  )
  UNION ALL
  SELECT 'attendance_reconciled_to_replacement', EXISTS (
    SELECT 1
    FROM public.attendance attendance
    CROSS JOIN hrms_054_target target
    WHERE attendance.employee_id = target.employee_id
      AND attendance.date = DATE '2099-08-12'
      AND attendance.check_in = TIME '09:00'
      AND attendance.check_out = TIME '17:00'
  )
  UNION ALL
  SELECT 'blank_reason_blocked', blank_reason_blocked FROM hrms_054_guards
  UNION ALL
  SELECT 'unauthorised_void_blocked', unauthorised_void_blocked FROM hrms_054_guards
  UNION ALL
  SELECT 'voided_mutation_blocked', voided_mutation_blocked FROM hrms_054_guards
)
SELECT
  bool_and(passed) AS all_checks_pass,
  jsonb_object_agg(name, passed ORDER BY name) AS checks
FROM checks;

ROLLBACK;
