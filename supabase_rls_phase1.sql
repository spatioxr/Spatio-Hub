-- HRMS-004: server-enforced access for the Phase 1 tables that exist today.
-- Safe to rerun. Future schema migrations must add RLS for every new table.

BEGIN;

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
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_employee_role() = 'superadmin', false);
$$;

CREATE OR REPLACE FUNCTION public.has_organisation_access()
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

CREATE OR REPLACE FUNCTION public.can_access_employee(target_employee_id UUID)
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
            FROM public.employees target
            WHERE target.id = target_employee_id
              AND target.reports_to = actor.id
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.guard_employee_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_superadmin() THEN
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

  RAISE EXCEPTION 'Employee profile fields may only be changed by a superadmin';
END;
$$;

REVOKE ALL ON FUNCTION public.current_employee_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_employee_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_superadmin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_organisation_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_employee(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_employee_self_update() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_employee_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_employee_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_superadmin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_organisation_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_employee(UUID) TO authenticated;

DROP TRIGGER IF EXISTS guard_employee_self_update ON public.employees;
CREATE TRIGGER guard_employee_self_update
  BEFORE UPDATE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_employee_self_update();

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.employees,
  public.attendance,
  public.daily_reports,
  public.leaves,
  public.leave_balances,
  public.holidays
FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.employees,
  public.attendance,
  public.daily_reports,
  public.leaves,
  public.leave_balances,
  public.holidays
TO authenticated;

DROP POLICY IF EXISTS "employees_select_self_or_superadmin" ON public.employees;
DROP POLICY IF EXISTS "employees_link_own_auth_or_superadmin" ON public.employees;
DROP POLICY IF EXISTS "employees_insert_superadmin" ON public.employees;
DROP POLICY IF EXISTS "employees_delete_superadmin" ON public.employees;
DROP POLICY IF EXISTS "employees_select_scoped" ON public.employees;
DROP POLICY IF EXISTS "employees_update_self_or_superadmin" ON public.employees;

CREATE POLICY "employees_select_scoped"
  ON public.employees FOR SELECT TO authenticated
  USING (
    public.can_access_employee(id)
    OR (auth_id IS NULL AND email = lower(auth.jwt() ->> 'email'))
  );

CREATE POLICY "employees_update_self_or_superadmin"
  ON public.employees FOR UPDATE TO authenticated
  USING (
    auth_id = auth.uid()
    OR (auth_id IS NULL AND email = lower(auth.jwt() ->> 'email'))
    OR public.is_superadmin()
  )
  WITH CHECK (
    auth_id = auth.uid()
    OR public.is_superadmin()
  );

CREATE POLICY "employees_insert_superadmin"
  ON public.employees FOR INSERT TO authenticated
  WITH CHECK (public.is_superadmin());

CREATE POLICY "employees_delete_superadmin"
  ON public.employees FOR DELETE TO authenticated
  USING (public.is_superadmin());

DROP POLICY IF EXISTS "attendance_select_own_or_superadmin" ON public.attendance;
DROP POLICY IF EXISTS "attendance_insert_own_or_superadmin" ON public.attendance;
DROP POLICY IF EXISTS "attendance_update_own_or_superadmin" ON public.attendance;
DROP POLICY IF EXISTS "attendance_delete_superadmin" ON public.attendance;
DROP POLICY IF EXISTS "attendance_select_scoped" ON public.attendance;
DROP POLICY IF EXISTS "attendance_insert_own" ON public.attendance;
DROP POLICY IF EXISTS "attendance_update_own_or_superadmin" ON public.attendance;

CREATE POLICY "attendance_select_scoped"
  ON public.attendance FOR SELECT TO authenticated
  USING (public.can_access_employee(employee_id));

CREATE POLICY "attendance_insert_own"
  ON public.attendance FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id());

CREATE POLICY "attendance_update_own_or_superadmin"
  ON public.attendance FOR UPDATE TO authenticated
  USING (
    employee_id = public.current_employee_id()
    OR public.is_superadmin()
  )
  WITH CHECK (
    employee_id = public.current_employee_id()
    OR public.is_superadmin()
  );

CREATE POLICY "attendance_delete_superadmin"
  ON public.attendance FOR DELETE TO authenticated
  USING (public.is_superadmin());

DROP POLICY IF EXISTS "daily_reports_select_own_or_superadmin" ON public.daily_reports;
DROP POLICY IF EXISTS "daily_reports_insert_own_or_superadmin" ON public.daily_reports;
DROP POLICY IF EXISTS "daily_reports_update_own_or_superadmin" ON public.daily_reports;
DROP POLICY IF EXISTS "daily_reports_select_scoped" ON public.daily_reports;
DROP POLICY IF EXISTS "daily_reports_insert_own" ON public.daily_reports;
DROP POLICY IF EXISTS "daily_reports_update_own_or_superadmin" ON public.daily_reports;

CREATE POLICY "daily_reports_select_scoped"
  ON public.daily_reports FOR SELECT TO authenticated
  USING (public.can_access_employee(employee_id));

CREATE POLICY "daily_reports_insert_own"
  ON public.daily_reports FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id());

CREATE POLICY "daily_reports_update_own_or_superadmin"
  ON public.daily_reports FOR UPDATE TO authenticated
  USING (
    employee_id = public.current_employee_id()
    OR public.is_superadmin()
  )
  WITH CHECK (
    employee_id = public.current_employee_id()
    OR public.is_superadmin()
  );

DROP POLICY IF EXISTS "leaves_select_own_or_superadmin" ON public.leaves;
DROP POLICY IF EXISTS "leaves_insert_own_or_superadmin" ON public.leaves;
DROP POLICY IF EXISTS "leaves_update_own_or_superadmin" ON public.leaves;
DROP POLICY IF EXISTS "leaves_select_own_or_superadmin" ON public.leaves;
DROP POLICY IF EXISTS "leaves_insert_own" ON public.leaves;
DROP POLICY IF EXISTS "leaves_update_superadmin" ON public.leaves;
DROP POLICY IF EXISTS "leaves_delete_superadmin" ON public.leaves;

CREATE POLICY "leaves_select_own_or_superadmin"
  ON public.leaves FOR SELECT TO authenticated
  USING (
    employee_id = public.current_employee_id()
    OR public.is_superadmin()
  );

CREATE POLICY "leaves_insert_own"
  ON public.leaves FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = public.current_employee_id()
    AND status = 'Pending'
  );

CREATE POLICY "leaves_update_superadmin"
  ON public.leaves FOR UPDATE TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

CREATE POLICY "leaves_delete_superadmin"
  ON public.leaves FOR DELETE TO authenticated
  USING (public.is_superadmin());

DROP POLICY IF EXISTS "leave_balances_select_own_or_superadmin" ON public.leave_balances;
DROP POLICY IF EXISTS "leave_balances_write_superadmin" ON public.leave_balances;

CREATE POLICY "leave_balances_select_own_or_superadmin"
  ON public.leave_balances FOR SELECT TO authenticated
  USING (
    employee_id = public.current_employee_id()
    OR public.is_superadmin()
  );

CREATE POLICY "leave_balances_write_superadmin"
  ON public.leave_balances FOR ALL TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

DROP POLICY IF EXISTS "holidays_read_authenticated" ON public.holidays;
DROP POLICY IF EXISTS "holidays_write_superadmin" ON public.holidays;

CREATE POLICY "holidays_read_authenticated"
  ON public.holidays FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "holidays_write_superadmin"
  ON public.holidays FOR ALL TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

COMMIT;
