-- HRMS-033 rollback-only leave balance correctness verification.
-- Expected result: all_checks_pass is true.

BEGIN;

CREATE TEMP TABLE hrms_033_actors (
  actor_name TEXT PRIMARY KEY,
  employee_id UUID NOT NULL,
  auth_id UUID NOT NULL
);

WITH actor_seed(actor_name, emp_code, email, role) AS (
  VALUES
    ('employee', 'HRMS033EMP', 'hrms-033-employee@example.invalid', 'employee'),
    ('superadmin', 'HRMS033SUPER', 'hrms-033-super@example.invalid', 'superadmin')
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
    'HRMS-033 ' || initcap(actor.actor_name),
    actor.email,
    'HRMS-033 Verification',
    actor.role,
    'Active'
  FROM actor_seed actor
  JOIN inserted_auth auth_user ON auth_user.email = actor.email
  RETURNING id, auth_id, emp_code
)
INSERT INTO hrms_033_actors (actor_name, employee_id, auth_id)
SELECT
  CASE employee.emp_code
    WHEN 'HRMS033EMP' THEN 'employee'
    ELSE 'superadmin'
  END,
  employee.id,
  employee.auth_id
FROM inserted_employees employee;

GRANT SELECT ON hrms_033_actors TO authenticated;

INSERT INTO public.leave_balances (employee_id)
SELECT employee_id
FROM hrms_033_actors;

CREATE TEMP TABLE hrms_033_guards (
  repeated_rejection_blocked BOOLEAN NOT NULL DEFAULT false,
  repeated_approval_blocked BOOLEAN NOT NULL DEFAULT false,
  direct_leave_update_denied BOOLEAN NOT NULL DEFAULT false,
  direct_balance_update_denied BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO hrms_033_guards DEFAULT VALUES;
GRANT SELECT, UPDATE ON hrms_033_guards TO authenticated;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_033_actors
WHERE actor_name = 'employee';

CREATE TEMP TABLE hrms_033_rejected_request AS
SELECT submitted.*
FROM public.submit_leave_request(
  'Sick Leave',
  DATE '2099-05-01',
  DATE '2099-05-02',
  false,
  'Submit, edit to half day, then reject.'
) submitted;

CREATE TEMP TABLE hrms_033_edited_request AS
SELECT updated.*
FROM hrms_033_rejected_request request
CROSS JOIN LATERAL public.update_pending_leave_request(
  request.id,
  'Sick Leave',
  DATE '2099-05-01',
  DATE '2099-05-01',
  true,
  'Edited half-day request.'
) updated;

CREATE TEMP TABLE hrms_033_approved_request AS
SELECT submitted.*
FROM public.submit_leave_request(
  'Sick Leave',
  DATE '2099-05-04',
  DATE '2099-05-05',
  false,
  'Approve exactly once.'
) submitted;

CREATE TEMP TABLE hrms_033_half_day_request AS
SELECT submitted.*
FROM public.submit_leave_request(
  'Sick Leave',
  DATE '2099-05-06',
  DATE '2099-05-06',
  true,
  'Approve an exact half day.'
) submitted;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_033_actors
WHERE actor_name = 'superadmin';

SELECT public.decide_leave_request(id, false, 'Not approved.')
FROM hrms_033_rejected_request;

DO $$
DECLARE
  request_id UUID;
BEGIN
  SELECT id INTO request_id FROM hrms_033_rejected_request;
  BEGIN
    PERFORM public.decide_leave_request(request_id, false, 'Repeated click.');
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_033_guards SET repeated_rejection_blocked = true;
  END;
END
$$;

SELECT public.decide_leave_request(id, true, NULL)
FROM hrms_033_approved_request;

DO $$
DECLARE
  request_id UUID;
BEGIN
  SELECT id INTO request_id FROM hrms_033_approved_request;
  BEGIN
    PERFORM public.decide_leave_request(request_id, true, NULL);
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_033_guards SET repeated_approval_blocked = true;
  END;
END
$$;

SELECT public.decide_leave_request(id, true, NULL)
FROM hrms_033_half_day_request;

CREATE TEMP TABLE hrms_033_superadmin_request AS
SELECT submitted.*
FROM public.submit_leave_request(
  'Casual Leave',
  DATE '2099-05-07',
  DATE '2099-05-07',
  false,
  'Privileged users still require an independent decision.'
) submitted;

SELECT public.grant_comp_off_balance(
  (SELECT employee_id FROM hrms_033_actors WHERE actor_name = 'employee'),
  1.5
);

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  target_employee_id UUID;
BEGIN
  SELECT actor.employee_id
  INTO target_employee_id
  FROM hrms_033_actors actor
  WHERE actor.actor_name = 'employee';

  UPDATE public.leaves
  SET status = 'Approved'
  WHERE employee_id = target_employee_id;
  IF NOT FOUND THEN
    UPDATE hrms_033_guards SET direct_leave_update_denied = true;
  END IF;

  UPDATE public.leave_balances
  SET sick_leave = 0
  WHERE public.leave_balances.employee_id = target_employee_id;
  IF NOT FOUND THEN
    UPDATE hrms_033_guards SET direct_balance_update_denied = true;
  END IF;
END
$$;

RESET ROLE;

WITH employee_balance AS (
  SELECT balance.*
  FROM public.leave_balances balance
  JOIN hrms_033_actors actor
    ON actor.employee_id = balance.employee_id
  WHERE actor.actor_name = 'employee'
),
superadmin_balance AS (
  SELECT balance.*
  FROM public.leave_balances balance
  JOIN hrms_033_actors actor
    ON actor.employee_id = balance.employee_id
  WHERE actor.actor_name = 'superadmin'
),
checks AS (
  SELECT
    (SELECT days = 0.5 FROM hrms_033_edited_request)
      AS pending_edit_recalculates_half_day,
    (
      SELECT status = 'Rejected'
      FROM public.leaves
      WHERE id = (SELECT id FROM hrms_033_rejected_request)
    ) AS rejection_is_recorded,
    (SELECT sick_leave = 9.5 FROM employee_balance)
      AS approvals_deduct_once_with_half_day_precision,
    (SELECT casual_leave = 12 AND comp_off = 1.5 FROM employee_balance)
      AS rejection_does_not_deduct_and_grant_is_exact,
    (SELECT status = 'Pending' FROM hrms_033_superadmin_request)
      AS every_request_enters_the_hr_queue,
    (SELECT casual_leave = 12 FROM superadmin_balance)
      AS pending_privileged_request_does_not_deduct,
    (SELECT repeated_rejection_blocked FROM hrms_033_guards)
      AS repeated_rejection_is_idempotently_blocked,
    (SELECT repeated_approval_blocked FROM hrms_033_guards)
      AS repeated_approval_is_idempotently_blocked,
    (SELECT direct_leave_update_denied FROM hrms_033_guards)
      AS direct_leave_status_write_denied,
    (SELECT direct_balance_update_denied FROM hrms_033_guards)
      AS direct_balance_write_denied,
    public.requested_leave_days(
      DATE '2099-05-10',
      DATE '2099-05-12',
      false
    ) = 2 AS whole_day_duration_excludes_weekends,
    NOT has_function_privilege(
      'anon',
      'public.decide_leave_request(uuid,boolean,text)',
      'EXECUTE'
    ) AS anonymous_decision_denied
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
