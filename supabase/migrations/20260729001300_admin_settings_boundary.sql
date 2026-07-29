-- HRMS-045: role-gated Admin Settings and privileged-role boundary.
-- The settings route is UI-only; underlying controls remain protected by
-- their existing RLS and controlled functions.

BEGIN;

CREATE OR REPLACE FUNCTION public.can_access_admin_settings()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.current_employee_role() IN ('admin', 'superadmin'),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.create_employee_profile(
  employee_code TEXT,
  employee_name TEXT,
  work_email TEXT,
  employee_department TEXT,
  employee_designation TEXT,
  employee_role TEXT,
  manager_employee_id UUID,
  joining_date DATE,
  employment_status TEXT DEFAULT 'Active'
)
RETURNS public.employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role TEXT;
  normalised_email TEXT;
  created_employee public.employees;
BEGIN
  actor_role := public.current_employee_role();

  IF actor_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Only an admin or superadmin can add people';
  END IF;

  IF COALESCE(length(btrim(employee_code)), 0) = 0
    OR COALESCE(length(btrim(employee_name)), 0) = 0
    OR COALESCE(length(btrim(work_email)), 0) = 0
  THEN
    RAISE EXCEPTION 'Employee ID, name, and work email are required';
  END IF;

  normalised_email := lower(btrim(work_email));

  IF normalised_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Enter a valid work email';
  END IF;

  IF employee_role NOT IN ('employee', 'manager', 'admin', 'superadmin') THEN
    RAISE EXCEPTION 'Invalid application role';
  END IF;

  IF actor_role <> 'superadmin'
    AND employee_role IN ('admin', 'superadmin')
  THEN
    RAISE EXCEPTION 'Only a superadmin can assign privileged roles';
  END IF;

  IF employment_status NOT IN ('Active', 'On Leave', 'On Notice', 'Released') THEN
    RAISE EXCEPTION 'Invalid employment status';
  END IF;

  IF manager_employee_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.employees manager
      WHERE manager.id = manager_employee_id
        AND manager.status = 'Active'
    )
  THEN
    RAISE EXCEPTION 'Reporting manager must be an active employee';
  END IF;

  INSERT INTO public.employees (
    emp_code,
    name,
    email,
    department,
    designation,
    role,
    status,
    date_of_joining,
    reports_to
  )
  VALUES (
    upper(btrim(employee_code)),
    btrim(employee_name),
    normalised_email,
    NULLIF(btrim(employee_department), ''),
    NULLIF(btrim(employee_designation), ''),
    employee_role,
    employment_status,
    joining_date,
    manager_employee_id
  )
  RETURNING * INTO created_employee;

  INSERT INTO public.leave_balances (employee_id)
  VALUES (created_employee.id)
  ON CONFLICT (employee_id) DO NOTHING;

  RETURN created_employee;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_employee_profile(
  target_employee_id UUID,
  employee_code TEXT,
  employee_name TEXT,
  work_email TEXT,
  employee_department TEXT,
  employee_designation TEXT,
  employee_role TEXT,
  manager_employee_id UUID,
  joining_date DATE,
  employment_status TEXT
)
RETURNS public.employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  actor_role TEXT;
  existing_employee public.employees;
  normalised_email TEXT;
  saved_employee public.employees;
BEGIN
  actor_employee_id := public.current_employee_id();
  actor_role := public.current_employee_role();

  IF actor_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Only an admin or superadmin can edit people';
  END IF;

  SELECT *
  INTO existing_employee
  FROM public.employees
  WHERE id = target_employee_id
  FOR UPDATE;

  IF existing_employee.id IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF actor_role <> 'superadmin'
    AND existing_employee.role = 'superadmin'
  THEN
    RAISE EXCEPTION 'Only a superadmin can manage a superadmin profile';
  END IF;

  IF actor_role <> 'superadmin'
    AND employee_role IS DISTINCT FROM existing_employee.role
    AND (
      existing_employee.role IN ('admin', 'superadmin')
      OR employee_role IN ('admin', 'superadmin')
    )
  THEN
    RAISE EXCEPTION 'Only a superadmin can grant or remove privileged roles';
  END IF;

  IF target_employee_id = actor_employee_id
    AND employment_status <> 'Active'
  THEN
    RAISE EXCEPTION 'You cannot deactivate your own profile';
  END IF;

  IF COALESCE(length(btrim(employee_code)), 0) = 0
    OR COALESCE(length(btrim(employee_name)), 0) = 0
    OR COALESCE(length(btrim(work_email)), 0) = 0
  THEN
    RAISE EXCEPTION 'Employee ID, name, and work email are required';
  END IF;

  normalised_email := lower(btrim(work_email));

  IF normalised_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Enter a valid work email';
  END IF;

  IF employee_role NOT IN ('employee', 'manager', 'admin', 'superadmin') THEN
    RAISE EXCEPTION 'Invalid application role';
  END IF;

  IF employment_status NOT IN ('Active', 'On Leave', 'On Notice', 'Released') THEN
    RAISE EXCEPTION 'Invalid employment status';
  END IF;

  IF manager_employee_id = target_employee_id THEN
    RAISE EXCEPTION 'An employee cannot report to themselves';
  END IF;

  IF manager_employee_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.employees manager
      WHERE manager.id = manager_employee_id
        AND manager.status = 'Active'
    )
  THEN
    RAISE EXCEPTION 'Reporting manager must be an active employee';
  END IF;

  UPDATE public.employees
  SET emp_code = upper(btrim(employee_code)),
      name = btrim(employee_name),
      email = normalised_email,
      department = NULLIF(btrim(employee_department), ''),
      designation = NULLIF(btrim(employee_designation), ''),
      role = employee_role,
      status = employment_status,
      date_of_joining = joining_date,
      reports_to = manager_employee_id
  WHERE id = target_employee_id
  RETURNING * INTO saved_employee;

  RETURN saved_employee;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_admin_settings()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_admin_settings()
  TO authenticated;

COMMIT;
