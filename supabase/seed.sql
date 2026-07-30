-- Local-only authenticated actor used by rollback-only verification scripts.
INSERT INTO auth.users (id, email)
VALUES (
  '00000000-0000-0000-0000-000000000038',
  'hrms-local-superadmin@example.invalid'
)
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email;

INSERT INTO public.employees (
  auth_id,
  emp_code,
  name,
  email,
  department,
  role,
  status
)
VALUES (
  '00000000-0000-0000-0000-000000000038',
  'HRMSLOCAL',
  'HRMS Local Test Superadmin',
  'hrms-local-superadmin@example.invalid',
  'Verification',
  'superadmin',
  'Active'
)
ON CONFLICT (email) DO UPDATE
SET auth_id = EXCLUDED.auth_id,
    role = 'superadmin',
    status = 'Active';

INSERT INTO public.leave_balances (employee_id)
SELECT id
FROM public.employees
WHERE email = 'hrms-local-superadmin@example.invalid'
ON CONFLICT (employee_id) DO NOTHING;
