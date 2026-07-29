-- HRMS-016: atomically close the current work session and open a new context.
-- End-work, break controls, and BOS/EOD integration remain separate issues.

BEGIN;

CREATE OR REPLACE FUNCTION public.switch_work_session(
  target_project_id UUID,
  target_activity_id UUID,
  session_task_description TEXT
)
RETURNS public.work_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  current_session public.work_entries;
  session_switched_at TIMESTAMPTZ;
  created_session public.work_entries;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  IF (target_project_id IS NOT NULL) = (target_activity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Select exactly one project or internal activity';
  END IF;

  IF COALESCE(length(btrim(session_task_description)), 0) = 0 THEN
    RAISE EXCEPTION 'Task description is required';
  END IF;

  IF target_project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.projects project
      WHERE project.id = target_project_id
        AND project.archived_at IS NULL
        AND public.can_access_project(project.id)
    )
  THEN
    RAISE EXCEPTION 'The selected project is unavailable or not assigned';
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

  SELECT entry.*
  INTO current_session
  FROM public.work_entries entry
  WHERE entry.employee_id = actor_employee_id
    AND entry.ended_at IS NULL
  ORDER BY entry.started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF current_session.id IS NULL THEN
    RAISE EXCEPTION 'Start work before switching context';
  END IF;

  IF current_session.project_id IS NOT DISTINCT FROM target_project_id
    AND current_session.activity_id IS NOT DISTINCT FROM target_activity_id
  THEN
    RAISE EXCEPTION 'Choose a different project or internal activity';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.break_entries break_entry
    WHERE break_entry.work_entry_id = current_session.id
      AND break_entry.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Resume from break before switching work context';
  END IF;

  session_switched_at := clock_timestamp();

  UPDATE public.work_entries
  SET ended_at = session_switched_at
  WHERE id = current_session.id
    AND employee_id = actor_employee_id
    AND ended_at IS NULL;

  INSERT INTO public.work_entries (
    employee_id,
    project_id,
    activity_id,
    task_description,
    started_at
  )
  VALUES (
    actor_employee_id,
    target_project_id,
    target_activity_id,
    btrim(session_task_description),
    session_switched_at
  )
  RETURNING * INTO created_session;

  RETURN created_session;
END;
$$;

REVOKE ALL ON FUNCTION public.switch_work_session(UUID, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_work_session(UUID, UUID, TEXT)
  TO authenticated;

COMMIT;
