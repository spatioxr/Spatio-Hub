-- HRMS-034 rollback-only core leave workflow and scope verification.
-- Expected result: all_checks_pass is true.

BEGIN;

CREATE TEMP TABLE hrms_034_actors (
  actor_name TEXT PRIMARY KEY,
  employee_id UUID NOT NULL,
  auth_id UUID NOT NULL
);

WITH actor_seed(actor_name, emp_code, email, role) AS (
  VALUES
    ('employee', 'HRMS034EMP', 'hrms-034-employee@example.invalid', 'employee'),
    ('manager', 'HRMS034ADMIN', 'hrms-034-manager@example.invalid', 'manager'),
    ('superadmin', 'HRMS034SUPER', 'hrms-034-super@example.invalid', 'superadmin')
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
    'HRMS-034 ' || initcap(actor.actor_name),
    actor.email,
    'HRMS-034 Verification',
    actor.role,
    'Active'
  FROM actor_seed actor
  JOIN inserted_auth auth_user ON auth_user.email = actor.email
  RETURNING id, auth_id, emp_code
)
INSERT INTO hrms_034_actors (actor_name, employee_id, auth_id)
SELECT
  CASE employee.emp_code
    WHEN 'HRMS034EMP' THEN 'employee'
    WHEN 'HRMS034ADMIN' THEN 'manager'
    ELSE 'superadmin'
  END,
  employee.id,
  employee.auth_id
FROM inserted_employees employee;

GRANT SELECT ON hrms_034_actors TO authenticated;

INSERT INTO public.leave_balances (employee_id)
SELECT employee_id
FROM hrms_034_actors;

CREATE TEMP TABLE hrms_034_guards (
  overlapping_submit_blocked BOOLEAN NOT NULL DEFAULT false,
  overlapping_edit_blocked BOOLEAN NOT NULL DEFAULT false,
  manager_decision_blocked BOOLEAN NOT NULL DEFAULT false,
  manager_organisation_read_blocked BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO hrms_034_guards DEFAULT VALUES;
GRANT SELECT, UPDATE ON hrms_034_guards TO authenticated;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_034_actors
WHERE actor_name = 'employee';

SET LOCAL ROLE authenticated;

CREATE TEMP TABLE hrms_034_half_day AS
SELECT submitted.*
FROM public.submit_leave_request(
  'Sick Leave',
  DATE '2099-06-01',
  DATE '2099-06-01',
  true,
  ' Exact half day '
) submitted;

CREATE TEMP TABLE hrms_034_pending AS
SELECT submitted.*
FROM public.submit_leave_request(
  'Casual Leave',
  DATE '2099-06-03',
  DATE '2099-06-03',
  false,
  'Non-overlapping request'
) submitted;

DO $$
BEGIN
  BEGIN
    PERFORM public.submit_leave_request(
      'Sick Leave',
      DATE '2099-06-01',
      DATE '2099-06-02',
      false,
      'Must overlap'
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_034_guards SET overlapping_submit_blocked = true;
  END;

  BEGIN
    PERFORM public.update_pending_leave_request(
      (SELECT id FROM hrms_034_pending),
      'Casual Leave',
      DATE '2099-06-01',
      DATE '2099-06-01',
      false,
      'Edit must overlap'
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_034_guards SET overlapping_edit_blocked = true;
  END;
END
$$;

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_034_actors
WHERE actor_name = 'manager';

SET LOCAL ROLE authenticated;

UPDATE hrms_034_guards
SET manager_organisation_read_blocked = (
  SELECT count(*) = 0
  FROM public.leaves
  WHERE employee_id = (
    SELECT employee_id
    FROM hrms_034_actors
    WHERE actor_name = 'employee'
  )
);

DO $$
BEGIN
  BEGIN
    PERFORM public.decide_leave_request(
      (SELECT id FROM hrms_034_half_day),
      true,
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_034_guards SET manager_decision_blocked = true;
  END;
END
$$;

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_034_actors
WHERE actor_name = 'superadmin';

SET LOCAL ROLE authenticated;

CREATE TEMP TABLE hrms_034_super_scope AS
SELECT count(*) AS visible_employee_requests
FROM public.leaves
WHERE employee_id = (
  SELECT employee_id
  FROM hrms_034_actors
  WHERE actor_name = 'employee'
);

SELECT public.decide_leave_request(
  (SELECT id FROM hrms_034_half_day),
  true,
  NULL
);

SELECT public.decide_leave_request(
  (SELECT id FROM hrms_034_pending),
  false,
  'Not approved'
);

RESET ROLE;

WITH employee_balance AS (
  SELECT balance.*
  FROM public.leave_balances balance
  JOIN hrms_034_actors actor
    ON actor.employee_id = balance.employee_id
  WHERE actor.actor_name = 'employee'
),
checks AS (
  SELECT
    (SELECT days = 0.5 AND reason = 'Exact half day' FROM hrms_034_half_day)
      AS half_day_and_reason_are_canonical,
    (SELECT overlapping_submit_blocked FROM hrms_034_guards)
      AS overlapping_submit_is_blocked,
    (SELECT overlapping_edit_blocked FROM hrms_034_guards)
      AS overlapping_edit_is_blocked,
    (SELECT manager_decision_blocked FROM hrms_034_guards)
      AS manager_cannot_decide_leave,
    (SELECT manager_organisation_read_blocked FROM hrms_034_guards)
      AS manager_cannot_read_organisation_leave,
    (SELECT visible_employee_requests = 2 FROM hrms_034_super_scope)
      AS superadmin_sees_organisation_requests,
    (
      SELECT status = 'Approved'
      FROM public.leaves
      WHERE id = (SELECT id FROM hrms_034_half_day)
    ) AS approval_is_recorded,
    (
      SELECT status = 'Rejected' AND rejection_comment = 'Not approved'
      FROM public.leaves
      WHERE id = (SELECT id FROM hrms_034_pending)
    ) AS rejection_and_reason_are_recorded,
    (SELECT sick_leave = 11.5 AND casual_leave = 12 FROM employee_balance)
      AS only_approval_changes_balance,
    EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = 'public.leaves'::regclass
        AND tgname = 'leaves_prevent_active_overlap'
        AND NOT tgisinternal
    ) AS overlap_guard_is_installed
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
