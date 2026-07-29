-- HRMS-044: restricted People directory and controlled employee management.
-- Authentication invitations and sensitive HR records remain outside Phase 1.

BEGIN;

CREATE OR REPLACE FUNCTION public.can_view_people_directory()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.current_employee_role() IN ('manager', 'admin', 'superadmin'),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_people()
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

CREATE OR REPLACE FUNCTION public.can_access_employee(
  target_employee_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees actor
    WHERE actor.auth_id = auth.uid()
      AND actor.status = 'Active'
      AND (
        actor.id = target_employee_id
        OR actor.role IN ('admin', 'superadmin')
        OR (
          actor.role = 'manager'
          AND EXISTS (
            SELECT 1
            FROM public.project_managers manager_assignment
            JOIN public.project_members member_assignment
              ON member_assignment.project_id = manager_assignment.project_id
            WHERE manager_assignment.employee_id = actor.id
              AND member_assignment.employee_id = target_employee_id
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.guard_employee_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Controlled SECURITY DEFINER functions and trusted migration work execute
  -- as the table owner. Direct browser writes execute as authenticated.
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF OLD.auth_id IS NULL
    AND OLD.email = lower(auth.jwt() ->> 'email')
    AND NEW.auth_id = auth.uid()
    AND NEW.emp_code IS NOT DISTINCT FROM OLD.emp_code
    AND NEW.name IS NOT DISTINCT FROM OLD.name
    AND NEW.email IS NOT DISTINCT FROM OLD.email
    AND NEW.department IS NOT DISTINCT FROM OLD.department
    AND NEW.designation IS NOT DISTINCT FROM OLD.designation
    AND NEW.role IS NOT DISTINCT FROM OLD.role
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.date_of_joining IS NOT DISTINCT FROM OLD.date_of_joining
    AND NEW.managed_department IS NOT DISTINCT FROM OLD.managed_department
    AND NEW.reports_to IS NOT DISTINCT FROM OLD.reports_to
    AND NEW.avatar_url IS NOT DISTINCT FROM OLD.avatar_url
  THEN
    RETURN NEW;
  END IF;

  IF OLD.auth_id = auth.uid()
    AND NEW.auth_id IS NOT DISTINCT FROM OLD.auth_id
    AND NEW.emp_code IS NOT DISTINCT FROM OLD.emp_code
    AND NEW.name IS NOT DISTINCT FROM OLD.name
    AND NEW.email IS NOT DISTINCT FROM OLD.email
    AND NEW.department IS NOT DISTINCT FROM OLD.department
    AND NEW.designation IS NOT DISTINCT FROM OLD.designation
    AND NEW.role IS NOT DISTINCT FROM OLD.role
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.date_of_joining IS NOT DISTINCT FROM OLD.date_of_joining
    AND NEW.managed_department IS NOT DISTINCT FROM OLD.managed_department
    AND NEW.reports_to IS NOT DISTINCT FROM OLD.reports_to
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Employee fields must be changed through the controlled People workflow';
END;
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

  IF actor_role <> 'superadmin' AND employee_role = 'superadmin' THEN
    RAISE EXCEPTION 'Only a superadmin can assign the superadmin role';
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
    AND (
      existing_employee.role = 'superadmin'
      OR employee_role = 'superadmin'
    )
  THEN
    RAISE EXCEPTION 'Only a superadmin can manage the superadmin role';
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

DROP POLICY IF EXISTS employees_update_self_or_superadmin
  ON public.employees;
DROP POLICY IF EXISTS employees_insert_superadmin
  ON public.employees;
DROP POLICY IF EXISTS employees_delete_superadmin
  ON public.employees;

CREATE POLICY employees_update_self_profile
  ON public.employees FOR UPDATE TO authenticated
  USING (
    auth_id = auth.uid()
    OR (auth_id IS NULL AND email = lower(auth.jwt() ->> 'email'))
  )
  WITH CHECK (auth_id = auth.uid());

REVOKE INSERT, DELETE ON TABLE public.employees FROM authenticated;

REVOKE ALL ON FUNCTION public.can_view_people_directory()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_people()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_employee_profile(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_employee_profile(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_view_people_directory()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_people()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_employee_profile(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_employee_profile(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT
) TO authenticated;

COMMIT;
