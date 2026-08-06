-- HRMS-044: make the retained Released/archive state a complete portal-access boundary.
-- Archived profiles remain readable to their own Auth identity so the client can
-- explain why access was refused, but they cannot read Phase 1 catalogue data or
-- update their profile until an Admin/Superadmin restores them.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_active_employee()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.auth_id = auth.uid()
      AND employee.status = 'Active'
      AND NOT employee.must_change_password
  );
$$;

DROP POLICY IF EXISTS activities_select_authenticated
  ON public.activities;
CREATE POLICY activities_select_active_employee
  ON public.activities FOR SELECT TO authenticated
  USING (public.is_active_employee());

DROP POLICY IF EXISTS holidays_read_authenticated
  ON public.holidays;
CREATE POLICY holidays_read_active_employee
  ON public.holidays FOR SELECT TO authenticated
  USING (public.is_active_employee());

DROP POLICY IF EXISTS employees_update_self_profile
  ON public.employees;
CREATE POLICY employees_update_self_profile
  ON public.employees FOR UPDATE TO authenticated
  USING (
    (
      auth_id = auth.uid()
      AND status = 'Active'
      AND NOT must_change_password
    )
    OR (
      auth_id IS NULL
      AND email = lower(auth.jwt() ->> 'email')
      AND status = 'Active'
    )
  )
  WITH CHECK (
    auth_id = auth.uid()
    AND status = 'Active'
    AND NOT must_change_password
  );

REVOKE ALL ON FUNCTION public.is_active_employee()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_employee()
  TO authenticated;

COMMIT;
