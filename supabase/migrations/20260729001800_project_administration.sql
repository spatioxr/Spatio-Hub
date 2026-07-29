-- HRMS-026: role-scoped project administration projection and definition edits.

BEGIN;

CREATE OR REPLACE FUNCTION public.project_administration_overview()
RETURNS TABLE (
  id UUID,
  code TEXT,
  name TEXT,
  description TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  managers JSONB,
  members JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH actor AS (
    SELECT employee.id, employee.role
    FROM public.employees employee
    WHERE employee.auth_id = auth.uid()
      AND employee.status = 'Active'
      AND employee.role IN ('manager', 'admin', 'superadmin')
  )
  SELECT
    project.id,
    project.code,
    project.name,
    project.description,
    project.archived_at,
    project.created_at,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', manager.id,
            'emp_code', manager.emp_code,
            'name', manager.name,
            'department', manager.department,
            'role', manager.role
          )
          ORDER BY manager.name
        )
        FROM public.project_managers assignment
        JOIN public.employees manager
          ON manager.id = assignment.employee_id
        WHERE assignment.project_id = project.id
      ),
      '[]'::JSONB
    ) AS managers,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', member.id,
            'emp_code', member.emp_code,
            'name', member.name,
            'department', member.department,
            'role', member.role
          )
          ORDER BY member.name
        )
        FROM public.project_members assignment
        JOIN public.employees member
          ON member.id = assignment.employee_id
        WHERE assignment.project_id = project.id
      ),
      '[]'::JSONB
    ) AS members
  FROM public.projects project
  CROSS JOIN actor
  WHERE actor.role IN ('admin', 'superadmin')
    OR EXISTS (
      SELECT 1
      FROM public.project_managers assignment
      WHERE assignment.project_id = project.id
        AND assignment.employee_id = actor.id
    )
  ORDER BY project.archived_at NULLS FIRST, project.name;
$$;

CREATE OR REPLACE FUNCTION public.project_assignment_candidates(
  target_project_id UUID
)
RETURNS TABLE (
  id UUID,
  emp_code TEXT,
  name TEXT,
  department TEXT,
  role TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_project(target_project_id) THEN
    RAISE EXCEPTION 'You cannot manage assignments for the selected project';
  END IF;

  RETURN QUERY
  SELECT
    employee.id,
    employee.emp_code,
    employee.name,
    employee.department,
    employee.role
  FROM public.employees employee
  WHERE employee.status = 'Active'
  ORDER BY employee.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_project_definition(
  target_project_id UUID,
  project_code TEXT,
  project_name TEXT,
  project_description TEXT
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
    RAISE EXCEPTION 'Only admins and superadmins can edit project definitions';
  END IF;

  IF length(btrim(project_code)) = 0
    OR length(btrim(project_name)) = 0
  THEN
    RAISE EXCEPTION 'Project code and name are required';
  END IF;

  UPDATE public.projects
  SET code = upper(btrim(project_code)),
      name = btrim(project_name),
      description = NULLIF(btrim(project_description), '')
  WHERE projects.id = target_project_id
  RETURNING * INTO updated_project;

  IF updated_project.id IS NULL THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  RETURN updated_project;
END;
$$;

REVOKE ALL ON FUNCTION public.project_administration_overview()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.project_assignment_candidates(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_project_definition(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.project_administration_overview()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_assignment_candidates(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_project_definition(UUID, TEXT, TEXT, TEXT)
  TO authenticated;

COMMIT;
