-- HRMS-054: audited voiding for accidental manual time entries.
-- UI persistence and month presentation are implemented in the application.

BEGIN;

ALTER TABLE public.work_entries
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE public.work_entries
  DROP CONSTRAINT IF EXISTS work_entries_void_fields_check;

ALTER TABLE public.work_entries
  ADD CONSTRAINT work_entries_void_fields_check
  CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (
      voided_at IS NOT NULL
      AND voided_by IS NOT NULL
      AND length(btrim(void_reason)) > 0
    )
  );

-- The original unnamed exclusion constraint includes every row. Voided rows
-- remain immutable history but must no longer block a corrected replacement.
ALTER TABLE public.work_entries
  DROP CONSTRAINT IF EXISTS work_entries_employee_id_tstzrange_excl;
ALTER TABLE public.work_entries
  DROP CONSTRAINT IF EXISTS work_entries_no_active_overlap;

ALTER TABLE public.work_entries
  ADD CONSTRAINT work_entries_no_active_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    tstzrange(
      started_at,
      COALESCE(ended_at, 'infinity'::TIMESTAMPTZ),
      '[)'
    ) WITH &&
  ) WHERE (voided_at IS NULL);

CREATE OR REPLACE FUNCTION public.prevent_voided_work_entry_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Voided work entries are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_entries_prevent_voided_mutation
  ON public.work_entries;
CREATE TRIGGER work_entries_prevent_voided_mutation
  BEFORE UPDATE ON public.work_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_voided_work_entry_mutation();

CREATE OR REPLACE FUNCTION public.void_manual_time_entry(
  target_work_entry_id UUID,
  change_reason TEXT
)
RETURNS public.work_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID := public.current_employee_id();
  existing_entry public.work_entries;
  voided_entry public.work_entries;
  existing_breaks JSONB;
  existing_work_mode TEXT;
  remaining_first_started_at TIMESTAMPTZ;
  remaining_final_ended_at TIMESTAMPTZ;
  remaining_has_open_session BOOLEAN;
BEGIN
  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  IF COALESCE(length(btrim(change_reason)), 0) = 0 THEN
    RAISE EXCEPTION 'A void reason is required';
  END IF;

  SELECT entry.*
  INTO existing_entry
  FROM public.work_entries entry
  WHERE entry.id = target_work_entry_id
  FOR UPDATE;

  IF existing_entry.id IS NULL THEN
    RAISE EXCEPTION 'Work entry not found';
  END IF;

  IF existing_entry.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'This work entry is already voided';
  END IF;

  IF existing_entry.ended_at IS NULL THEN
    RAISE EXCEPTION 'End the live work session before voiding it';
  END IF;

  IF NOT public.can_correct_work_entry(target_work_entry_id) THEN
    RAISE EXCEPTION 'You cannot void this work entry';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'started_at', break_entry.started_at,
        'ended_at', break_entry.ended_at
      ) ORDER BY break_entry.started_at
    ),
    '[]'::JSONB
  )
  INTO existing_breaks
  FROM public.break_entries break_entry
  WHERE break_entry.work_entry_id = existing_entry.id;

  SELECT attendance.work_mode
  INTO existing_work_mode
  FROM public.attendance attendance
  WHERE attendance.employee_id = existing_entry.employee_id
    AND attendance.date = public.app_current_date(existing_entry.started_at);

  UPDATE public.work_entries
  SET voided_at = clock_timestamp(),
      voided_by = actor_employee_id,
      void_reason = btrim(change_reason),
      corrected_by = actor_employee_id,
      correction_reason = btrim(change_reason)
  WHERE id = existing_entry.id
  RETURNING * INTO voided_entry;

  SELECT
    min(entry.started_at),
    max(entry.ended_at),
    COALESCE(bool_or(entry.ended_at IS NULL), false)
  INTO
    remaining_first_started_at,
    remaining_final_ended_at,
    remaining_has_open_session
  FROM public.work_entries entry
  WHERE entry.employee_id = existing_entry.employee_id
    AND entry.voided_at IS NULL
    AND public.app_current_date(entry.started_at) = public.app_current_date(existing_entry.started_at);

  IF remaining_first_started_at IS NULL THEN
    DELETE FROM public.attendance
    WHERE employee_id = existing_entry.employee_id
      AND date = public.app_current_date(existing_entry.started_at);
  ELSE
    UPDATE public.attendance
    SET check_in = public.app_clock_time(remaining_first_started_at),
        check_out = CASE
          WHEN remaining_has_open_session THEN NULL
          ELSE public.app_clock_time(remaining_final_ended_at)
        END,
        status = CASE
          WHEN public.app_clock_time(remaining_first_started_at) >= TIME '10:30' THEN 'Late'
          ELSE 'Present'
        END
    WHERE employee_id = existing_entry.employee_id
      AND date = public.app_current_date(existing_entry.started_at);
  END IF;

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
    voided_entry.id,
    voided_entry.employee_id,
    actor_employee_id,
    btrim(change_reason),
    to_jsonb(existing_entry) || jsonb_build_object(
      'breaks', existing_breaks,
      'work_mode', existing_work_mode
    ),
    to_jsonb(voided_entry) || jsonb_build_object(
      'breaks', existing_breaks,
      'work_mode', existing_work_mode
    ),
    clock_timestamp()
  );

  RETURN voided_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.scoped_timesheet_entries(
  requested_start_at TIMESTAMPTZ,
  requested_end_at TIMESTAMPTZ,
  requested_scope TEXT,
  requested_employee_id UUID DEFAULT NULL
)
RETURNS TABLE (
  work_entry_id UUID,
  employee_id UUID,
  employee_name TEXT,
  employee_code TEXT,
  employee_department TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  worked_seconds BIGINT,
  break_seconds BIGINT,
  context_type TEXT,
  context_id UUID,
  context_label TEXT,
  task_description TEXT,
  breaks JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID := public.current_employee_id();
  actor_role TEXT := public.current_employee_role();
BEGIN
  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  IF requested_start_at IS NULL
    OR requested_end_at IS NULL
    OR requested_end_at <= requested_start_at
    OR requested_end_at - requested_start_at > INTERVAL '31 days'
  THEN
    RAISE EXCEPTION 'Choose a valid timesheet range of 31 days or fewer';
  END IF;

  IF requested_scope NOT IN ('personal', 'managed', 'organisation') THEN
    RAISE EXCEPTION 'Choose a valid timesheet scope';
  END IF;

  IF requested_scope = 'managed' AND actor_role <> 'manager' THEN
    RAISE EXCEPTION 'Managed timesheets require the manager role';
  END IF;

  IF requested_scope = 'organisation'
    AND actor_role NOT IN ('admin', 'superadmin')
  THEN
    RAISE EXCEPTION 'Organisation timesheets require organisation access';
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
    entry.id,
    employee.id,
    employee.name,
    employee.emp_code,
    employee.department,
    entry.started_at,
    entry.ended_at,
    GREATEST(
      0,
      FLOOR(EXTRACT(EPOCH FROM (
        COALESCE(entry.ended_at, statement_timestamp()) - entry.started_at
      )))::BIGINT - break_summary.break_seconds
    ),
    break_summary.break_seconds,
    CASE WHEN entry.project_id IS NOT NULL THEN 'project' ELSE 'activity' END,
    COALESCE(entry.project_id, entry.activity_id),
    CASE
      WHEN entry.project_id IS NOT NULL
      THEN concat_ws(' · ', project.code, project.name)
      ELSE activity.name
    END,
    entry.task_description,
    break_summary.breaks
  FROM public.work_entries entry
  JOIN public.employees employee ON employee.id = entry.employee_id
  LEFT JOIN public.projects project ON project.id = entry.project_id
  LEFT JOIN public.activities activity ON activity.id = entry.activity_id
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(
        GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (
            LEAST(
              COALESCE(break_entry.ended_at, statement_timestamp()),
              COALESCE(entry.ended_at, statement_timestamp())
            ) - break_entry.started_at
          )))::BIGINT
        )
      ), 0)::BIGINT AS break_seconds,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', break_entry.id,
            'started_at', break_entry.started_at,
            'ended_at', break_entry.ended_at,
            'duration_seconds', GREATEST(
              0,
              FLOOR(EXTRACT(EPOCH FROM (
                LEAST(
                  COALESCE(break_entry.ended_at, statement_timestamp()),
                  COALESCE(entry.ended_at, statement_timestamp())
                ) - break_entry.started_at
              )))::BIGINT
            )
          ) ORDER BY break_entry.started_at
        ) FILTER (WHERE break_entry.id IS NOT NULL),
        '[]'::JSONB
      ) AS breaks
    FROM public.break_entries break_entry
    WHERE break_entry.work_entry_id = entry.id
  ) break_summary ON true
  WHERE entry.voided_at IS NULL
    AND entry.started_at >= requested_start_at
    AND entry.started_at < requested_end_at
    AND (
      (requested_scope = 'personal' AND entry.employee_id = actor_employee_id)
      OR (
        requested_scope = 'managed'
        AND actor_role = 'manager'
        AND EXISTS (
          SELECT 1
          FROM public.project_managers manager_assignment
          JOIN public.project_members member_assignment
            ON member_assignment.project_id = manager_assignment.project_id
          WHERE manager_assignment.employee_id = actor_employee_id
            AND member_assignment.employee_id = entry.employee_id
        )
      )
      OR (
        requested_scope = 'organisation'
        AND actor_role IN ('admin', 'superadmin')
      )
    )
    AND (requested_employee_id IS NULL OR entry.employee_id = requested_employee_id)
  ORDER BY entry.started_at, employee.name, employee.emp_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.scoped_attendance_month(
  requested_start_date DATE,
  requested_end_date DATE,
  requested_scope TEXT,
  requested_employee_id UUID
)
RETURNS TABLE (
  employee_id UUID,
  employee_name TEXT,
  employee_code TEXT,
  attendance_date DATE,
  is_employment_day BOOLEAN,
  is_weekend BOOLEAN,
  is_working_day BOOLEAN,
  holiday_id UUID,
  holiday_name TEXT,
  checked_in_at TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ,
  work_mode TEXT,
  worked_seconds BIGINT,
  break_seconds BIGINT,
  has_open_session BOOLEAN,
  approved_leave_id UUID,
  leave_fraction NUMERIC,
  leave_type TEXT,
  is_late BOOLEAN,
  late_after TIME
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID := public.current_employee_id();
  policy_weekdays SMALLINT[];
  policy_late_after TIME;
BEGIN
  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  IF requested_start_date IS NULL
    OR requested_end_date IS NULL
    OR requested_end_date <= requested_start_date
    OR requested_end_date - requested_start_date > 32
  THEN
    RAISE EXCEPTION 'Choose a valid attendance range of 32 days or fewer';
  END IF;

  IF requested_employee_id IS NULL THEN
    RAISE EXCEPTION 'Choose an employee for the attendance calendar';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.timesheet_scope_members(requested_scope) member
    WHERE member.employee_id = requested_employee_id
  ) THEN
    RAISE EXCEPTION 'The selected employee is outside this attendance scope';
  END IF;

  SELECT policy.working_weekdays, policy.late_after
  INTO policy_weekdays, policy_late_after
  FROM public.attendance_policy policy
  WHERE policy.singleton;

  policy_weekdays := COALESCE(policy_weekdays, ARRAY[1, 2, 3, 4, 5]::SMALLINT[]);

  RETURN QUERY
  SELECT
    employee.id,
    employee.name,
    employee.emp_code,
    calendar_day.attendance_date,
    calendar_day.attendance_date >= COALESCE(employee.date_of_joining, calendar_day.attendance_date),
    extract(isodow FROM calendar_day.attendance_date)::SMALLINT NOT IN (
      SELECT unnest(policy_weekdays)
    ),
    (
      calendar_day.attendance_date >= COALESCE(employee.date_of_joining, calendar_day.attendance_date)
      AND extract(isodow FROM calendar_day.attendance_date)::SMALLINT = ANY(policy_weekdays)
      AND holiday.id IS NULL
    ),
    holiday.id,
    holiday.name,
    COALESCE(attendance.checked_in_at, work_summary.first_started_at),
    CASE
      WHEN work_summary.has_open_session THEN NULL
      ELSE COALESCE(attendance.checked_out_at, work_summary.final_ended_at)
    END,
    attendance.work_mode,
    COALESCE(work_summary.worked_seconds, 0)::BIGINT,
    COALESCE(work_summary.break_seconds, 0)::BIGINT,
    COALESCE(work_summary.has_open_session, false),
    approved_leave.id,
    CASE
      WHEN approved_leave.id IS NULL
        OR holiday.id IS NOT NULL
        OR extract(isodow FROM calendar_day.attendance_date)::SMALLINT <> ALL(policy_weekdays)
      THEN 0::NUMERIC
      WHEN approved_leave.days = 0.5 THEN 0.5::NUMERIC
      ELSE 1::NUMERIC
    END,
    CASE
      WHEN requested_employee_id = actor_employee_id OR public.can_manage_leave()
      THEN approved_leave.type
      ELSE NULL
    END,
    CASE
      WHEN policy_late_after IS NULL
        OR COALESCE(attendance.check_in, public.app_clock_time(work_summary.first_started_at)) IS NULL
      THEN NULL
      ELSE COALESCE(
        attendance.check_in,
        public.app_clock_time(work_summary.first_started_at)
      ) > policy_late_after
    END,
    policy_late_after
  FROM (
    SELECT generated_day::DATE AS attendance_date
    FROM generate_series(
      requested_start_date,
      requested_end_date - 1,
      INTERVAL '1 day'
    ) generated_day
  ) calendar_day
  JOIN public.employees employee ON employee.id = requested_employee_id
  LEFT JOIN public.holidays holiday ON holiday.date = calendar_day.attendance_date
  LEFT JOIN public.attendance attendance
    ON attendance.employee_id = requested_employee_id
   AND attendance.date = calendar_day.attendance_date
  LEFT JOIN LATERAL (
    SELECT request.*
    FROM public.leaves request
    WHERE request.employee_id = requested_employee_id
      AND request.status = 'Approved'
      AND calendar_day.attendance_date BETWEEN request.from_date AND request.to_date
    ORDER BY request.created_at DESC
    LIMIT 1
  ) approved_leave ON true
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(
        GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (
            COALESCE(entry.ended_at, statement_timestamp()) - entry.started_at
          )))::BIGINT - break_summary.break_seconds
        )
      ), 0)::BIGINT,
      COALESCE(SUM(break_summary.break_seconds), 0)::BIGINT,
      COALESCE(bool_or(entry.ended_at IS NULL), false),
      min(entry.started_at),
      max(entry.ended_at)
    FROM public.work_entries entry
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(
        GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (
            LEAST(
              COALESCE(break_entry.ended_at, statement_timestamp()),
              COALESCE(entry.ended_at, statement_timestamp())
            ) - break_entry.started_at
          )))::BIGINT
        )
      ), 0)::BIGINT AS break_seconds
      FROM public.break_entries break_entry
      WHERE break_entry.work_entry_id = entry.id
    ) break_summary ON true
    WHERE entry.employee_id = requested_employee_id
      AND entry.voided_at IS NULL
      AND public.app_current_date(entry.started_at) = calendar_day.attendance_date
  ) work_summary(
    worked_seconds,
    break_seconds,
    has_open_session,
    first_started_at,
    final_ended_at
  ) ON true
  ORDER BY calendar_day.attendance_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.scoped_voided_timesheet_entries(
  requested_start_at TIMESTAMPTZ,
  requested_end_at TIMESTAMPTZ,
  requested_scope TEXT,
  requested_employee_id UUID DEFAULT NULL
)
RETURNS TABLE (
  work_entry_id UUID,
  employee_id UUID,
  employee_name TEXT,
  employee_code TEXT,
  employee_department TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  context_type TEXT,
  context_id UUID,
  context_label TEXT,
  task_description TEXT,
  voided_at TIMESTAMPTZ,
  void_reason TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID := public.current_employee_id();
  actor_role TEXT := public.current_employee_role();
BEGIN
  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  IF requested_start_at IS NULL
    OR requested_end_at IS NULL
    OR requested_end_at <= requested_start_at
    OR requested_end_at - requested_start_at > INTERVAL '31 days'
  THEN
    RAISE EXCEPTION 'Choose a valid timesheet range of 31 days or fewer';
  END IF;

  IF requested_scope NOT IN ('personal', 'managed', 'organisation') THEN
    RAISE EXCEPTION 'Choose a valid timesheet scope';
  END IF;

  IF requested_employee_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.timesheet_scope_members(requested_scope) member
      WHERE member.employee_id = requested_employee_id
    )
  THEN
    RAISE EXCEPTION 'The selected employee is outside this timesheet scope';
  END IF;

  RETURN QUERY
  SELECT
    entry.id,
    employee.id,
    employee.name,
    employee.emp_code,
    employee.department,
    entry.started_at,
    entry.ended_at,
    CASE WHEN entry.project_id IS NOT NULL THEN 'project' ELSE 'activity' END,
    COALESCE(entry.project_id, entry.activity_id),
    CASE
      WHEN entry.project_id IS NOT NULL THEN concat_ws(' · ', project.code, project.name)
      ELSE activity.name
    END,
    entry.task_description,
    entry.voided_at,
    entry.void_reason
  FROM public.work_entries entry
  JOIN public.employees employee ON employee.id = entry.employee_id
  LEFT JOIN public.projects project ON project.id = entry.project_id
  LEFT JOIN public.activities activity ON activity.id = entry.activity_id
  WHERE entry.voided_at IS NOT NULL
    AND entry.started_at >= requested_start_at
    AND entry.started_at < requested_end_at
    AND (
      (requested_scope = 'personal' AND entry.employee_id = actor_employee_id)
      OR (
        requested_scope = 'managed'
        AND actor_role = 'manager'
        AND EXISTS (
          SELECT 1
          FROM public.project_managers manager_assignment
          JOIN public.project_members member_assignment
            ON member_assignment.project_id = manager_assignment.project_id
          WHERE manager_assignment.employee_id = actor_employee_id
            AND member_assignment.employee_id = entry.employee_id
        )
      )
      OR (requested_scope = 'organisation' AND actor_role IN ('admin', 'superadmin'))
    )
    AND (requested_employee_id IS NULL OR entry.employee_id = requested_employee_id)
  ORDER BY entry.started_at, employee.name, employee.emp_code;
END;
$$;

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
  actor_employee_id UUID := public.current_employee_id();
  actor_role TEXT := public.current_employee_role();
  target_employee_id UUID;
BEGIN
  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  SELECT entry.employee_id INTO target_employee_id
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
      WHEN NULLIF(audit.new_record ->> 'voided_at', '') IS NOT NULL THEN 'voided'
      WHEN audit.old_record = '{}'::JSONB THEN 'created'
      ELSE 'corrected'
    END,
    audit.changed_at,
    audit.change_reason,
    editor.id,
    editor.name,
    editor.emp_code,
    audit.old_record || jsonb_build_object(
      'context_type', CASE
        WHEN NULLIF(audit.old_record ->> 'project_id', '') IS NOT NULL THEN 'project'
        WHEN NULLIF(audit.old_record ->> 'activity_id', '') IS NOT NULL THEN 'activity'
        ELSE NULL
      END,
      'context_label', CASE
        WHEN old_project.id IS NOT NULL THEN concat_ws(' · ', old_project.code, old_project.name)
        ELSE old_activity.name
      END
    ),
    audit.new_record || jsonb_build_object(
      'context_type', CASE
        WHEN NULLIF(audit.new_record ->> 'project_id', '') IS NOT NULL THEN 'project'
        WHEN NULLIF(audit.new_record ->> 'activity_id', '') IS NOT NULL THEN 'activity'
        ELSE NULL
      END,
      'context_label', CASE
        WHEN new_project.id IS NOT NULL THEN concat_ws(' · ', new_project.code, new_project.name)
        ELSE new_activity.name
      END
    )
  FROM public.work_entry_audit audit
  JOIN public.employees editor ON editor.id = audit.changed_by
  LEFT JOIN public.projects old_project
    ON old_project.id = NULLIF(audit.old_record ->> 'project_id', '')::UUID
  LEFT JOIN public.activities old_activity
    ON old_activity.id = NULLIF(audit.old_record ->> 'activity_id', '')::UUID
  LEFT JOIN public.projects new_project
    ON new_project.id = NULLIF(audit.new_record ->> 'project_id', '')::UUID
  LEFT JOIN public.activities new_activity
    ON new_activity.id = NULLIF(audit.new_record ->> 'activity_id', '')::UUID
  WHERE audit.work_entry_id = target_work_entry_id
  ORDER BY audit.changed_at DESC, audit.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_voided_work_entry_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_manual_time_entry(UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.scoped_voided_timesheet_entries(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT,
  UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_manual_time_entry(UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.scoped_voided_timesheet_entries(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT,
  UUID
) TO authenticated;

COMMIT;
