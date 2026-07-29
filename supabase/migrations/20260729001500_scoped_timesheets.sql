-- HRMS-022: role-scoped team and organisation timesheet access.

BEGIN;

CREATE OR REPLACE FUNCTION public.timesheet_scope_members(
  requested_scope TEXT
)
RETURNS TABLE (
  employee_id UUID,
  employee_name TEXT,
  employee_code TEXT,
  employee_department TEXT,
  employee_status TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  actor_role TEXT;
BEGIN
  actor_employee_id := public.current_employee_id();
  actor_role := public.current_employee_role();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
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

  RETURN QUERY
  SELECT DISTINCT
    employee.id AS employee_id,
    employee.name AS employee_name,
    employee.emp_code AS employee_code,
    employee.department AS employee_department,
    employee.status AS employee_status
  FROM public.employees employee
  WHERE (
      requested_scope = 'personal'
      AND employee.id = actor_employee_id
    )
    OR (
      requested_scope = 'managed'
      AND EXISTS (
        SELECT 1
        FROM public.project_managers manager_assignment
        JOIN public.project_members member_assignment
          ON member_assignment.project_id = manager_assignment.project_id
        WHERE manager_assignment.employee_id = actor_employee_id
          AND member_assignment.employee_id = employee.id
      )
    )
    OR (
      requested_scope = 'organisation'
      AND actor_role IN ('admin', 'superadmin')
    )
  ORDER BY employee.name, employee.emp_code;
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
  actor_employee_id UUID;
  actor_role TEXT;
BEGIN
  actor_employee_id := public.current_employee_id();
  actor_role := public.current_employee_role();

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
    entry.id AS work_entry_id,
    employee.id AS employee_id,
    employee.name AS employee_name,
    employee.emp_code AS employee_code,
    employee.department AS employee_department,
    entry.started_at,
    entry.ended_at,
    GREATEST(
      0,
      FLOOR(
        EXTRACT(
          EPOCH FROM (
            COALESCE(entry.ended_at, statement_timestamp())
            - entry.started_at
          )
        )
      )::BIGINT - break_summary.break_seconds
    ) AS worked_seconds,
    break_summary.break_seconds,
    CASE
      WHEN entry.project_id IS NOT NULL THEN 'project'
      ELSE 'activity'
    END AS context_type,
    COALESCE(entry.project_id, entry.activity_id) AS context_id,
    CASE
      WHEN entry.project_id IS NOT NULL
      THEN concat_ws(' · ', project.code, project.name)
      ELSE activity.name
    END AS context_label,
    entry.task_description,
    break_summary.breaks
  FROM public.work_entries entry
  JOIN public.employees employee
    ON employee.id = entry.employee_id
  LEFT JOIN public.projects project
    ON project.id = entry.project_id
  LEFT JOIN public.activities activity
    ON activity.id = entry.activity_id
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(
        SUM(
          GREATEST(
            0,
            FLOOR(
              EXTRACT(
                EPOCH FROM (
                  LEAST(
                    COALESCE(break_entry.ended_at, statement_timestamp()),
                    COALESCE(entry.ended_at, statement_timestamp())
                  )
                  - break_entry.started_at
                )
              )
            )::BIGINT
          )
        ),
        0
      )::BIGINT AS break_seconds,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', break_entry.id,
            'started_at', break_entry.started_at,
            'ended_at', break_entry.ended_at,
            'duration_seconds', GREATEST(
              0,
              FLOOR(
                EXTRACT(
                  EPOCH FROM (
                    LEAST(
                      COALESCE(break_entry.ended_at, statement_timestamp()),
                      COALESCE(entry.ended_at, statement_timestamp())
                    )
                    - break_entry.started_at
                  )
                )
              )::BIGINT
            )
          )
          ORDER BY break_entry.started_at
        ) FILTER (WHERE break_entry.id IS NOT NULL),
        '[]'::JSONB
      ) AS breaks
    FROM public.break_entries break_entry
    WHERE break_entry.work_entry_id = entry.id
  ) break_summary ON true
  WHERE entry.started_at >= requested_start_at
    AND entry.started_at < requested_end_at
    AND (
      (
        requested_scope = 'personal'
        AND entry.employee_id = actor_employee_id
      )
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
    AND (
      requested_employee_id IS NULL
      OR entry.employee_id = requested_employee_id
    )
  ORDER BY entry.started_at, employee.name, employee.emp_code;
END;
$$;

REVOKE ALL ON FUNCTION public.timesheet_scope_members(TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.scoped_timesheet_entries(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT,
  UUID
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.timesheet_scope_members(TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.scoped_timesheet_entries(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT,
  UUID
) TO authenticated;

COMMIT;
