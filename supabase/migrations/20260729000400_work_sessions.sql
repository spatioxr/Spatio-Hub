-- HRMS-010: operational session-based work entries.
-- Breaks, switching, BOS/EOD enforcement, and timer UI remain separate issues.

BEGIN;

CREATE OR REPLACE FUNCTION public.start_work_session(
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
  session_started_at TIMESTAMPTZ;
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

  IF EXISTS (
    SELECT 1
    FROM public.work_entries entry
    WHERE entry.employee_id = actor_employee_id
      AND entry.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'End or switch the current work session before starting another';
  END IF;

  session_started_at := clock_timestamp();

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
    session_started_at
  )
  RETURNING * INTO created_session;

  RETURN created_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_work_session()
RETURNS SETOF public.work_entries
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT entry.*
  FROM public.work_entries entry
  WHERE entry.employee_id = public.current_employee_id()
    AND entry.ended_at IS NULL
  ORDER BY entry.started_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.end_work_session(
  target_work_entry_id UUID
)
RETURNS public.work_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  ended_session public.work_entries;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  UPDATE public.work_entries
  SET ended_at = clock_timestamp()
  WHERE id = target_work_entry_id
    AND employee_id = actor_employee_id
    AND ended_at IS NULL
  RETURNING * INTO ended_session;

  IF ended_session.id IS NULL THEN
    RAISE EXCEPTION 'Open work session not found';
  END IF;

  RETURN ended_session;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.work_entries
  FROM authenticated;

REVOKE ALL ON FUNCTION public.start_work_session(UUID, UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_work_session()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_work_session(UUID)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.start_work_session(UUID, UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_work_session()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_work_session(UUID)
  TO authenticated;

COMMIT;
