-- HRMS-046 extension: record Office/WFH once per Asia/Kolkata attendance day.
-- Office remains the normal start path; WFH is an explicit first-start marker.

BEGIN;

ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS work_mode TEXT;

ALTER TABLE public.attendance
  DROP CONSTRAINT IF EXISTS attendance_work_mode_check;

ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_work_mode_check
  CHECK (work_mode IS NULL OR work_mode IN ('office', 'wfh'));

CREATE OR REPLACE FUNCTION public.apply_attendance_work_mode(
  target_employee_id UUID,
  target_started_at TIMESTAMPTZ,
  target_ended_at TIMESTAMPTZ,
  target_work_mode TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalised_work_mode TEXT := lower(btrim(target_work_mode));
  attendance_date DATE := public.app_current_date(target_started_at);
  attendance_check_in TIME := public.app_clock_time(target_started_at);
BEGIN
  IF target_employee_id IS NULL OR target_started_at IS NULL THEN
    RAISE EXCEPTION 'An employee and attendance start time are required';
  END IF;

  IF normalised_work_mode IS NULL
    OR normalised_work_mode NOT IN ('office', 'wfh')
  THEN
    RAISE EXCEPTION 'Choose Office or WFH for the attendance day';
  END IF;

  INSERT INTO public.attendance (
    employee_id,
    date,
    check_in,
    check_out,
    status,
    work_mode
  )
  VALUES (
    target_employee_id,
    attendance_date,
    attendance_check_in,
    CASE
      WHEN target_ended_at IS NOT NULL
      THEN public.app_clock_time(target_ended_at)
      ELSE NULL
    END,
    CASE
      WHEN attendance_check_in >= TIME '10:30' THEN 'Late'
      ELSE 'Present'
    END,
    normalised_work_mode
  )
  ON CONFLICT (employee_id, date) DO UPDATE
  SET work_mode = EXCLUDED.work_mode;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_work_day(
  target_project_id UUID,
  target_activity_id UUID,
  session_task_description TEXT,
  beginning_of_day_report TEXT,
  declared_work_mode TEXT
)
RETURNS public.work_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET TimeZone = 'Asia/Kolkata'
AS $$
DECLARE
  actor_employee_id UUID := public.current_employee_id();
  created_session public.work_entries;
  existing_work_mode TEXT;
BEGIN
  IF declared_work_mode IS NULL
    OR lower(btrim(declared_work_mode)) NOT IN ('office', 'wfh')
  THEN
    RAISE EXCEPTION 'Choose Office or WFH before starting the workday';
  END IF;

  SELECT *
  INTO created_session
  FROM public.start_work_day(
    target_project_id,
    target_activity_id,
    session_task_description,
    beginning_of_day_report
  );

  SELECT attendance.work_mode
  INTO existing_work_mode
  FROM public.attendance attendance
  WHERE attendance.employee_id = actor_employee_id
    AND attendance.date = public.app_current_date(created_session.started_at);

  -- Reopening preserves the mode already recorded for this attendance day.
  IF existing_work_mode IS NULL THEN
    PERFORM public.apply_attendance_work_mode(
      actor_employee_id,
      created_session.started_at,
      NULL,
      declared_work_mode
    );
  END IF;

  RETURN created_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_manual_time_entry(
  target_employee_id UUID,
  target_project_id UUID,
  target_activity_id UUID,
  entry_task_description TEXT,
  entry_started_at TIMESTAMPTZ,
  entry_ended_at TIMESTAMPTZ,
  entry_breaks JSONB,
  change_reason TEXT,
  entry_work_mode TEXT
)
RETURNS public.work_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  created_entry public.work_entries;
  normalised_break RECORD;
  saved_breaks JSONB;
  normalised_work_mode TEXT := lower(btrim(entry_work_mode));
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

  IF normalised_work_mode IS NULL
    OR normalised_work_mode NOT IN ('office', 'wfh')
  THEN
    RAISE EXCEPTION 'Choose Office or WFH for the attendance day';
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

  PERFORM *
  FROM public.normalise_manual_breaks(
    entry_breaks,
    entry_started_at,
    entry_ended_at
  );

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

  FOR normalised_break IN
    SELECT *
    FROM public.normalise_manual_breaks(
      entry_breaks,
      entry_started_at,
      entry_ended_at
    )
  LOOP
    INSERT INTO public.break_entries (
      work_entry_id,
      started_at,
      ended_at
    )
    VALUES (
      created_entry.id,
      normalised_break.break_started_at,
      normalised_break.break_ended_at
    );
  END LOOP;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'started_at', break_entry.started_at,
        'ended_at', break_entry.ended_at
      )
      ORDER BY break_entry.started_at
    ),
    '[]'::JSONB
  )
  INTO saved_breaks
  FROM public.break_entries break_entry
  WHERE break_entry.work_entry_id = created_entry.id;

  PERFORM public.apply_attendance_work_mode(
    target_employee_id,
    created_entry.started_at,
    created_entry.ended_at,
    normalised_work_mode
  );

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
    '{}'::JSONB,
    to_jsonb(created_entry) || jsonb_build_object(
      'breaks', saved_breaks,
      'work_mode', normalised_work_mode
    ),
    clock_timestamp()
  );

  RETURN created_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_manual_time_entry(
  target_work_entry_id UUID,
  target_project_id UUID,
  target_activity_id UUID,
  entry_task_description TEXT,
  entry_started_at TIMESTAMPTZ,
  entry_ended_at TIMESTAMPTZ,
  entry_breaks JSONB,
  change_reason TEXT,
  entry_work_mode TEXT
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
  normalised_break RECORD;
  existing_breaks JSONB;
  requested_breaks JSONB;
  saved_breaks JSONB;
  existing_work_mode TEXT;
  normalised_work_mode TEXT := lower(btrim(entry_work_mode));
BEGIN
  actor_employee_id := public.current_employee_id();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  IF normalised_work_mode IS NULL
    OR normalised_work_mode NOT IN ('office', 'wfh')
  THEN
    RAISE EXCEPTION 'Choose Office or WFH for the attendance day';
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

  PERFORM *
  FROM public.normalise_manual_breaks(
    entry_breaks,
    entry_started_at,
    entry_ended_at
  );

  SELECT attendance.work_mode
  INTO existing_work_mode
  FROM public.attendance attendance
  WHERE attendance.employee_id = existing_entry.employee_id
    AND attendance.date = public.app_current_date(existing_entry.started_at);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'started_at', break_entry.started_at,
        'ended_at', break_entry.ended_at
      )
      ORDER BY break_entry.started_at
    ),
    '[]'::JSONB
  )
  INTO existing_breaks
  FROM public.break_entries break_entry
  WHERE break_entry.work_entry_id = existing_entry.id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'started_at', normalised.break_started_at,
        'ended_at', normalised.break_ended_at
      )
      ORDER BY normalised.break_started_at
    ),
    '[]'::JSONB
  )
  INTO requested_breaks
  FROM public.normalise_manual_breaks(
    entry_breaks,
    entry_started_at,
    entry_ended_at
  ) normalised;

  IF existing_entry.project_id IS NOT DISTINCT FROM target_project_id
    AND existing_entry.activity_id IS NOT DISTINCT FROM target_activity_id
    AND existing_entry.task_description = btrim(entry_task_description)
    AND existing_entry.started_at = entry_started_at
    AND existing_entry.ended_at = entry_ended_at
    AND existing_breaks = requested_breaks
    AND existing_work_mode IS NOT DISTINCT FROM normalised_work_mode
  THEN
    RAISE EXCEPTION 'At least one time-entry or work-mode value must change';
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

  DELETE FROM public.break_entries
  WHERE work_entry_id = corrected_entry.id;

  FOR normalised_break IN
    SELECT *
    FROM public.normalise_manual_breaks(
      entry_breaks,
      entry_started_at,
      entry_ended_at
    )
  LOOP
    INSERT INTO public.break_entries (
      work_entry_id,
      started_at,
      ended_at
    )
    VALUES (
      corrected_entry.id,
      normalised_break.break_started_at,
      normalised_break.break_ended_at
    );
  END LOOP;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'started_at', break_entry.started_at,
        'ended_at', break_entry.ended_at
      )
      ORDER BY break_entry.started_at
    ),
    '[]'::JSONB
  )
  INTO saved_breaks
  FROM public.break_entries break_entry
  WHERE break_entry.work_entry_id = corrected_entry.id;

  PERFORM public.apply_attendance_work_mode(
    existing_entry.employee_id,
    entry_started_at,
    entry_ended_at,
    normalised_work_mode
  );

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
    to_jsonb(existing_entry) || jsonb_build_object(
      'breaks', existing_breaks,
      'work_mode', existing_work_mode
    ),
    to_jsonb(corrected_entry) || jsonb_build_object(
      'breaks', saved_breaks,
      'work_mode', normalised_work_mode
    ),
    clock_timestamp()
  );

  RETURN corrected_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.scoped_attendance_work_modes(
  requested_start_date DATE,
  requested_end_date DATE,
  requested_scope TEXT,
  requested_employee_id UUID DEFAULT NULL
)
RETURNS TABLE (
  employee_id UUID,
  attendance_date DATE,
  work_mode TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF requested_start_date IS NULL
    OR requested_end_date IS NULL
    OR requested_end_date <= requested_start_date
    OR requested_end_date - requested_start_date > 31
  THEN
    RAISE EXCEPTION 'Choose a valid attendance range of 31 days or fewer';
  END IF;

  IF requested_employee_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.timesheet_scope_members(requested_scope) member
      WHERE member.employee_id = requested_employee_id
    )
  THEN
    RAISE EXCEPTION 'The selected employee is outside this timesheet scope';
  END IF;

  RETURN QUERY
  SELECT
    attendance.employee_id,
    attendance.date,
    attendance.work_mode
  FROM public.attendance attendance
  JOIN public.timesheet_scope_members(requested_scope) member
    ON member.employee_id = attendance.employee_id
  WHERE attendance.date >= requested_start_date
    AND attendance.date < requested_end_date
    AND (
      requested_employee_id IS NULL
      OR attendance.employee_id = requested_employee_id
    )
  ORDER BY attendance.date, attendance.employee_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.live_attendance_work_modes()
RETURNS TABLE (
  employee_id UUID,
  work_mode TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    employee.id,
    attendance.work_mode
  FROM public.employees employee
  LEFT JOIN public.attendance attendance
    ON attendance.employee_id = employee.id
   AND attendance.date = public.app_current_date(statement_timestamp())
  WHERE employee.status = 'Active'
    AND public.current_employee_id() IS NOT NULL
  ORDER BY employee.name, employee.emp_code;
$$;

REVOKE ALL ON FUNCTION public.apply_attendance_work_mode(
  UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_work_day(
  UUID, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_manual_time_entry(
  UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.correct_manual_time_entry(
  UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.scoped_attendance_work_modes(
  DATE, DATE, TEXT, UUID
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.live_attendance_work_modes()
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.start_work_day(
  UUID, UUID, TEXT, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_time_entry(
  UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_manual_time_entry(
  UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scoped_attendance_work_modes(
  DATE, DATE, TEXT, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.live_attendance_work_modes()
  TO authenticated;

COMMIT;
