-- Feedback #37, #38, #40, #43; extends HRMS-048 and HRMS-053.
-- Admins inherit HR administration; delegated capabilities remain supported.
-- Existing self-review, self-adjustment and audit restrictions remain in force.

CREATE OR REPLACE FUNCTION public.can_manage_leave()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_id = auth.uid()
        AND employee.status = 'Active'
        AND NOT employee.must_change_password
        AND (employee.role IN ('admin', 'superadmin') OR employee.is_leave_admin)
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_organisation_downtime()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_id = auth.uid()
        AND employee.status = 'Active'
        AND NOT employee.must_change_password
        AND (
          employee.role IN ('admin', 'superadmin')
          OR employee.is_downtime_manager
        )
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_leave() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_organisation_downtime() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_leave() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_organisation_downtime() TO authenticated;
