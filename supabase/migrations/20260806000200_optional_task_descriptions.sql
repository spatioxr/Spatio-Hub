-- HRMS-015 revision: configurable task-description requirements for work sessions.
-- Manual time-entry descriptions remain mandatory under HRMS-023.

BEGIN;

ALTER TABLE public.employee_work_settings
  ADD COLUMN task_description_required BOOLEAN NOT NULL DEFAULT true;

DO $$
DECLARE
  task_description_constraint NAME;
BEGIN
  SELECT constraint_row.conname
  INTO task_description_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.work_entries'::regclass
    AND constraint_row.contype = 'c'
    AND pg_get_constraintdef(constraint_row.oid) ILIKE '%task_description%'
    AND pg_get_constraintdef(constraint_row.oid) ILIKE '%btrim%'
  LIMIT 1;

  IF task_description_constraint IS NULL THEN
    RAISE EXCEPTION 'Work-entry task-description constraint not found';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.work_entries DROP CONSTRAINT %I',
    task_description_constraint
  );
END;
$$;

ALTER TABLE public.daily_report_settings_audit
  ADD COLUMN old_task_description_required BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN new_task_description_required BOOLEAN NOT NULL DEFAULT true;

DO $$
DECLARE
  audit_change_constraint NAME;
BEGIN
  SELECT constraint_row.conname
  INTO audit_change_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.daily_report_settings_audit'::regclass
    AND constraint_row.contype = 'c'
    AND pg_get_constraintdef(constraint_row.oid) ILIKE '%old_bos_required%'
    AND pg_get_constraintdef(constraint_row.oid) ILIKE '%new_eod_required%'
  LIMIT 1;

  IF audit_change_constraint IS NULL THEN
    RAISE EXCEPTION 'Work-settings audit change constraint not found';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.daily_report_settings_audit DROP CONSTRAINT %I',
    audit_change_constraint
  );
END;
$$;

ALTER TABLE public.daily_report_settings_audit
  ADD CONSTRAINT work_settings_audit_has_change CHECK (
    old_bos_required IS DISTINCT FROM new_bos_required
    OR old_eod_required IS DISTINCT FROM new_eod_required
    OR old_task_description_required IS DISTINCT FROM new_task_description_required
  );

CREATE OR REPLACE FUNCTION public.set_employee_work_requirements(
  target_employee_id UUID,
  require_bos BOOLEAN,
  require_eod BOOLEAN,
  require_task_description BOOLEAN
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
    RAISE EXCEPTION 'Only a superadmin can change work requirements';
  END IF;

  IF require_bos IS NULL
    OR require_eod IS NULL
    OR require_task_description IS NULL
  THEN
    RAISE EXCEPTION 'All work requirements must be specified';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = target_employee_id
      AND employee.status = 'Active'
  ) THEN
    RAISE EXCEPTION 'Active employee not found';
  END IF;

  INSERT INTO public.employee_work_settings (employee_id)
  VALUES (target_employee_id)
  ON CONFLICT (employee_id) DO NOTHING;

  SELECT *
  INTO previous_settings
  FROM public.employee_work_settings settings
  WHERE settings.employee_id = target_employee_id
  FOR UPDATE;

  IF previous_settings.bos_required = require_bos
    AND previous_settings.eod_required = require_eod
    AND previous_settings.task_description_required = require_task_description
  THEN
    RETURN previous_settings;
  END IF;

  UPDATE public.employee_work_settings settings
  SET bos_required = require_bos,
      eod_required = require_eod,
      task_description_required = require_task_description,
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
  require_task_description BOOLEAN := true;
BEGIN
  SELECT COALESCE(settings.task_description_required, true)
  INTO require_task_description
  FROM (SELECT 1) seed
  LEFT JOIN public.employee_work_settings settings
    ON settings.employee_id = target_employee_id;

  RETURN public.set_employee_work_requirements(
    target_employee_id,
    require_bos,
    require_eod,
    require_task_description
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_task_description_requirement_for_all(
  require_task_description BOOLEAN
)
RETURNS SETOF public.employee_work_settings
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
    RAISE EXCEPTION 'Only a superadmin can change work requirements';
  END IF;

  IF require_task_description IS NULL THEN
    RAISE EXCEPTION 'Task-description requirement must be specified';
  END IF;

  INSERT INTO public.employee_work_settings (employee_id)
  SELECT employee.id
  FROM public.employees employee
  WHERE employee.status = 'Active'
  ON CONFLICT (employee_id) DO NOTHING;

  FOR previous_settings IN
    SELECT settings.*
    FROM public.employees employee
    JOIN public.employee_work_settings settings
      ON settings.employee_id = employee.id
    WHERE employee.status = 'Active'
    ORDER BY employee.id
    FOR UPDATE OF settings
  LOOP
    IF previous_settings.task_description_required = require_task_description THEN
      RETURN NEXT previous_settings;
      CONTINUE;
    END IF;

    UPDATE public.employee_work_settings settings
    SET task_description_required = require_task_description,
        updated_by = actor_employee_id,
        updated_at = clock_timestamp()
    WHERE settings.employee_id = previous_settings.employee_id
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
      saved_settings.employee_id,
      actor_employee_id,
      previous_settings.bos_required,
      saved_settings.bos_required,
      previous_settings.eod_required,
      saved_settings.eod_required,
      previous_settings.task_description_required,
      saved_settings.task_description_required,
      saved_settings.updated_at
    );

    RETURN NEXT saved_settings;
  END LOOP;

  RETURN;
END;
$$;

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
  require_task_description BOOLEAN := true;
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

  SELECT COALESCE(settings.task_description_required, true)
  INTO require_task_description
  FROM (SELECT 1) seed
  LEFT JOIN public.employee_work_settings settings
    ON settings.employee_id = actor_employee_id;

  IF require_task_description
    AND COALESCE(length(btrim(session_task_description)), 0) = 0
  THEN
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
    COALESCE(btrim(session_task_description), ''),
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
  require_task_description BOOLEAN := true;
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

  SELECT COALESCE(settings.task_description_required, true)
  INTO require_task_description
  FROM (SELECT 1) seed
  LEFT JOIN public.employee_work_settings settings
    ON settings.employee_id = actor_employee_id;

  IF require_task_description
    AND COALESCE(length(btrim(session_task_description)), 0) = 0
  THEN
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
    COALESCE(btrim(session_task_description), ''),
    session_switched_at
  )
  RETURNING * INTO created_session;

  RETURN created_session;
END;
$$;

REVOKE ALL ON FUNCTION public.set_employee_work_requirements(
  UUID,
  BOOLEAN,
  BOOLEAN,
  BOOLEAN
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_task_description_requirement_for_all(BOOLEAN)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_daily_report_requirements(UUID, BOOLEAN, BOOLEAN)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_work_session(UUID, UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.switch_work_session(UUID, UUID, TEXT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_employee_work_requirements(
  UUID,
  BOOLEAN,
  BOOLEAN,
  BOOLEAN
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_task_description_requirement_for_all(BOOLEAN)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_daily_report_requirements(UUID, BOOLEAN, BOOLEAN)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.switch_work_session(UUID, UUID, TEXT)
  TO authenticated;

-- start_work_session remains an internal boundary called by start_work_day.
REVOKE EXECUTE ON FUNCTION public.start_work_session(UUID, UUID, TEXT)
  FROM authenticated;

COMMIT;
