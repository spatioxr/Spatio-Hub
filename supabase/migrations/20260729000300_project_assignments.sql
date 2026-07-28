-- HRMS-009: operational project Manager and team assignments.
-- The project administration screen remains tracked by HRMS-026.

BEGIN;

CREATE OR REPLACE FUNCTION public.can_assign_project_manager(
  target_project_id UUID,
  target_employee_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_organisation_access()
    AND EXISTS (
      SELECT 1
      FROM public.projects project
      WHERE project.id = target_project_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = target_employee_id
        AND employee.status = 'Active'
        AND employee.role IN ('manager', 'admin', 'superadmin')
    );
$$;

CREATE OR REPLACE FUNCTION public.can_assign_project_member(
  target_project_id UUID,
  target_employee_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.can_manage_project(target_project_id)
    AND EXISTS (
      SELECT 1
      FROM public.projects project
      WHERE project.id = target_project_id
        AND project.archived_at IS NULL
    )
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = target_employee_id
        AND employee.status = 'Active'
    );
$$;

CREATE OR REPLACE FUNCTION public.stamp_project_assignment_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  NEW.assigned_by := actor_employee_id;
  NEW.assigned_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_managers_stamp_actor
  ON public.project_managers;
CREATE TRIGGER project_managers_stamp_actor
  BEFORE INSERT ON public.project_managers
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_project_assignment_actor();

DROP TRIGGER IF EXISTS project_members_stamp_actor
  ON public.project_members;
CREATE TRIGGER project_members_stamp_actor
  BEFORE INSERT ON public.project_members
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_project_assignment_actor();

CREATE OR REPLACE FUNCTION public.assign_project_manager(
  target_project_id UUID,
  manager_employee_id UUID
)
RETURNS public.project_managers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created_assignment public.project_managers;
BEGIN
  IF NOT public.can_assign_project_manager(
    target_project_id,
    manager_employee_id
  ) THEN
    RAISE EXCEPTION
      'Only admins and superadmins can assign an active Manager to a project';
  END IF;

  INSERT INTO public.project_managers (
    project_id,
    employee_id
  )
  VALUES (
    target_project_id,
    manager_employee_id
  )
  RETURNING * INTO created_assignment;

  RETURN created_assignment;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_project_manager(
  target_project_id UUID,
  manager_employee_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  IF NOT public.has_organisation_access() THEN
    RAISE EXCEPTION 'Only admins and superadmins can remove project Managers';
  END IF;

  DELETE FROM public.project_managers
  WHERE project_id = target_project_id
    AND employee_id = manager_employee_id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count = 0 THEN
    RAISE EXCEPTION 'Project Manager assignment not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_project_member(
  target_project_id UUID,
  member_employee_id UUID
)
RETURNS public.project_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created_assignment public.project_members;
BEGIN
  IF NOT public.can_assign_project_member(
    target_project_id,
    member_employee_id
  ) THEN
    RAISE EXCEPTION
      'You cannot assign this employee to the selected project';
  END IF;

  INSERT INTO public.project_members (
    project_id,
    employee_id
  )
  VALUES (
    target_project_id,
    member_employee_id
  )
  RETURNING * INTO created_assignment;

  RETURN created_assignment;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_project_member(
  target_project_id UUID,
  member_employee_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  IF NOT public.can_manage_project(target_project_id) THEN
    RAISE EXCEPTION 'You cannot manage members for the selected project';
  END IF;

  DELETE FROM public.project_members
  WHERE project_id = target_project_id
    AND employee_id = member_employee_id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count = 0 THEN
    RAISE EXCEPTION 'Project member assignment not found';
  END IF;
END;
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

DROP POLICY IF EXISTS project_managers_write_admin
  ON public.project_managers;
DROP POLICY IF EXISTS project_managers_insert_admin
  ON public.project_managers;
DROP POLICY IF EXISTS project_managers_delete_admin
  ON public.project_managers;

CREATE POLICY project_managers_insert_admin
  ON public.project_managers FOR INSERT TO authenticated
  WITH CHECK (
    public.can_assign_project_manager(project_id, employee_id)
    AND assigned_by = public.current_employee_id()
  );
CREATE POLICY project_managers_delete_admin
  ON public.project_managers FOR DELETE TO authenticated
  USING (public.has_organisation_access());

DROP POLICY IF EXISTS project_members_insert_manager
  ON public.project_members;
DROP POLICY IF EXISTS project_members_delete_manager
  ON public.project_members;

CREATE POLICY project_members_insert_manager
  ON public.project_members FOR INSERT TO authenticated
  WITH CHECK (
    public.can_assign_project_member(project_id, employee_id)
    AND assigned_by = public.current_employee_id()
  );
CREATE POLICY project_members_delete_manager
  ON public.project_members FOR DELETE TO authenticated
  USING (public.can_manage_project(project_id));

REVOKE ALL ON FUNCTION public.can_assign_project_manager(UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_assign_project_member(UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stamp_project_assignment_actor()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_project_manager(UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_project_manager(UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_project_member(UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_project_member(UUID, UUID)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_assign_project_manager(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_assign_project_member(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_project_manager(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_project_manager(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_project_member(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_project_member(UUID, UUID)
  TO authenticated;

COMMIT;
