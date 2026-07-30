-- HRMS-035 rollback-only holiday and Comp Off verification.
-- Expected result: all_checks_pass is true.

BEGIN;

CREATE TEMP TABLE hrms_035_actors (
  actor_name TEXT PRIMARY KEY,
  employee_id UUID NOT NULL,
  auth_id UUID NOT NULL
);

WITH actor_seed(actor_name, emp_code, email, role) AS (
  VALUES
    ('employee', 'HRMS035EMP', 'hrms-035-employee@example.invalid', 'employee'),
    ('admin', 'HRMS035ADMIN', 'hrms-035-admin@example.invalid', 'admin'),
    ('superadmin', 'HRMS035SUPER', 'hrms-035-super@example.invalid', 'superadmin')
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
    'HRMS-035 ' || initcap(actor.actor_name),
    actor.email,
    'HRMS-035 Verification',
    actor.role,
    'Active'
  FROM actor_seed actor
  JOIN inserted_auth auth_user ON auth_user.email = actor.email
  RETURNING id, auth_id, emp_code
)
INSERT INTO hrms_035_actors (actor_name, employee_id, auth_id)
SELECT
  CASE employee.emp_code
    WHEN 'HRMS035EMP' THEN 'employee'
    WHEN 'HRMS035ADMIN' THEN 'admin'
    ELSE 'superadmin'
  END,
  employee.id,
  employee.auth_id
FROM inserted_employees employee;

GRANT SELECT ON hrms_035_actors TO authenticated;

INSERT INTO public.leave_balances (employee_id)
SELECT employee_id
FROM hrms_035_actors;

CREATE TEMP TABLE hrms_035_holiday AS
WITH inserted AS (
  INSERT INTO public.holidays (name, date)
  VALUES ('HRMS-035 Independence Day', DATE '2099-08-15')
  RETURNING id, name, date
)
SELECT *
FROM inserted;

GRANT SELECT ON hrms_035_holiday TO authenticated;

CREATE TEMP TABLE hrms_035_checks (
  employee_reads_holiday BOOLEAN NOT NULL DEFAULT false,
  admin_reads_holiday BOOLEAN NOT NULL DEFAULT false,
  superadmin_reads_holiday BOOLEAN NOT NULL DEFAULT false,
  employee_grant_blocked BOOLEAN NOT NULL DEFAULT false,
  admin_grant_blocked BOOLEAN NOT NULL DEFAULT false,
  admin_holiday_write_blocked BOOLEAN NOT NULL DEFAULT false,
  invalid_granularity_blocked BOOLEAN NOT NULL DEFAULT false,
  repeated_deduction_blocked BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO hrms_035_checks DEFAULT VALUES;
GRANT SELECT, UPDATE ON hrms_035_checks TO authenticated;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_035_actors
WHERE actor_name = 'employee';

SET LOCAL ROLE authenticated;

UPDATE hrms_035_checks
SET employee_reads_holiday = (
  SELECT count(*) = 1
    AND min(name) = 'HRMS-035 Independence Day'
    AND min(date) = DATE '2099-08-15'
  FROM public.holidays
  WHERE id = (SELECT id FROM hrms_035_holiday)
);

DO $$
BEGIN
  BEGIN
    PERFORM public.grant_comp_off_balance(
      (SELECT employee_id FROM hrms_035_actors WHERE actor_name = 'employee'),
      1
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_035_checks SET employee_grant_blocked = true;
  END;
END
$$;

CREATE TEMP TABLE hrms_035_comp_request AS
SELECT submitted.*
FROM public.submit_leave_request(
  'Comp Off',
  DATE '2099-08-16',
  DATE '2099-08-16',
  true,
  'Use one half-day of Comp Off'
) submitted;

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_035_actors
WHERE actor_name = 'admin';

SET LOCAL ROLE authenticated;

UPDATE hrms_035_checks
SET admin_reads_holiday = (
  SELECT count(*) = 1
  FROM public.holidays
  WHERE id = (SELECT id FROM hrms_035_holiday)
);

DO $$
BEGIN
  BEGIN
    PERFORM public.grant_comp_off_balance(
      (SELECT employee_id FROM hrms_035_actors WHERE actor_name = 'employee'),
      1
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_035_checks SET admin_grant_blocked = true;
  END;

  BEGIN
    INSERT INTO public.holidays (name, date)
    VALUES ('HRMS-035 Admin Denied Holiday', DATE '2099-08-17');
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_035_checks SET admin_holiday_write_blocked = true;
  END;
END
$$;

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', auth_id::text, 'role', 'authenticated')::text,
  true
)
FROM hrms_035_actors
WHERE actor_name = 'superadmin';

SET LOCAL ROLE authenticated;

UPDATE hrms_035_checks
SET superadmin_reads_holiday = (
  SELECT count(*) = 1
  FROM public.holidays
  WHERE id = (SELECT id FROM hrms_035_holiday)
);

SELECT public.grant_comp_off_balance(
  (SELECT employee_id FROM hrms_035_actors WHERE actor_name = 'employee'),
  1.5
);

DO $$
BEGIN
  BEGIN
    PERFORM public.grant_comp_off_balance(
      (SELECT employee_id FROM hrms_035_actors WHERE actor_name = 'employee'),
      0.25
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_035_checks SET invalid_granularity_blocked = true;
  END;
END
$$;

SELECT public.decide_leave_request(
  (SELECT id FROM hrms_035_comp_request),
  true,
  NULL
);

DO $$
BEGIN
  BEGIN
    PERFORM public.decide_leave_request(
      (SELECT id FROM hrms_035_comp_request),
      true,
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_035_checks SET repeated_deduction_blocked = true;
  END;
END
$$;

RESET ROLE;

WITH employee_balance AS (
  SELECT balance.*
  FROM public.leave_balances balance
  JOIN hrms_035_actors actor
    ON actor.employee_id = balance.employee_id
  WHERE actor.actor_name = 'employee'
),
checks AS (
  SELECT
    employee_reads_holiday,
    admin_reads_holiday,
    superadmin_reads_holiday,
    employee_grant_blocked,
    admin_grant_blocked,
    admin_holiday_write_blocked,
    invalid_granularity_blocked,
    repeated_deduction_blocked,
    (
      SELECT status = 'Approved' AND type = 'Comp Off' AND days = 0.5
      FROM public.leaves
      WHERE id = (SELECT id FROM hrms_035_comp_request)
    ) AS comp_off_request_is_visible_and_approved,
    (SELECT comp_off = 1 FROM employee_balance)
      AS comp_off_grant_and_use_balance_is_exact
  FROM hrms_035_checks
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
