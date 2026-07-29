-- HRMS-013: immutable audit history for authorised manual work-entry changes.
-- Manual-entry and change-history UI remain separate issues.

BEGIN;

CREATE OR REPLACE FUNCTION public.can_create_manual_work_entry(
  target_employee_id UUID,
  target_project_id UUID
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
    JOIN public.employees target
      ON target.id = target_employee_id
     AND target.status = 'Active'
    WHERE actor.auth_id = auth.uid()
      AND actor.status = 'Active'
      AND (
        actor.role IN ('admin', 'superadmin')
        OR (
          actor.role = 'manager'
          AND actor.id <> target.id
          AND (
            (
              target_project_id IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM public.project_managers actor_assignment
                WHERE actor_assignment.project_id = target_project_id
                  AND actor_assignment.employee_id = actor.id
              )
              AND EXISTS (
                SELECT 1
                FROM (
                  SELECT member_assignment.employee_id
                  FROM public.project_members member_assignment
                  WHERE member_assignment.project_id = target_project_id
                  UNION
                  SELECT manager_assignment.employee_id
                  FROM public.project_managers manager_assignment
                  WHERE manager_assignment.project_id = target_project_id
                ) target_assignment
                WHERE target_assignment.employee_id = target.id
              )
            )
            OR (
              target_project_id IS NULL
              AND EXISTS (
                SELECT 1
                FROM public.project_managers actor_assignment
                JOIN (
                  SELECT project_id, employee_id
                  FROM public.project_members
                  UNION
                  SELECT project_id, employee_id
                  FROM public.project_managers
                ) target_assignment
                  ON target_assignment.project_id =
                    actor_assignment.project_id
                WHERE actor_assignment.employee_id = actor.id
                  AND target_assignment.employee_id = target.id
              )
            )
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_correct_work_entry(
  target_work_entry_id UUID
)
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
      AND public.can_create_manual_work_entry(
        entry.employee_id,
        entry.project_id
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.create_manual_work_entry(
  target_employee_id UUID,
  target_project_id UUID,
  target_activity_id UUID,
  entry_task_description TEXT,
  entry_started_at TIMESTAMPTZ,
  entry_ended_at TIMESTAMPTZ,
  change_reason TEXT
)
RETURNS public.work_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  created_entry public.work_entries;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  IF NOT public.can_create_manual_work_entry(
    target_employee_id,
    target_project_id
  ) THEN
    RAISE EXCEPTION 'You cannot add a manual entry for this employee and scope';
  END IF;

  IF (target_project_id IS NOT NULL) = (target_activity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Select exactly one project or internal activity';
  END IF;

  IF COALESCE(length(btrim(entry_task_description)), 0) = 0 THEN
    RAISE EXCEPTION 'Task description is required';
  END IF;

  IF COALESCE(length(btrim(change_reason)), 0) = 0 THEN
    RAISE EXCEPTION 'A change reason is required';
  END IF;

  IF entry_started_at IS NULL
    OR entry_ended_at IS NULL
    OR entry_ended_at <= entry_started_at
  THEN
    RAISE EXCEPTION 'A completed positive-duration time range is required';
  END IF;

  IF target_project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.projects project
      WHERE project.id = target_project_id
        AND project.archived_at IS NULL
    )
  THEN
    RAISE EXCEPTION 'The selected project is unavailable';
  END IF;

  IF target_activity_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.activities activity
      WHERE activity.id = target_activity_id
        AND activity.archived_at IS NULL
    )
  THEN
    RAISE EXCEPTION 'The selected internal activity is unavailable';
  END IF;

  INSERT INTO public.work_entries (
    employee_id,
    project_id,
    activity_id,
    task_description,
    started_at,
    ended_at,
    corrected_by,
    correction_reason
  )
  VALUES (
    target_employee_id,
    target_project_id,
    target_activity_id,
    btrim(entry_task_description),
    entry_started_at,
    entry_ended_at,
    actor_employee_id,
    btrim(change_reason)
  )
  RETURNING * INTO created_entry;

  INSERT INTO public.work_entry_audit (
    work_entry_id,
    employee_id,
    changed_by,
    change_reason,
    old_record,
    new_record,
    changed_at
  )
  VALUES (
    created_entry.id,
    created_entry.employee_id,
    actor_employee_id,
    btrim(change_reason),
    '{}'::jsonb,
    to_jsonb(created_entry),
    clock_timestamp()
  );

  RETURN created_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_work_entry(
  target_work_entry_id UUID,
  target_project_id UUID,
  target_activity_id UUID,
  entry_task_description TEXT,
  entry_started_at TIMESTAMPTZ,
  entry_ended_at TIMESTAMPTZ,
  change_reason TEXT
)
RETURNS public.work_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  existing_entry public.work_entries;
  corrected_entry public.work_entries;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  SELECT entry.*
  INTO existing_entry
  FROM public.work_entries entry
  WHERE entry.id = target_work_entry_id
  FOR UPDATE;

  IF existing_entry.id IS NULL THEN
    RAISE EXCEPTION 'Work entry not found';
  END IF;

  IF existing_entry.ended_at IS NULL THEN
    RAISE EXCEPTION 'End the live work session before correcting it';
  END IF;

  IF NOT public.can_correct_work_entry(target_work_entry_id)
    OR NOT public.can_create_manual_work_entry(
      existing_entry.employee_id,
      target_project_id
    )
  THEN
    RAISE EXCEPTION 'You cannot correct this work entry';
  END IF;

  IF (target_project_id IS NOT NULL) = (target_activity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Select exactly one project or internal activity';
  END IF;

  IF COALESCE(length(btrim(entry_task_description)), 0) = 0 THEN
    RAISE EXCEPTION 'Task description is required';
  END IF;

  IF COALESCE(length(btrim(change_reason)), 0) = 0 THEN
    RAISE EXCEPTION 'A change reason is required';
  END IF;

  IF entry_started_at IS NULL
    OR entry_ended_at IS NULL
    OR entry_ended_at <= entry_started_at
  THEN
    RAISE EXCEPTION 'A completed positive-duration time range is required';
  END IF;

  IF target_project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.projects project
      WHERE project.id = target_project_id
        AND (
          project.archived_at IS NULL
          OR project.id = existing_entry.project_id
        )
    )
  THEN
    RAISE EXCEPTION 'The selected project is unavailable';
  END IF;

  IF target_activity_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.activities activity
      WHERE activity.id = target_activity_id
        AND (
          activity.archived_at IS NULL
          OR activity.id = existing_entry.activity_id
        )
    )
  THEN
    RAISE EXCEPTION 'The selected internal activity is unavailable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.break_entries break_entry
    WHERE break_entry.work_entry_id = existing_entry.id
      AND (
        break_entry.ended_at IS NULL
        OR break_entry.started_at < entry_started_at
        OR break_entry.ended_at > entry_ended_at
      )
  ) THEN
    RAISE EXCEPTION 'Corrected time must contain every completed break';
  END IF;

  IF existing_entry.project_id IS NOT DISTINCT FROM target_project_id
    AND existing_entry.activity_id IS NOT DISTINCT FROM target_activity_id
    AND existing_entry.task_description = btrim(entry_task_description)
    AND existing_entry.started_at = entry_started_at
    AND existing_entry.ended_at = entry_ended_at
  THEN
    RAISE EXCEPTION 'At least one work-entry value must change';
  END IF;

  UPDATE public.work_entries
  SET project_id = target_project_id,
      activity_id = target_activity_id,
      task_description = btrim(entry_task_description),
      started_at = entry_started_at,
      ended_at = entry_ended_at,
      corrected_by = actor_employee_id,
      correction_reason = btrim(change_reason)
  WHERE id = existing_entry.id
  RETURNING * INTO corrected_entry;

  INSERT INTO public.work_entry_audit (
    work_entry_id,
    employee_id,
    changed_by,
    change_reason,
    old_record,
    new_record,
    changed_at
  )
  VALUES (
    corrected_entry.id,
    corrected_entry.employee_id,
    actor_employee_id,
    btrim(change_reason),
    to_jsonb(existing_entry),
    to_jsonb(corrected_entry),
    clock_timestamp()
  );

  RETURN corrected_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_work_entry_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Work-entry audit history is immutable';
END;
$$;

DROP TRIGGER IF EXISTS work_entry_audit_prevent_mutation
  ON public.work_entry_audit;
CREATE TRIGGER work_entry_audit_prevent_mutation
  BEFORE UPDATE OR DELETE ON public.work_entry_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_work_entry_audit_mutation();

REVOKE INSERT, UPDATE, DELETE ON TABLE public.work_entry_audit
  FROM authenticated;

REVOKE ALL ON FUNCTION public.can_create_manual_work_entry(UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_correct_work_entry(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_manual_work_entry(
  UUID,
  UUID,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.correct_work_entry(
  UUID,
  UUID,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_work_entry_audit_mutation()
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_correct_work_entry(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_work_entry(
  UUID,
  UUID,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_work_entry(
  UUID,
  UUID,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT
) TO authenticated;

COMMIT;
