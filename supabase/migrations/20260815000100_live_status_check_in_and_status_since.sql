-- Feedback SI1 / HRMS-020: expose the original daily check-in separately from
-- the current context, break, or out transition shown by the live-status UI.

BEGIN;

DROP FUNCTION public.live_work_status();

CREATE FUNCTION public.live_work_status()
RETURNS TABLE (
  employee_id UUID,
  employee_name TEXT,
  employee_code TEXT,
  work_status TEXT,
  status_started_at TIMESTAMPTZ,
  context_type TEXT,
  context_id UUID,
  context_label TEXT,
  is_stale BOOLEAN,
  first_check_in_at TIMESTAMPTZ
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
    CASE
      WHEN open_entry.id IS NULL THEN 'Out'
      WHEN active_break.id IS NOT NULL THEN 'Break'
      ELSE 'In'
    END AS work_status,
    CASE
      WHEN open_entry.id IS NULL THEN latest_closed_entry.ended_at
      WHEN active_break.id IS NOT NULL THEN active_break.started_at
      ELSE open_entry.started_at
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
    first_entry_today.started_at AS first_check_in_at
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
    ORDER BY entry.ended_at DESC
    LIMIT 1
  ) latest_closed_entry ON true
  LEFT JOIN public.projects project
    ON project.id = open_entry.project_id
  LEFT JOIN public.activities activity
    ON activity.id = open_entry.activity_id
  WHERE employee.status = 'Active'
    AND public.current_employee_id() IS NOT NULL
  ORDER BY employee.name, employee.emp_code;
$$;

REVOKE ALL ON FUNCTION public.live_work_status()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_work_status()
  TO authenticated;

COMMIT;
