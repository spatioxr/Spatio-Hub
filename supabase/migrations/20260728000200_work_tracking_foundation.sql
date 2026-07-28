-- HRMS-006 migration 002: Phase 1 project/activity work-tracking foundation.
-- Detailed UI and workflow behaviour remains tracked by HRMS-007 through HRMS-018.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  archived_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CHECK (length(btrim(code)) > 0),
  CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX projects_code_unique_ci
  ON public.projects (lower(code));
CREATE UNIQUE INDEX projects_name_unique_ci
  ON public.projects (lower(name));

CREATE TABLE public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  archived_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX activities_name_unique_ci
  ON public.activities (lower(name));

CREATE TABLE public.project_managers (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  assigned_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (project_id, employee_id)
);

CREATE TABLE public.project_members (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  assigned_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (project_id, employee_id)
);

CREATE TABLE public.work_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  project_id UUID REFERENCES public.projects(id) ON DELETE RESTRICT,
  activity_id UUID REFERENCES public.activities(id) ON DELETE RESTRICT,
  task_description TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  corrected_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  correction_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CHECK ((project_id IS NOT NULL) <> (activity_id IS NOT NULL)),
  CHECK (length(btrim(task_description)) > 0),
  CHECK (ended_at IS NULL OR ended_at > started_at),
  CHECK (
    (corrected_by IS NULL AND correction_reason IS NULL)
    OR (
      corrected_by IS NOT NULL
      AND length(btrim(correction_reason)) > 0
    )
  ),
  EXCLUDE USING gist (
    employee_id WITH =,
    tstzrange(
      started_at,
      COALESCE(ended_at, 'infinity'::timestamptz),
      '[)'
    ) WITH &&
  )
);

CREATE INDEX work_entries_employee_started_idx
  ON public.work_entries (employee_id, started_at DESC);
CREATE INDEX work_entries_project_started_idx
  ON public.work_entries (project_id, started_at DESC)
  WHERE project_id IS NOT NULL;
CREATE INDEX work_entries_activity_started_idx
  ON public.work_entries (activity_id, started_at DESC)
  WHERE activity_id IS NOT NULL;

CREATE TABLE public.break_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_entry_id UUID NOT NULL REFERENCES public.work_entries(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CHECK (ended_at IS NULL OR ended_at > started_at),
  EXCLUDE USING gist (
    work_entry_id WITH =,
    tstzrange(
      started_at,
      COALESCE(ended_at, 'infinity'::timestamptz),
      '[)'
    ) WITH &&
  )
);

CREATE INDEX break_entries_work_entry_started_idx
  ON public.break_entries (work_entry_id, started_at DESC);

CREATE TABLE public.work_entry_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_entry_id UUID NOT NULL REFERENCES public.work_entries(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  changed_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  change_reason TEXT NOT NULL,
  old_record JSONB NOT NULL,
  new_record JSONB NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CHECK (length(btrim(change_reason)) > 0)
);

CREATE INDEX work_entry_audit_entry_changed_idx
  ON public.work_entry_audit (work_entry_id, changed_at DESC);

CREATE TABLE public.employee_work_settings (
  employee_id UUID PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  bos_required BOOLEAN NOT NULL DEFAULT true,
  eod_required BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER activities_set_updated_at
  BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER work_entries_set_updated_at
  BEFORE UPDATE ON public.work_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER break_entries_set_updated_at
  BEFORE UPDATE ON public.break_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.can_manage_project(target_project_id UUID)
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
        actor.role IN ('admin', 'superadmin')
        OR (
          actor.role = 'manager'
          AND EXISTS (
            SELECT 1
            FROM public.project_managers manager_assignment
            WHERE manager_assignment.project_id = target_project_id
              AND manager_assignment.employee_id = actor.id
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_project(target_project_id UUID)
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
        actor.role IN ('admin', 'superadmin')
        OR EXISTS (
          SELECT 1
          FROM public.project_managers manager_assignment
          WHERE manager_assignment.project_id = target_project_id
            AND manager_assignment.employee_id = actor.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.project_members member_assignment
          WHERE member_assignment.project_id = target_project_id
            AND member_assignment.employee_id = actor.id
        )
      )
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
          AND (
            EXISTS (
              SELECT 1
              FROM public.employees target
              WHERE target.id = target_employee_id
                AND target.reports_to = actor.id
            )
            OR EXISTS (
              SELECT 1
              FROM public.project_managers manager_assignment
              JOIN public.project_members member_assignment
                ON member_assignment.project_id = manager_assignment.project_id
              WHERE manager_assignment.employee_id = actor.id
                AND member_assignment.employee_id = target_employee_id
            )
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_work_entry(target_work_entry_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.work_entries entry
    WHERE entry.id = target_work_entry_id
      AND (
        public.can_access_employee(entry.employee_id)
        OR (
          entry.project_id IS NOT NULL
          AND public.can_manage_project(entry.project_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.guard_project_manager_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.employees
    WHERE id = NEW.employee_id
      AND status = 'Active'
      AND role IN ('manager', 'admin', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'Project managers must be active manager, admin, or superadmin employees';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_managers_guard_role
  BEFORE INSERT OR UPDATE ON public.project_managers
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_manager_role();

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_project(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_project(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_work_entry(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_project_manager_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_project(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_project(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_work_entry(UUID) TO authenticated;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.break_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_entry_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_work_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.projects,
  public.activities,
  public.project_managers,
  public.project_members,
  public.work_entries,
  public.break_entries,
  public.work_entry_audit,
  public.employee_work_settings
FROM anon;

GRANT SELECT ON TABLE
  public.projects,
  public.activities,
  public.project_managers,
  public.project_members,
  public.work_entries,
  public.break_entries,
  public.work_entry_audit,
  public.employee_work_settings
TO authenticated;

GRANT INSERT, UPDATE, DELETE ON TABLE
  public.projects,
  public.activities,
  public.project_managers,
  public.project_members,
  public.work_entries,
  public.break_entries,
  public.employee_work_settings
TO authenticated;

CREATE POLICY projects_select_assigned
  ON public.projects FOR SELECT TO authenticated
  USING (public.can_access_project(id));
CREATE POLICY projects_insert_admin
  ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.has_organisation_access());
CREATE POLICY projects_update_admin
  ON public.projects FOR UPDATE TO authenticated
  USING (public.has_organisation_access())
  WITH CHECK (public.has_organisation_access());
CREATE POLICY projects_delete_superadmin
  ON public.projects FOR DELETE TO authenticated
  USING (public.is_superadmin());

CREATE POLICY activities_select_authenticated
  ON public.activities FOR SELECT TO authenticated
  USING (true);
CREATE POLICY activities_insert_admin
  ON public.activities FOR INSERT TO authenticated
  WITH CHECK (public.has_organisation_access());
CREATE POLICY activities_update_admin
  ON public.activities FOR UPDATE TO authenticated
  USING (public.has_organisation_access())
  WITH CHECK (public.has_organisation_access());
CREATE POLICY activities_delete_superadmin
  ON public.activities FOR DELETE TO authenticated
  USING (public.is_superadmin());

CREATE POLICY project_managers_select_project
  ON public.project_managers FOR SELECT TO authenticated
  USING (public.can_access_project(project_id));
CREATE POLICY project_managers_write_admin
  ON public.project_managers FOR ALL TO authenticated
  USING (public.has_organisation_access())
  WITH CHECK (public.has_organisation_access());

CREATE POLICY project_members_select_project
  ON public.project_members FOR SELECT TO authenticated
  USING (public.can_access_project(project_id));
CREATE POLICY project_members_insert_manager
  ON public.project_members FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_project(project_id));
CREATE POLICY project_members_delete_manager
  ON public.project_members FOR DELETE TO authenticated
  USING (public.can_manage_project(project_id));

CREATE POLICY work_entries_select_scoped
  ON public.work_entries FOR SELECT TO authenticated
  USING (
    public.can_access_employee(employee_id)
    OR (project_id IS NOT NULL AND public.can_manage_project(project_id))
  );
CREATE POLICY work_entries_insert_own
  ON public.work_entries FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = public.current_employee_id()
    AND (
      (
        project_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.projects project
          WHERE project.id = project_id
            AND project.archived_at IS NULL
            AND public.can_access_project(project.id)
        )
      )
      OR (
        activity_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.activities activity
          WHERE activity.id = activity_id
            AND activity.archived_at IS NULL
        )
      )
    )
  );
CREATE POLICY work_entries_update_own_or_superadmin
  ON public.work_entries FOR UPDATE TO authenticated
  USING (
    employee_id = public.current_employee_id()
    OR public.is_superadmin()
  )
  WITH CHECK (
    employee_id = public.current_employee_id()
    OR public.is_superadmin()
  );
CREATE POLICY work_entries_delete_superadmin
  ON public.work_entries FOR DELETE TO authenticated
  USING (public.is_superadmin());

CREATE POLICY break_entries_select_scoped
  ON public.break_entries FOR SELECT TO authenticated
  USING (public.can_access_work_entry(work_entry_id));
CREATE POLICY break_entries_insert_own
  ON public.break_entries FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.work_entries entry
      WHERE entry.id = work_entry_id
        AND entry.employee_id = public.current_employee_id()
        AND entry.ended_at IS NULL
    )
  );
CREATE POLICY break_entries_update_own_or_superadmin
  ON public.break_entries FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.work_entries entry
      WHERE entry.id = work_entry_id
        AND (
          entry.employee_id = public.current_employee_id()
          OR public.is_superadmin()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.work_entries entry
      WHERE entry.id = work_entry_id
        AND (
          entry.employee_id = public.current_employee_id()
          OR public.is_superadmin()
        )
    )
  );
CREATE POLICY break_entries_delete_superadmin
  ON public.break_entries FOR DELETE TO authenticated
  USING (public.is_superadmin());

CREATE POLICY work_entry_audit_select_scoped
  ON public.work_entry_audit FOR SELECT TO authenticated
  USING (public.can_access_work_entry(work_entry_id));

CREATE POLICY employee_work_settings_select_self_or_superadmin
  ON public.employee_work_settings FOR SELECT TO authenticated
  USING (
    employee_id = public.current_employee_id()
    OR public.is_superadmin()
  );
CREATE POLICY employee_work_settings_write_superadmin
  ON public.employee_work_settings FOR ALL TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

INSERT INTO public.activities (name, description)
VALUES
  ('Pre-sales', 'Pre-sales discovery, calls, and supporting work.'),
  ('Proposal making', 'Proposal and statement-of-work preparation.'),
  ('Estimation', 'Effort, scope, and delivery estimation.'),
  ('Demo video making', 'Product or project demo-video production.'),
  ('Marketing material making', 'Marketing collateral and content production.')
ON CONFLICT DO NOTHING;

COMMIT;
