-- HRMS-011: operational simple break events for active work sessions.
-- Break UI remains tracked by HRMS-017.

BEGIN;

CREATE OR REPLACE FUNCTION public.start_work_break()
RETURNS public.break_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  active_work_entry_id UUID;
  created_break public.break_entries;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  SELECT entry.id
  INTO active_work_entry_id
  FROM public.work_entries entry
  WHERE entry.employee_id = actor_employee_id
    AND entry.ended_at IS NULL
  ORDER BY entry.started_at DESC
  LIMIT 1;

  IF active_work_entry_id IS NULL THEN
    RAISE EXCEPTION 'Start work before starting a break';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.break_entries break_entry
    WHERE break_entry.work_entry_id = active_work_entry_id
      AND break_entry.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A break is already active';
  END IF;

  INSERT INTO public.break_entries (
    work_entry_id,
    started_at
  )
  VALUES (
    active_work_entry_id,
    clock_timestamp()
  )
  RETURNING * INTO created_break;

  RETURN created_break;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_work_break()
RETURNS SETOF public.break_entries
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT break_entry.*
  FROM public.break_entries break_entry
  JOIN public.work_entries entry
    ON entry.id = break_entry.work_entry_id
  WHERE entry.employee_id = public.current_employee_id()
    AND entry.ended_at IS NULL
    AND break_entry.ended_at IS NULL
  ORDER BY break_entry.started_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.resume_work_session()
RETURNS public.break_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  resumed_break public.break_entries;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  UPDATE public.break_entries break_entry
  SET ended_at = clock_timestamp()
  FROM public.work_entries entry
  WHERE entry.id = break_entry.work_entry_id
    AND entry.employee_id = actor_employee_id
    AND entry.ended_at IS NULL
    AND break_entry.ended_at IS NULL
  RETURNING break_entry.* INTO resumed_break;

  IF resumed_break.id IS NULL THEN
    RAISE EXCEPTION 'No active break to resume from';
  END IF;

  RETURN resumed_break;
END;
$$;

CREATE OR REPLACE FUNCTION public.work_entry_worked_seconds(
  target_work_entry_id UUID
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
    0::numeric,
    EXTRACT(
      EPOCH FROM (
        COALESCE(entry.ended_at, statement_timestamp())
        - entry.started_at
      )
    )
    - COALESCE(
      SUM(
        EXTRACT(
          EPOCH FROM (
            LEAST(
              COALESCE(break_entry.ended_at, statement_timestamp()),
              COALESCE(entry.ended_at, statement_timestamp())
            )
            - break_entry.started_at
          )
        )
      ) FILTER (WHERE break_entry.id IS NOT NULL),
      0
    )
  )
  FROM public.work_entries entry
  LEFT JOIN public.break_entries break_entry
    ON break_entry.work_entry_id = entry.id
  WHERE entry.id = target_work_entry_id
    AND public.can_access_work_entry(entry.id)
  GROUP BY entry.id;
$$;

CREATE OR REPLACE FUNCTION public.end_work_session(
  target_work_entry_id UUID
)
RETURNS public.work_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  ended_session public.work_entries;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF actor_employee_id IS NULL THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.break_entries break_entry
    JOIN public.work_entries entry
      ON entry.id = break_entry.work_entry_id
    WHERE entry.id = target_work_entry_id
      AND entry.employee_id = actor_employee_id
      AND entry.ended_at IS NULL
      AND break_entry.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Resume from break before ending the work session';
  END IF;

  UPDATE public.work_entries
  SET ended_at = clock_timestamp()
  WHERE id = target_work_entry_id
    AND employee_id = actor_employee_id
    AND ended_at IS NULL
  RETURNING * INTO ended_session;

  IF ended_session.id IS NULL THEN
    RAISE EXCEPTION 'Open work session not found';
  END IF;

  RETURN ended_session;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.break_entries
  FROM authenticated;

REVOKE ALL ON FUNCTION public.start_work_break()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_work_break()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resume_work_session()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.work_entry_worked_seconds(UUID)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.start_work_break()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_work_break()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_work_session()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.work_entry_worked_seconds(UUID)
  TO authenticated;

COMMIT;
