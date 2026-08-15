-- HRMS-049/050/053: one factual, role-scoped Attendance calendar projection.
-- Attendance no longer derives policy guesses or exposes BOS/EOD report text.

BEGIN;

ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ;

UPDATE public.attendance
SET checked_in_at = CASE
      WHEN check_in IS NULL THEN NULL
      ELSE (date::TIMESTAMP + check_in) AT TIME ZONE 'Asia/Kolkata'
    END,
    checked_out_at = CASE
      WHEN check_out IS NULL THEN NULL
      ELSE (date::TIMESTAMP + check_out) AT TIME ZONE 'Asia/Kolkata'
    END
WHERE checked_in_at IS NULL OR (check_out IS NOT NULL AND checked_out_at IS NULL);

CREATE OR REPLACE FUNCTION public.sync_attendance_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.checked_in_at := CASE
    WHEN NEW.check_in IS NULL THEN NULL
    ELSE (NEW.date::TIMESTAMP + NEW.check_in) AT TIME ZONE 'Asia/Kolkata'
  END;
  NEW.checked_out_at := CASE
    WHEN NEW.check_out IS NULL THEN NULL
    ELSE (NEW.date::TIMESTAMP + NEW.check_out) AT TIME ZONE 'Asia/Kolkata'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_sync_timestamps ON public.attendance;
CREATE TRIGGER attendance_sync_timestamps
BEFORE INSERT OR UPDATE OF date, check_in, check_out
ON public.attendance
FOR EACH ROW
EXECUTE FUNCTION public.sync_attendance_timestamps();

-- Attendance is a projection of the controlled workday workflow. Authenticated
-- clients must not create, correct or remove attendance rows directly.
DROP POLICY IF EXISTS attendance_insert_own ON public.attendance;
CREATE POLICY attendance_insert_controlled
  ON public.attendance FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS attendance_update_own_or_superadmin ON public.attendance;
CREATE POLICY attendance_update_controlled
  ON public.attendance FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS attendance_delete_superadmin ON public.attendance;
CREATE POLICY attendance_delete_controlled
  ON public.attendance FOR DELETE TO authenticated
  USING (false);

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
  actor_employee_id UUID;
  policy_weekdays SMALLINT[];
  policy_late_after TIME;
BEGIN
  actor_employee_id := public.current_employee_id();

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

  policy_weekdays := COALESCE(
    policy_weekdays,
    ARRAY[1, 2, 3, 4, 5]::SMALLINT[]
  );

  RETURN QUERY
  SELECT
    employee.id,
    employee.name,
    employee.emp_code,
    calendar_day.attendance_date,
    calendar_day.attendance_date >= COALESCE(
      employee.date_of_joining,
      calendar_day.attendance_date
    ) AS is_employment_day,
    extract(isodow FROM calendar_day.attendance_date)::SMALLINT NOT IN (
      SELECT unnest(policy_weekdays)
    ) AS is_weekend,
    (
      calendar_day.attendance_date >= COALESCE(
        employee.date_of_joining,
        calendar_day.attendance_date
      )
      AND
      extract(isodow FROM calendar_day.attendance_date)::SMALLINT = ANY(policy_weekdays)
      AND holiday.id IS NULL
    ) AS is_working_day,
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
        OR NOT (
          extract(isodow FROM calendar_day.attendance_date)::SMALLINT = ANY(policy_weekdays)
        )
      THEN 0::NUMERIC
      WHEN approved_leave.days = 0.5 THEN 0.5::NUMERIC
      ELSE 1::NUMERIC
    END AS leave_fraction,
    CASE
      WHEN requested_employee_id = actor_employee_id OR public.can_manage_leave()
      THEN approved_leave.type
      ELSE NULL
    END AS leave_type,
    CASE
      WHEN policy_late_after IS NULL
        OR COALESCE(
          attendance.check_in,
          public.app_clock_time(work_summary.first_started_at)
        ) IS NULL
      THEN NULL
      ELSE COALESCE(
        attendance.check_in,
        public.app_clock_time(work_summary.first_started_at)
      ) > policy_late_after
    END AS is_late,
    policy_late_after
  FROM (
    SELECT generated_day::DATE AS attendance_date
    FROM generate_series(
      requested_start_date,
      requested_end_date - 1,
      INTERVAL '1 day'
    ) generated_day
  ) calendar_day
  JOIN public.employees employee
    ON employee.id = requested_employee_id
  LEFT JOIN public.holidays holiday
    ON holiday.date = calendar_day.attendance_date
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
      COALESCE(sum(
        GREATEST(
          0,
          floor(extract(epoch FROM (
            COALESCE(entry.ended_at, statement_timestamp()) - entry.started_at
          )))::BIGINT - break_summary.break_seconds
        )
      ), 0)::BIGINT AS worked_seconds,
      COALESCE(sum(break_summary.break_seconds), 0)::BIGINT AS break_seconds,
      COALESCE(bool_or(entry.ended_at IS NULL), false) AS has_open_session,
      min(entry.started_at) AS first_started_at,
      max(entry.ended_at) AS final_ended_at
    FROM public.work_entries entry
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(
        GREATEST(
          0,
          floor(extract(epoch FROM (
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
      AND public.app_current_date(entry.started_at) = calendar_day.attendance_date
  ) work_summary ON true
  ORDER BY calendar_day.attendance_date;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_attendance_timestamps()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scoped_attendance_month(DATE, DATE, TEXT, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scoped_attendance_month(DATE, DATE, TEXT, UUID)
  TO authenticated;

COMMIT;
