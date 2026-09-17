-- Analytics-only unrestricted reporting; existing Timesheet limits remain intact.
CREATE OR REPLACE FUNCTION public.analytics_entries(
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
  THEN
    RAISE EXCEPTION 'Choose a valid analytics range';
  END IF;

  IF requested_scope IS NULL OR requested_scope NOT IN ('managed', 'organisation') THEN
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
    AND public.can_access_work_entry(entry.id)
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


REVOKE ALL ON FUNCTION public.analytics_entries(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_entries(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO authenticated;

-- Aggregate before returning data: one row per employee/context, independent of
-- session count. The underlying function enforces the same scope as Timesheets.
CREATE FUNCTION public.analytics_summary(requested_start_at TIMESTAMPTZ, requested_end_at TIMESTAMPTZ, requested_scope TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(grouped)), '[]'::jsonb)
  FROM (
    SELECT employee_id, employee_name, employee_code, employee_department,
      context_type, context_id, context_label,
      sum(worked_seconds) AS worked_seconds, sum(break_seconds) AS break_seconds,
      count(*) AS session_count
    FROM public.analytics_entries(requested_start_at, requested_end_at, requested_scope)
    GROUP BY employee_id, employee_name, employee_code, employee_department,
      context_type, context_id, context_label
  ) grouped;
$$;
REVOKE ALL ON FUNCTION public.analytics_summary(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_summary(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;
