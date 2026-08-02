-- HRMS-042: Superadmin-provisioned temporary passwords and first-login gate.
-- Password values remain exclusively in Supabase Auth and are never stored in
-- public tables. The Edge Function sets and clears the workflow fields below.

BEGIN;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS temporary_password_issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS temporary_password_issued_by UUID
    REFERENCES public.employees(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.employees.must_change_password IS
  'True while a Superadmin-issued temporary password must be replaced.';
COMMENT ON COLUMN public.employees.temporary_password_issued_at IS
  'Most recent successful temporary-password provisioning/reset timestamp.';
COMMENT ON COLUMN public.employees.temporary_password_issued_by IS
  'Superadmin who most recently provisioned or reset the temporary password.';

CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.employees
  WHERE auth_id = auth.uid()
    AND status = 'Active'
    AND NOT must_change_password
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.employees
  WHERE auth_id = auth.uid()
    AND status = 'Active'
    AND NOT must_change_password
  LIMIT 1;
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
      AND NOT actor.must_change_password
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
  -- Controlled SECURITY DEFINER functions and trusted service operations
  -- execute as a role other than authenticated.
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
    AND NEW.must_change_password IS NOT DISTINCT FROM OLD.must_change_password
    AND NEW.temporary_password_issued_at IS NOT DISTINCT FROM OLD.temporary_password_issued_at
    AND NEW.temporary_password_issued_by IS NOT DISTINCT FROM OLD.temporary_password_issued_by
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
    AND NEW.must_change_password IS NOT DISTINCT FROM OLD.must_change_password
    AND NEW.temporary_password_issued_at IS NOT DISTINCT FROM OLD.temporary_password_issued_at
    AND NEW.temporary_password_issued_by IS NOT DISTINCT FROM OLD.temporary_password_issued_by
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Employee fields must be changed through the controlled People workflow';
END;
$$;

DROP POLICY IF EXISTS employees_select_scoped
  ON public.employees;
CREATE POLICY employees_select_scoped
  ON public.employees FOR SELECT TO authenticated
  USING (
    auth_id = auth.uid()
    OR public.can_access_employee(id)
    OR (auth_id IS NULL AND email = lower(auth.jwt() ->> 'email'))
  );

DROP POLICY IF EXISTS employees_update_self_profile
  ON public.employees;
CREATE POLICY employees_update_self_profile
  ON public.employees FOR UPDATE TO authenticated
  USING (
    (auth_id = auth.uid() AND NOT must_change_password)
    OR (auth_id IS NULL AND email = lower(auth.jwt() ->> 'email'))
  )
  WITH CHECK (
    auth_id = auth.uid()
    AND NOT must_change_password
  );

CREATE OR REPLACE FUNCTION public.prevent_temporary_password_data_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_id = auth.uid()
        AND employee.must_change_password
    )
  THEN
    RAISE EXCEPTION 'Replace the temporary password before using the portal';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  protected_table TEXT;
BEGIN
  FOREACH protected_table IN ARRAY ARRAY[
    'employees',
    'attendance',
    'daily_reports',
    'leaves',
    'leave_balances',
    'holidays',
    'projects',
    'activities',
    'project_managers',
    'project_members',
    'work_entries',
    'break_entries',
    'work_entry_audit',
    'employee_work_settings',
    'daily_report_settings_audit'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS temporary_password_write_gate ON public.%I',
      protected_table
    );
    EXECUTE format(
      'CREATE TRIGGER temporary_password_write_gate '
      || 'BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.prevent_temporary_password_data_write()',
      protected_table
    );
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION public.prevent_temporary_password_data_write()
  FROM PUBLIC, anon, authenticated;

COMMIT;
