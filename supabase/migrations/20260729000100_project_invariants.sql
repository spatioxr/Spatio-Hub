-- HRMS-007: make project ownership and archive state operational.
-- Project/team administration UI remains tracked by HRMS-026.

BEGIN;

CREATE OR REPLACE FUNCTION public.project_has_active_manager(target_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_managers assignment
    JOIN public.employees manager
      ON manager.id = assignment.employee_id
    WHERE assignment.project_id = target_project_id
      AND manager.status = 'Active'
      AND manager.role IN ('manager', 'admin', 'superadmin')
  );
$$;

CREATE OR REPLACE FUNCTION public.assert_active_project_has_manager()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_project_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN
    target_project_id := COALESCE(NEW.id, OLD.id);
  ELSE
    target_project_id := COALESCE(NEW.project_id, OLD.project_id);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.projects project
    WHERE project.id = target_project_id
      AND project.archived_at IS NULL
  )
  AND NOT public.project_has_active_manager(target_project_id)
  THEN
    RAISE EXCEPTION 'Every active project must have at least one active manager';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_employee_manager_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_project_id UUID;
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role
    AND NEW.status IS NOT DISTINCT FROM OLD.status
  THEN
    RETURN NEW;
  END IF;

  FOR affected_project_id IN
    SELECT project_id
    FROM public.project_managers
    WHERE employee_id = NEW.id
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.projects project
      WHERE project.id = affected_project_id
        AND project.archived_at IS NULL
    )
    AND NOT public.project_has_active_manager(affected_project_id)
    THEN
      RAISE EXCEPTION
        'Employee role/status change would leave an active project without a manager';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_require_active_manager
  ON public.projects;
CREATE CONSTRAINT TRIGGER projects_require_active_manager
  AFTER INSERT OR UPDATE ON public.projects
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_active_project_has_manager();

DROP TRIGGER IF EXISTS project_manager_changes_preserve_owner
  ON public.project_managers;
CREATE TRIGGER project_manager_changes_preserve_owner
  AFTER DELETE OR UPDATE ON public.project_managers
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_active_project_has_manager();

DROP TRIGGER IF EXISTS employee_manager_changes_preserve_projects
  ON public.employees;
CREATE TRIGGER employee_manager_changes_preserve_projects
  AFTER UPDATE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_employee_manager_assignments();

CREATE OR REPLACE FUNCTION public.create_project_with_manager(
  project_code TEXT,
  project_name TEXT,
  project_description TEXT,
  manager_employee_id UUID
)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created_project public.projects;
  actor_employee_id UUID;
BEGIN
  IF NOT public.has_organisation_access() THEN
    RAISE EXCEPTION 'Only admins and superadmins can create projects';
  END IF;

  IF length(btrim(project_code)) = 0
    OR length(btrim(project_name)) = 0
  THEN
    RAISE EXCEPTION 'Project code and name are required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees manager
    WHERE manager.id = manager_employee_id
      AND manager.status = 'Active'
      AND manager.role IN ('manager', 'admin', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'Project manager must be an active manager, admin, or superadmin';
  END IF;

  actor_employee_id := public.current_employee_id();

  INSERT INTO public.projects (
    code,
    name,
    description,
    created_by
  )
  VALUES (
    upper(btrim(project_code)),
    btrim(project_name),
    NULLIF(btrim(project_description), ''),
    actor_employee_id
  )
  RETURNING * INTO created_project;

  INSERT INTO public.project_managers (
    project_id,
    employee_id,
    assigned_by
  )
  VALUES (
    created_project.id,
    manager_employee_id,
    actor_employee_id
  );

  RETURN created_project;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_project_archived(
  target_project_id UUID,
  should_archive BOOLEAN
)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_project public.projects;
BEGIN
  IF NOT public.has_organisation_access() THEN
    RAISE EXCEPTION 'Only admins and superadmins can archive projects';
  END IF;

  IF NOT should_archive
    AND NOT public.project_has_active_manager(target_project_id)
  THEN
    RAISE EXCEPTION 'An active manager is required before restoring a project';
  END IF;

  UPDATE public.projects
  SET archived_at = CASE
    WHEN should_archive THEN COALESCE(archived_at, timezone('utc', now()))
    ELSE NULL
  END
  WHERE id = target_project_id
  RETURNING * INTO updated_project;

  IF updated_project.id IS NULL THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  RETURN updated_project;
END;
$$;

REVOKE ALL ON FUNCTION public.project_has_active_manager(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assert_active_project_has_manager()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assert_employee_manager_assignments()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_project_with_manager(TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_project_archived(UUID, BOOLEAN)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.project_has_active_manager(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_with_manager(TEXT, TEXT, TEXT, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_project_archived(UUID, BOOLEAN)
  TO authenticated;

COMMIT;
