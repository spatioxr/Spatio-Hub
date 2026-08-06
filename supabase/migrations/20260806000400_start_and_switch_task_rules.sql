-- HRMS-015/016 correction: a task description is omitted on the first start
-- and is mandatory only when an employee switches work context.
-- BOS/EOD exceptions remain independently configurable by superadmins.

BEGIN;

ALTER TABLE public.employee_work_settings
  ALTER COLUMN task_description_required SET DEFAULT false;

UPDATE public.employee_work_settings
SET task_description_required = false
WHERE task_description_required;

COMMENT ON COLUMN public.employee_work_settings.task_description_required IS
  'Compatibility column. First starts omit descriptions and context switches always require one.';

CREATE OR REPLACE FUNCTION public.set_daily_report_requirements(
  target_employee_id UUID,
  require_bos BOOLEAN,
  require_eod BOOLEAN
)
RETURNS public.employee_work_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  previous_settings public.employee_work_settings;
  saved_settings public.employee_work_settings;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Only a superadmin can change BOS/EOD requirements';
  END IF;

  IF require_bos IS NULL OR require_eod IS NULL THEN
    RAISE EXCEPTION 'BOS and EOD requirements must be specified';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = target_employee_id
      AND employee.status = 'Active'
  ) THEN
    RAISE EXCEPTION 'Active employee not found';
  END IF;

  INSERT INTO public.employee_work_settings (
    employee_id,
    task_description_required
  )
  VALUES (target_employee_id, false)
  ON CONFLICT (employee_id) DO NOTHING;

  SELECT *
  INTO previous_settings
  FROM public.employee_work_settings settings
  WHERE settings.employee_id = target_employee_id
  FOR UPDATE;

  IF previous_settings.bos_required = require_bos
    AND previous_settings.eod_required = require_eod
  THEN
    RETURN previous_settings;
  END IF;

  UPDATE public.employee_work_settings settings
  SET bos_required = require_bos,
      eod_required = require_eod,
      task_description_required = false,
      updated_by = actor_employee_id,
      updated_at = clock_timestamp()
  WHERE settings.employee_id = target_employee_id
  RETURNING * INTO saved_settings;

  INSERT INTO public.daily_report_settings_audit (
    employee_id,
    changed_by,
    old_bos_required,
    new_bos_required,
    old_eod_required,
    new_eod_required,
    old_task_description_required,
    new_task_description_required,
    changed_at
  )
  VALUES (
    target_employee_id,
    actor_employee_id,
    previous_settings.bos_required,
    saved_settings.bos_required,
    previous_settings.eod_required,
    saved_settings.eod_required,
    previous_settings.task_description_required,
    saved_settings.task_description_required,
    saved_settings.updated_at
  );

  RETURN saved_settings;
END;
$$;

DROP FUNCTION IF EXISTS public.set_employee_work_requirements(
  UUID,
  BOOLEAN,
  BOOLEAN,
  BOOLEAN
);
DROP FUNCTION IF EXISTS public.set_task_description_requirement_for_all(BOOLEAN);

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
    '',
    session_started_at
  )
  RETURNING * INTO created_session;

  RETURN created_session;
END;
$$;

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
    RAISE EXCEPTION 'Task description is required when switching work context';
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

REVOKE ALL ON FUNCTION public.set_daily_report_requirements(
  UUID,
  BOOLEAN,
  BOOLEAN
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_daily_report_requirements(
  UUID,
  BOOLEAN,
  BOOLEAN
) TO authenticated;

REVOKE ALL ON FUNCTION public.start_work_session(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.switch_work_session(UUID, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_work_session(UUID, UUID, TEXT)
  TO authenticated;

COMMIT;
