-- HRMS-048 rollback-only Attendance and Leave reset verification.
-- Expected result: all_checks_pass is true.

BEGIN;

CREATE TEMP TABLE hrms_048_actors (
  actor_name TEXT PRIMARY KEY,
  employee_id UUID NOT NULL,
  auth_id UUID NOT NULL
);

WITH actor_seed(actor_name, emp_code, email, role) AS (
  VALUES
    ('employee', 'HRMS048EMP', 'hrms-048-employee@example.invalid', 'employee'),
    ('leave_admin', 'HRMS048LEAVE', 'hrms-048-leave-admin@example.invalid', 'employee'),
    ('superadmin', 'HRMS048SUPER', 'hrms-048-super@example.invalid', 'superadmin')
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
    role,
    status
  )
  SELECT
    auth_user.id,
    actor.emp_code,
    'HRMS-048 ' || replace(initcap(actor.actor_name), '_', ' '),
    actor.email,
    'HRMS-048 Verification',
    actor.role,
    'Active'
  FROM actor_seed actor
  JOIN inserted_auth auth_user ON auth_user.email = actor.email
  RETURNING id, auth_id, emp_code
)
INSERT INTO hrms_048_actors (actor_name, employee_id, auth_id)
SELECT
  CASE employee.emp_code
    WHEN 'HRMS048EMP' THEN 'employee'
    WHEN 'HRMS048LEAVE' THEN 'leave_admin'
    ELSE 'superadmin'
  END,
  employee.id,
  employee.auth_id
FROM inserted_employees employee;

GRANT SELECT ON hrms_048_actors TO authenticated;

INSERT INTO public.leave_balances (employee_id)
SELECT employee_id FROM hrms_048_actors;

INSERT INTO public.holidays (name, date)
VALUES ('HRMS-048 Company Holiday', DATE '2099-09-04');

INSERT INTO public.attendance (
  employee_id,
  date,
  check_in,
  check_out,
  status,
  work_mode
)
SELECT
  employee_id,
  DATE '2099-09-01',
  TIME '10:15',
  TIME '18:15',
  'Late',
  'office'
FROM hrms_048_actors
WHERE actor_name = 'employee';

INSERT INTO public.attendance (
  employee_id,
  date,
  check_in,
  check_out,
  status,
  work_mode
)
SELECT
  employee_id,
  DATE '2099-09-01',
  TIME '10:00',
  TIME '18:00',
  'Present',
  'office'
FROM hrms_048_actors
WHERE actor_name = 'leave_admin';

CREATE TEMP TABLE hrms_048_guards (
  self_decision_blocked BOOLEAN NOT NULL DEFAULT false,
  self_adjustment_blocked BOOLEAN NOT NULL DEFAULT false,
  empty_rejection_blocked BOOLEAN NOT NULL DEFAULT false,
  direct_attendance_write_blocked BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO hrms_048_guards DEFAULT VALUES;
GRANT SELECT, UPDATE ON hrms_048_guards TO authenticated;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_048_actors
WHERE actor_name = 'superadmin';

SET LOCAL ROLE authenticated;

SELECT public.set_leave_admin_access(
  (SELECT employee_id FROM hrms_048_actors WHERE actor_name = 'leave_admin'),
  true
);

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_048_actors
WHERE actor_name = 'employee';

SET LOCAL ROLE authenticated;

CREATE TEMP TABLE hrms_048_edited_request AS
WITH submitted AS (
  SELECT *
  FROM public.submit_leave_request(
    'Sick Leave',
    DATE '2099-09-02',
    DATE '2099-09-02',
    false,
    'Initial request before editing'
  )
)
SELECT updated.*
FROM submitted request
CROSS JOIN LATERAL public.update_pending_leave_request(
  request.id,
  'Sick Leave',
  DATE '2099-09-03',
  DATE '2099-09-07',
  false,
  'Edited request excludes a holiday and weekend'
) updated;

CREATE TEMP TABLE hrms_048_rejected_request AS
SELECT *
FROM public.submit_leave_request(
  'Casual Leave',
  DATE '2099-09-09',
  DATE '2099-09-09',
  false,
  'Request used to verify a required rejection reason'
);

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_048_actors
WHERE actor_name = 'leave_admin';

SET LOCAL ROLE authenticated;

CREATE TEMP TABLE hrms_048_leave_admin_request AS
SELECT *
FROM public.submit_leave_request(
  'Casual Leave',
  DATE '2099-09-08',
  DATE '2099-09-08',
  false,
  'Leave Admin own request still needs another reviewer'
);

CREATE TEMP TABLE hrms_048_queue AS
SELECT count(*) AS request_count
FROM public.scoped_leave_requests();

DO $$
BEGIN
  BEGIN
    PERFORM public.decide_leave_request(
      (SELECT id FROM hrms_048_leave_admin_request),
      true,
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_048_guards SET self_decision_blocked = true;
  END;

  BEGIN
    PERFORM public.adjust_leave_balance(
      (SELECT employee_id FROM hrms_048_actors WHERE actor_name = 'leave_admin'),
      'Sick Leave',
      1,
      'A Leave Admin must not change their own balance'
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_048_guards SET self_adjustment_blocked = true;
  END;

  BEGIN
    PERFORM public.decide_leave_request(
      (SELECT id FROM hrms_048_rejected_request),
      false,
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_048_guards SET empty_rejection_blocked = true;
  END;
END
$$;

SELECT public.adjust_leave_balance(
  (SELECT employee_id FROM hrms_048_actors WHERE actor_name = 'employee'),
  'Casual Leave',
  1,
  'Annual HR entitlement correction'
);

SELECT public.decide_leave_request(
  (SELECT id FROM hrms_048_edited_request),
  true,
  NULL
);

SELECT public.decide_leave_request(
  (SELECT id FROM hrms_048_rejected_request),
  false,
  'Coverage is required on that date'
);

SELECT public.set_attendance_late_cutoff(TIME '10:00');

CREATE TEMP TABLE hrms_048_exact_cutoff_attendance AS
SELECT *
FROM public.scoped_attendance_month(
  DATE '2099-09-01',
  DATE '2099-10-01',
  'personal',
  (SELECT employee_id FROM hrms_048_actors WHERE actor_name = 'leave_admin')
);

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_048_actors
WHERE actor_name = 'employee';

SET LOCAL ROLE authenticated;

CREATE TEMP TABLE hrms_048_attendance AS
SELECT *
FROM public.scoped_attendance_month(
  DATE '2099-09-01',
  DATE '2099-10-01',
  'personal',
  (SELECT employee_id FROM hrms_048_actors WHERE actor_name = 'employee')
);

CREATE TEMP TABLE hrms_048_employee_scope AS
SELECT count(*) AS request_count
FROM public.scoped_leave_requests();

DO $$
BEGIN
  BEGIN
    INSERT INTO public.attendance (employee_id, date, check_in, status)
    VALUES (
      (SELECT employee_id FROM hrms_048_actors WHERE actor_name = 'employee'),
      DATE '2099-09-10',
      TIME '09:00',
      'Present'
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_048_guards SET direct_attendance_write_blocked = true;
  END;
END
$$;

RESET ROLE;

WITH employee_balance AS (
  SELECT balance.*
  FROM public.leave_balances balance
  JOIN hrms_048_actors actor ON actor.employee_id = balance.employee_id
  WHERE actor.actor_name = 'employee'
),
checks AS (
  SELECT
    (
      SELECT employee.is_leave_admin
      FROM public.employees employee
      JOIN hrms_048_actors actor ON actor.employee_id = employee.id
      WHERE actor.actor_name = 'leave_admin'
    ) AS delegated_leave_admin_is_saved,
    (
      SELECT status = 'Pending' AND days = 2
      FROM hrms_048_edited_request
    ) AS edited_request_uses_working_days,
    (
      SELECT request_count = 3 FROM hrms_048_queue
    ) AS every_request_reaches_the_leave_admin_queue,
    (
      SELECT request_count = 2 FROM hrms_048_employee_scope
    ) AS employee_request_scope_remains_own_only,
    (
      SELECT status = 'Approved'
      FROM public.leaves
      WHERE id = (SELECT id FROM hrms_048_edited_request)
    ) AS approval_is_recorded,
    (
      SELECT status = 'Rejected'
        AND rejection_comment = 'Coverage is required on that date'
      FROM public.leaves
      WHERE id = (SELECT id FROM hrms_048_rejected_request)
    ) AS rejection_reason_is_recorded,
    (SELECT sick_leave = 10 AND casual_leave = 13 FROM employee_balance)
      AS approval_and_adjustment_update_the_balance_once,
    (
      SELECT count(*) = 4
      FROM public.leave_balance_transactions ledger_entry
      JOIN hrms_048_actors actor ON actor.employee_id = ledger_entry.employee_id
      WHERE actor.actor_name = 'employee'
    ) AS immutable_ledger_explains_the_balance,
    (
      SELECT checked_in_at IS NOT NULL AND is_late = true
      FROM hrms_048_attendance
      WHERE attendance_date = DATE '2099-09-01'
    ) AS original_check_in_drives_late_status,
    (
      SELECT checked_in_at IS NOT NULL AND is_late = false
      FROM hrms_048_exact_cutoff_attendance
      WHERE attendance_date = DATE '2099-09-01'
    ) AS exact_late_cutoff_remains_on_time,
    (
      SELECT leave_fraction = 1 AND leave_type = 'Sick Leave'
      FROM hrms_048_attendance
      WHERE attendance_date = DATE '2099-09-03'
    ) AS approved_leave_is_reflected_in_attendance,
    (
      SELECT holiday_name = 'HRMS-048 Company Holiday'
        AND is_working_day = false
        AND leave_fraction = 0
      FROM hrms_048_attendance
      WHERE attendance_date = DATE '2099-09-04'
    ) AS holiday_is_not_a_working_or_leave_day,
    (SELECT self_decision_blocked FROM hrms_048_guards)
      AS leave_admin_cannot_self_approve,
    (SELECT self_adjustment_blocked FROM hrms_048_guards)
      AS leave_admin_cannot_self_adjust,
    (SELECT empty_rejection_blocked FROM hrms_048_guards)
      AS rejection_requires_a_reason,
    (SELECT direct_attendance_write_blocked FROM hrms_048_guards)
      AS attendance_is_controlled_read_only_data,
    NOT has_function_privilege(
      'anon',
      'public.scoped_attendance_month(date,date,text,uuid)',
      'EXECUTE'
    ) AS anonymous_attendance_projection_is_denied
)
SELECT
  (
    SELECT bool_and(check_value::boolean)
    FROM checks result
    CROSS JOIN LATERAL jsonb_each_text(to_jsonb(result)) item(
      check_name,
      check_value
    )
  ) AS all_checks_pass,
  to_jsonb(checks) AS checks
FROM checks;

ROLLBACK;
