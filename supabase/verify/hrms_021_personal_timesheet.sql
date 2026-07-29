-- HRMS-021 rollback-only behavioural verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

DO $$
DECLARE
  original_actor_id UUID;
  actor_auth_id UUID;
  timesheet_actor_id UUID;
  other_employee_id UUID;
  activity_id UUID;
  project_id UUID;
  fixture_work_entry_id UUID;
  range_start TIMESTAMPTZ := date_trunc('week', statement_timestamp());
BEGIN
  SELECT employee.id, employee.auth_id
  INTO original_actor_id, actor_auth_id
  FROM public.employees employee
  WHERE employee.role = 'superadmin'
    AND employee.status = 'Active'
    AND employee.auth_id IS NOT NULL
  LIMIT 1;

  IF original_actor_id IS NULL THEN
    RAISE EXCEPTION 'An Auth-linked active superadmin is required';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', actor_auth_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  UPDATE public.employees
  SET auth_id = NULL
  WHERE id = original_actor_id;

  INSERT INTO public.employees (
    auth_id,
    emp_code,
    name,
    email,
    role,
    status
  )
  VALUES (
    actor_auth_id,
    'HRMS021ACTOR',
    'HRMS-021 Timesheet Viewer',
    'hrms-021-viewer@example.invalid',
    'employee',
    'Active'
  )
  RETURNING id INTO timesheet_actor_id;

  INSERT INTO public.employees (emp_code, name, email, role, status)
  VALUES (
    'HRMS021OTHER',
    'HRMS-021 Other Employee',
    'hrms-021-other@example.invalid',
    'employee',
    'Active'
  )
  RETURNING id INTO other_employee_id;

  SELECT id INTO activity_id
  FROM public.activities
  WHERE name = 'Pre-sales'
    AND archived_at IS NULL;

  INSERT INTO public.projects (code, name, description, created_by)
  VALUES (
    'HRMS021VERIFY',
    'HRMS-021 Project',
    'Rollback-only personal-timesheet verification.',
    original_actor_id
  )
  RETURNING id INTO project_id;

  INSERT INTO public.project_members (
    project_id,
    employee_id,
    assigned_by
  )
  VALUES (project_id, timesheet_actor_id, original_actor_id);

  INSERT INTO public.work_entries (
    employee_id,
    project_id,
    task_description,
    started_at,
    ended_at
  )
  VALUES (
    timesheet_actor_id,
    project_id,
    'Build the weekly timesheet.',
    range_start + INTERVAL '9 hours',
    range_start + INTERVAL '15 hours'
  )
  RETURNING id INTO fixture_work_entry_id;

  INSERT INTO public.break_entries (
    work_entry_id,
    started_at,
    ended_at
  )
  VALUES (
    fixture_work_entry_id,
    range_start + INTERVAL '12 hours',
    range_start + INTERVAL '13 hours'
  );

  INSERT INTO public.work_entries (
    employee_id,
    activity_id,
    task_description,
    started_at,
    ended_at
  )
  VALUES
    (
      timesheet_actor_id,
      activity_id,
      'Prepare a project estimate.',
      range_start + INTERVAL '1 day 9 hours',
      range_start + INTERVAL '1 day 11 hours'
    ),
    (
      other_employee_id,
      activity_id,
      'This row must remain private.',
      range_start + INTERVAL '9 hours',
      range_start + INTERVAL '10 hours'
    );

  IF (
    SELECT count(*)
    FROM public.personal_timesheet_entries(
      range_start,
      range_start + INTERVAL '7 days'
    )
  ) <> 2 THEN
    RAISE EXCEPTION 'Personal projection did not return exactly the actor rows';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.personal_timesheet_entries(
      range_start,
      range_start + INTERVAL '7 days'
    ) entry
    WHERE entry.work_entry_id = fixture_work_entry_id
      AND entry.worked_seconds = 18000
      AND entry.break_seconds = 3600
      AND entry.context_type = 'project'
      AND entry.context_id = project_id
      AND entry.context_label = 'HRMS021VERIFY · HRMS-021 Project'
      AND entry.task_description = 'Build the weekly timesheet.'
      AND jsonb_array_length(entry.breaks) = 1
      AND (entry.breaks -> 0 ->> 'duration_seconds')::BIGINT = 3600
  ) THEN
    RAISE EXCEPTION 'Project session, break, or worked duration is incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.personal_timesheet_entries(
      range_start,
      range_start + INTERVAL '7 days'
    ) entry
    WHERE entry.context_type = 'activity'
      AND entry.context_id = activity_id
      AND entry.context_label = 'Pre-sales'
      AND entry.task_description = 'Prepare a project estimate.'
      AND entry.worked_seconds = 7200
      AND entry.break_seconds = 0
  ) THEN
    RAISE EXCEPTION 'Activity session detail is incorrect';
  END IF;

  BEGIN
    PERFORM *
    FROM public.personal_timesheet_entries(
      range_start,
      range_start + INTERVAL '32 days'
    );
    RAISE EXCEPTION 'Range longer than 31 days was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'Range longer than 31 days was accepted' THEN
        RAISE;
      END IF;
  END;

  IF has_function_privilege(
    'anon',
    'public.personal_timesheet_entries(timestamptz,timestamptz)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.personal_timesheet_entries(timestamptz,timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Personal-timesheet function grants are incorrect';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', gen_random_uuid()::text,
      'role', 'authenticated'
    )::text,
    true
  );
  BEGIN
    PERFORM *
    FROM public.personal_timesheet_entries(
      range_start,
      range_start + INTERVAL '7 days'
    );
    RAISE EXCEPTION 'An unlinked identity received personal timesheet data';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'An unlinked identity received personal timesheet data' THEN
        RAISE;
      END IF;
  END;
END
$$;

SELECT
  true AS all_checks_pass,
  jsonb_build_object(
    'self_only_scope', true,
    'weekly_range_supported', true,
    'project_context_visible', true,
    'activity_context_visible', true,
    'task_descriptions_visible', true,
    'break_detail_visible', true,
    'worked_time_excludes_breaks', true,
    'range_guard_enforced', true,
    'anonymous_execute_denied', true,
    'authenticated_execute_granted', true,
    'unlinked_identity_denied', true
  ) AS checks;

ROLLBACK;
