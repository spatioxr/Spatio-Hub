-- HRMS-023: authorised manual time-entry creation and correction with breaks.
-- Change-history presentation remains tracked separately by HRMS-024.

BEGIN;

CREATE OR REPLACE FUNCTION public.normalise_manual_breaks(
  entry_breaks JSONB,
  entry_started_at TIMESTAMPTZ,
  entry_ended_at TIMESTAMPTZ
)
RETURNS TABLE (
  break_started_at TIMESTAMPTZ,
  break_ended_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  break_value JSONB;
  previous_break_end TIMESTAMPTZ;
BEGIN
  entry_breaks := COALESCE(entry_breaks, '[]'::JSONB);

  IF jsonb_typeof(entry_breaks) <> 'array' THEN
    RAISE EXCEPTION 'Breaks must be supplied as a list';
  END IF;

  IF jsonb_array_length(entry_breaks) > 20 THEN
    RAISE EXCEPTION 'A manual entry cannot contain more than 20 breaks';
  END IF;

  FOR break_value IN
    SELECT break_item.value
    FROM jsonb_array_elements(entry_breaks) break_item(value)
  LOOP
    IF jsonb_typeof(break_value) <> 'object'
      OR NULLIF(btrim(break_value ->> 'started_at'), '') IS NULL
      OR NULLIF(btrim(break_value ->> 'ended_at'), '') IS NULL
    THEN
      RAISE EXCEPTION 'Every break requires a start and end time';
    END IF;
  END LOOP;

  FOR break_started_at, break_ended_at IN
    SELECT
      (break_item.value ->> 'started_at')::TIMESTAMPTZ,
      (break_item.value ->> 'ended_at')::TIMESTAMPTZ
    FROM jsonb_array_elements(entry_breaks) break_item(value)
    ORDER BY (break_item.value ->> 'started_at')::TIMESTAMPTZ
  LOOP
    IF break_ended_at <= break_started_at THEN
      RAISE EXCEPTION 'Every break must have a positive duration';
    END IF;

    IF break_started_at < entry_started_at
      OR break_ended_at > entry_ended_at
    THEN
      RAISE EXCEPTION 'Every break must stay inside the work-entry time range';
    END IF;

    IF previous_break_end IS NOT NULL
      AND break_started_at < previous_break_end
    THEN
      RAISE EXCEPTION 'Break times cannot overlap';
    END IF;

    previous_break_end := break_ended_at;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.manual_time_entry_contexts(
  target_employee_id UUID
)
RETURNS TABLE (
  context_type TEXT,
  context_id UUID,
  context_label TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_employee_id() IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  IF NOT public.can_create_manual_work_entry(target_employee_id, NULL)
    AND NOT EXISTS (
      SELECT 1
      FROM public.projects project
      WHERE project.archived_at IS NULL
        AND public.can_create_manual_work_entry(
          target_employee_id,
          project.id
        )
    )
  THEN
    RAISE EXCEPTION 'You cannot manage time entries for this employee';
  END IF;

  RETURN QUERY
  SELECT
    'project'::TEXT,
    project.id,
    concat_ws(' · ', project.code, project.name)
  FROM public.projects project
  WHERE project.archived_at IS NULL
    AND public.can_create_manual_work_entry(
      target_employee_id,
      project.id
    )
  UNION ALL
  SELECT
    'activity'::TEXT,
    activity.id,
    activity.name
  FROM public.activities activity
  WHERE activity.archived_at IS NULL
    AND public.can_create_manual_work_entry(target_employee_id, NULL)
  ORDER BY 1 DESC, 3;
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
  normalised_break RECORD;
  saved_breaks JSONB;
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
    to_jsonb(created_entry) || jsonb_build_object('breaks', saved_breaks),
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
  normalised_break RECORD;
  existing_breaks JSONB;
  requested_breaks JSONB;
  saved_breaks JSONB;
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

  PERFORM *
  FROM public.normalise_manual_breaks(
    entry_breaks,
    entry_started_at,
    entry_ended_at
  );

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
  THEN
    RAISE EXCEPTION 'At least one time-entry value must change';
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
    to_jsonb(existing_entry) || jsonb_build_object('breaks', existing_breaks),
    to_jsonb(corrected_entry) || jsonb_build_object('breaks', saved_breaks),
    clock_timestamp()
  );

  RETURN corrected_entry;
END;
$$;

REVOKE ALL ON FUNCTION public.normalise_manual_breaks(
  JSONB,
  TIMESTAMPTZ,
  TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manual_time_entry_contexts(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_manual_time_entry(
  UUID,
  UUID,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  JSONB,
  TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.correct_manual_time_entry(
  UUID,
  UUID,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  JSONB,
  TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.manual_time_entry_contexts(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_time_entry(
  UUID,
  UUID,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  JSONB,
  TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_manual_time_entry(
  UUID,
  UUID,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  JSONB,
  TEXT
) TO authenticated;

COMMIT;
