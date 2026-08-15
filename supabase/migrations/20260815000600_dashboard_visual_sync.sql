-- Dashboard feedback SI19 and SI26: expose existing profile photos in the
-- authenticated live board and provide the signed-in employee's reporting
-- manager through a narrow, self-scoped projection.

BEGIN;

DROP FUNCTION public.live_work_status();

CREATE FUNCTION public.live_work_status()
RETURNS TABLE (
  employee_id UUID,
  employee_name TEXT,
  employee_code TEXT,
  avatar_url TEXT,
  work_status TEXT,
  status_started_at TIMESTAMPTZ,
  context_type TEXT,
  context_id UUID,
  context_label TEXT,
  is_stale BOOLEAN,
  first_check_in_at TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ,
  break_started_at TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    employee.id AS employee_id,
    employee.name AS employee_name,
    employee.emp_code AS employee_code,
    employee.avatar_url,
    CASE
      WHEN open_entry.id IS NULL THEN 'Out'
      WHEN active_break.id IS NOT NULL THEN 'Break'
      ELSE 'In'
    END AS work_status,
    CASE
      WHEN open_entry.id IS NULL THEN COALESCE(
        today_attendance.checked_out_at,
        latest_closed_today.ended_at
      )
      WHEN active_break.id IS NOT NULL THEN active_break.started_at
      ELSE COALESCE(
        today_attendance.checked_in_at,
        first_entry_today.started_at
      )
    END AS status_started_at,
    CASE
      WHEN open_entry.activity_id IS NOT NULL THEN 'activity'
      WHEN open_entry.project_id IS NOT NULL
        AND (
          public.current_employee_role() IN ('manager', 'admin', 'superadmin')
          OR public.can_access_project(open_entry.project_id)
        )
      THEN 'project'
      ELSE NULL
    END AS context_type,
    CASE
      WHEN open_entry.activity_id IS NOT NULL THEN open_entry.activity_id
      WHEN open_entry.project_id IS NOT NULL
        AND (
          public.current_employee_role() IN ('manager', 'admin', 'superadmin')
          OR public.can_access_project(open_entry.project_id)
        )
      THEN open_entry.project_id
      ELSE NULL
    END AS context_id,
    CASE
      WHEN open_entry.activity_id IS NOT NULL THEN activity.name
      WHEN open_entry.project_id IS NOT NULL
        AND (
          public.current_employee_role() IN ('manager', 'admin', 'superadmin')
          OR public.can_access_project(open_entry.project_id)
        )
      THEN concat_ws(' · ', project.code, project.name)
      ELSE NULL
    END AS context_label,
    COALESCE(
      open_entry.started_at <= statement_timestamp() - INTERVAL '24 hours',
      false
    ) AS is_stale,
    COALESCE(
      today_attendance.checked_in_at,
      first_entry_today.started_at
    ) AS first_check_in_at,
    COALESCE(
      today_attendance.checked_in_at,
      first_entry_today.started_at
    ) AS checked_in_at,
    active_break.started_at AS break_started_at,
    CASE
      WHEN open_entry.id IS NULL
        AND COALESCE(
          today_attendance.checked_in_at,
          first_entry_today.started_at
        ) IS NOT NULL
      THEN COALESCE(
        today_attendance.checked_out_at,
        latest_closed_today.ended_at
      )
      ELSE NULL
    END AS checked_out_at
  FROM public.employees employee
  LEFT JOIN LATERAL (
    SELECT entry.*
    FROM public.work_entries entry
    WHERE entry.employee_id = employee.id
      AND entry.ended_at IS NULL
    ORDER BY entry.started_at DESC
    LIMIT 1
  ) open_entry ON true
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN attendance_entry.check_in IS NOT NULL
        THEN (attendance_entry.date + attendance_entry.check_in)
          AT TIME ZONE 'Asia/Kolkata'
        ELSE NULL
      END AS checked_in_at,
      CASE
        WHEN attendance_entry.check_out IS NOT NULL
        THEN (attendance_entry.date + attendance_entry.check_out)
          AT TIME ZONE 'Asia/Kolkata'
        ELSE NULL
      END AS checked_out_at
    FROM public.attendance attendance_entry
    WHERE attendance_entry.employee_id = employee.id
      AND attendance_entry.date = public.app_current_date(statement_timestamp())
    LIMIT 1
  ) today_attendance ON true
  LEFT JOIN LATERAL (
    SELECT min(entry.started_at) AS started_at
    FROM public.work_entries entry
    WHERE entry.employee_id = employee.id
      AND entry.started_at >= public.app_day_start(
        public.app_current_date(statement_timestamp())
      )
      AND entry.started_at < public.app_day_start(
        public.app_current_date(statement_timestamp()) + 1
      )
  ) first_entry_today ON true
  LEFT JOIN LATERAL (
    SELECT break_entry.*
    FROM public.break_entries break_entry
    WHERE break_entry.work_entry_id = open_entry.id
      AND break_entry.ended_at IS NULL
    ORDER BY break_entry.started_at DESC
    LIMIT 1
  ) active_break ON true
  LEFT JOIN LATERAL (
    SELECT entry.ended_at
    FROM public.work_entries entry
    WHERE entry.employee_id = employee.id
      AND entry.ended_at IS NOT NULL
      AND entry.ended_at >= public.app_day_start(
        public.app_current_date(statement_timestamp())
      )
      AND entry.ended_at < public.app_day_start(
        public.app_current_date(statement_timestamp()) + 1
      )
    ORDER BY entry.ended_at DESC
    LIMIT 1
  ) latest_closed_today ON true
  LEFT JOIN public.projects project
    ON project.id = open_entry.project_id
  LEFT JOIN public.activities activity
    ON activity.id = open_entry.activity_id
  WHERE employee.status = 'Active'
    AND public.current_employee_id() IS NOT NULL
  ORDER BY employee.name, employee.emp_code;
$$;

CREATE OR REPLACE FUNCTION public.current_reporting_manager()
RETURNS TABLE (
  manager_id UUID,
  manager_name TEXT,
  manager_code TEXT,
  manager_designation TEXT,
  manager_avatar_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    manager.id,
    manager.name,
    manager.emp_code,
    manager.designation,
    manager.avatar_url
  FROM public.employees employee
  LEFT JOIN public.employees manager
    ON manager.id = employee.reports_to
      AND manager.status = 'Active'
  WHERE employee.id = public.current_employee_id()
    AND employee.status = 'Active';
$$;

REVOKE ALL ON FUNCTION public.live_work_status()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_reporting_manager()
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.live_work_status()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_reporting_manager()
  TO authenticated;

COMMIT;
