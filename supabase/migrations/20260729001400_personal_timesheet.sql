-- HRMS-021: self-only daily and weekly timesheet projection.

BEGIN;

CREATE OR REPLACE FUNCTION public.personal_timesheet_entries(
  requested_start_at TIMESTAMPTZ,
  requested_end_at TIMESTAMPTZ
)
RETURNS TABLE (
  work_entry_id UUID,
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
BEGIN
  actor_employee_id := public.current_employee_id();

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

  RETURN QUERY
  SELECT
    entry.id AS work_entry_id,
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
  WHERE entry.employee_id = actor_employee_id
    AND entry.started_at >= requested_start_at
    AND entry.started_at < requested_end_at
  ORDER BY entry.started_at;
END;
$$;

REVOKE ALL ON FUNCTION public.personal_timesheet_entries(
  TIMESTAMPTZ,
  TIMESTAMPTZ
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.personal_timesheet_entries(
  TIMESTAMPTZ,
  TIMESTAMPTZ
) TO authenticated;

COMMIT;
