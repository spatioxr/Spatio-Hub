-- HRMS-024: readable, role-scoped work-entry change history.

BEGIN;

CREATE OR REPLACE FUNCTION public.work_entry_change_history(
  target_work_entry_id UUID
)
RETURNS TABLE (
  audit_id UUID,
  work_entry_id UUID,
  change_kind TEXT,
  changed_at TIMESTAMPTZ,
  change_reason TEXT,
  editor_id UUID,
  editor_name TEXT,
  editor_code TEXT,
  old_record JSONB,
  new_record JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  actor_role TEXT;
  target_employee_id UUID;
BEGIN
  actor_employee_id := public.current_employee_id();
  actor_role := public.current_employee_role();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  SELECT entry.employee_id
  INTO target_employee_id
  FROM public.work_entries entry
  WHERE entry.id = target_work_entry_id;

  IF target_employee_id IS NULL THEN
    RAISE EXCEPTION 'Work entry not found';
  END IF;

  IF NOT (
    (actor_role = 'employee' AND target_employee_id = actor_employee_id)
    OR (
      actor_role = 'manager'
      AND EXISTS (
        SELECT 1
        FROM public.project_managers manager_assignment
        JOIN public.project_members member_assignment
          ON member_assignment.project_id = manager_assignment.project_id
        WHERE manager_assignment.employee_id = actor_employee_id
          AND member_assignment.employee_id = target_employee_id
      )
    )
    OR actor_role IN ('admin', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'You cannot view change history for this work entry';
  END IF;

  RETURN QUERY
  SELECT
    audit.id,
    audit.work_entry_id,
    CASE
      WHEN audit.old_record = '{}'::JSONB THEN 'created'
      ELSE 'corrected'
    END,
    audit.changed_at,
    audit.change_reason,
    editor.id,
    editor.name,
    editor.emp_code,
    audit.old_record || jsonb_build_object(
      'context_type',
      CASE
        WHEN NULLIF(audit.old_record ->> 'project_id', '') IS NOT NULL
        THEN 'project'
        WHEN NULLIF(audit.old_record ->> 'activity_id', '') IS NOT NULL
        THEN 'activity'
        ELSE NULL
      END,
      'context_label',
      CASE
        WHEN old_project.id IS NOT NULL
        THEN concat_ws(' · ', old_project.code, old_project.name)
        ELSE old_activity.name
      END
    ),
    audit.new_record || jsonb_build_object(
      'context_type',
      CASE
        WHEN NULLIF(audit.new_record ->> 'project_id', '') IS NOT NULL
        THEN 'project'
        WHEN NULLIF(audit.new_record ->> 'activity_id', '') IS NOT NULL
        THEN 'activity'
        ELSE NULL
      END,
      'context_label',
      CASE
        WHEN new_project.id IS NOT NULL
        THEN concat_ws(' · ', new_project.code, new_project.name)
        ELSE new_activity.name
      END
    )
  FROM public.work_entry_audit audit
  JOIN public.employees editor
    ON editor.id = audit.changed_by
  LEFT JOIN public.projects old_project
    ON old_project.id =
      NULLIF(audit.old_record ->> 'project_id', '')::UUID
  LEFT JOIN public.activities old_activity
    ON old_activity.id =
      NULLIF(audit.old_record ->> 'activity_id', '')::UUID
  LEFT JOIN public.projects new_project
    ON new_project.id =
      NULLIF(audit.new_record ->> 'project_id', '')::UUID
  LEFT JOIN public.activities new_activity
    ON new_activity.id =
      NULLIF(audit.new_record ->> 'activity_id', '')::UUID
  WHERE audit.work_entry_id = target_work_entry_id
  ORDER BY audit.changed_at DESC, audit.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.work_entry_change_history(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_entry_change_history(UUID)
  TO authenticated;

COMMIT;
