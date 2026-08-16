-- HRMS-053: planned and real-time organisation downtime.
-- Downtime is reported separately from employee work and break entries.

BEGIN;

ALTER TABLE public.employees
  ADD COLUMN is_downtime_manager BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE public.organisation_downtime_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL
    CHECK (category IN ('maintenance', 'power_cut', 'company_event', 'other')),
  title TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  notes TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  cancelled_by UUID REFERENCES public.employees(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  cancelled_at TIMESTAMPTZ,
  CHECK (ended_at IS NULL OR ended_at > started_at),
  CHECK (
    (cancelled_at IS NULL AND cancelled_by IS NULL)
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
  )
);

ALTER TABLE public.organisation_downtime_events
  ADD CONSTRAINT organisation_downtime_events_no_overlap
  EXCLUDE USING gist (
    tstzrange(started_at, ended_at, '[)') WITH &&
  ) WHERE (cancelled_at IS NULL AND ended_at IS NOT NULL);

CREATE UNIQUE INDEX organisation_downtime_events_one_open_idx
  ON public.organisation_downtime_events ((ended_at IS NULL))
  WHERE ended_at IS NULL AND cancelled_at IS NULL;

CREATE INDEX organisation_downtime_events_period_idx
  ON public.organisation_downtime_events (started_at, ended_at)
  WHERE cancelled_at IS NULL;

CREATE TABLE public.organisation_downtime_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  downtime_event_id UUID NOT NULL
    REFERENCES public.organisation_downtime_events(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'ended', 'cancelled')),
  change_reason TEXT NOT NULL CHECK (length(btrim(change_reason)) > 0),
  old_record JSONB,
  new_record JSONB,
  changed_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);

CREATE INDEX organisation_downtime_audit_event_time_idx
  ON public.organisation_downtime_audit (downtime_event_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.can_manage_organisation_downtime()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.auth_id = auth.uid()
        AND employee.status = 'Active'
        AND NOT employee.must_change_password
        AND (
          employee.role = 'superadmin'
          OR employee.is_downtime_manager
        )
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.set_downtime_manager_access(
  target_employee_id UUID,
  enabled BOOLEAN
)
RETURNS public.employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  saved_employee public.employees;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Only a superadmin can assign Downtime Manager access';
  END IF;

  IF COALESCE(enabled, false) AND NOT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = target_employee_id
      AND employee.status = 'Active'
  ) THEN
    RAISE EXCEPTION 'Downtime Manager access can only be assigned to an active employee';
  END IF;

  UPDATE public.employees
  SET is_downtime_manager = COALESCE(enabled, false)
  WHERE id = target_employee_id
  RETURNING * INTO saved_employee;

  IF saved_employee.id IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  RETURN saved_employee;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_downtime_manager_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_downtime_manager IS DISTINCT FROM OLD.is_downtime_manager
    AND NOT public.is_superadmin()
  THEN
    RAISE EXCEPTION 'Only a superadmin can assign Downtime Manager access';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER employees_protect_downtime_manager_access
BEFORE UPDATE OF is_downtime_manager ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.protect_downtime_manager_access();

CREATE OR REPLACE FUNCTION public.prevent_organisation_downtime_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Organisation downtime history is immutable';
END;
$$;

CREATE TRIGGER organisation_downtime_audit_prevent_mutation
BEFORE UPDATE OR DELETE ON public.organisation_downtime_audit
FOR EACH ROW
EXECUTE FUNCTION public.prevent_organisation_downtime_audit_mutation();

CREATE OR REPLACE FUNCTION public.start_organisation_downtime(
  downtime_category TEXT,
  downtime_title TEXT,
  downtime_notes TEXT DEFAULT NULL
)
RETURNS public.organisation_downtime_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID := public.current_employee_id();
  created_event public.organisation_downtime_events;
BEGIN
  IF NOT public.can_manage_organisation_downtime() THEN
    RAISE EXCEPTION 'Downtime Manager access is required';
  END IF;
  IF downtime_category NOT IN ('maintenance', 'power_cut', 'company_event', 'other') THEN
    RAISE EXCEPTION 'Choose a valid downtime category';
  END IF;
  IF COALESCE(length(btrim(downtime_title)), 0) = 0 THEN
    RAISE EXCEPTION 'A downtime reason is required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.organisation_downtime_events event
    WHERE event.cancelled_at IS NULL
      AND event.started_at <= clock_timestamp()
      AND (event.ended_at IS NULL OR event.ended_at > clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'Another organisation downtime is already active';
  END IF;

  INSERT INTO public.organisation_downtime_events (
    category, title, notes, started_at, created_by, updated_by
  ) VALUES (
    downtime_category,
    btrim(downtime_title),
    NULLIF(btrim(downtime_notes), ''),
    clock_timestamp(),
    actor_employee_id,
    actor_employee_id
  )
  RETURNING * INTO created_event;

  INSERT INTO public.organisation_downtime_audit (
    downtime_event_id, action, change_reason, new_record, changed_by
  ) VALUES (
    created_event.id,
    'created',
    'Started in real time',
    to_jsonb(created_event),
    actor_employee_id
  );

  RETURN created_event;
EXCEPTION
  WHEN exclusion_violation OR unique_violation THEN
    RAISE EXCEPTION 'Another organisation downtime overlaps this time';
END;
$$;

CREATE OR REPLACE FUNCTION public.create_organisation_downtime(
  downtime_category TEXT,
  downtime_title TEXT,
  downtime_notes TEXT,
  downtime_started_at TIMESTAMPTZ,
  downtime_ended_at TIMESTAMPTZ
)
RETURNS public.organisation_downtime_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID := public.current_employee_id();
  created_event public.organisation_downtime_events;
BEGIN
  IF NOT public.can_manage_organisation_downtime() THEN
    RAISE EXCEPTION 'Downtime Manager access is required';
  END IF;
  IF downtime_category NOT IN ('maintenance', 'power_cut', 'company_event', 'other') THEN
    RAISE EXCEPTION 'Choose a valid downtime category';
  END IF;
  IF COALESCE(length(btrim(downtime_title)), 0) = 0 THEN
    RAISE EXCEPTION 'A downtime reason is required';
  END IF;
  IF downtime_started_at IS NULL OR downtime_ended_at IS NULL
    OR downtime_ended_at <= downtime_started_at
  THEN
    RAISE EXCEPTION 'Choose a completed positive-duration downtime range';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.organisation_downtime_events event
    WHERE event.cancelled_at IS NULL
      AND event.ended_at IS NULL
      AND downtime_started_at < clock_timestamp()
      AND downtime_ended_at > event.started_at
  ) THEN
    RAISE EXCEPTION 'Another organisation downtime overlaps this time';
  END IF;

  INSERT INTO public.organisation_downtime_events (
    category, title, notes, started_at, ended_at, created_by, updated_by
  ) VALUES (
    downtime_category,
    btrim(downtime_title),
    NULLIF(btrim(downtime_notes), ''),
    downtime_started_at,
    downtime_ended_at,
    actor_employee_id,
    actor_employee_id
  )
  RETURNING * INTO created_event;

  INSERT INTO public.organisation_downtime_audit (
    downtime_event_id, action, change_reason, new_record, changed_by
  ) VALUES (
    created_event.id,
    'created',
    'Scheduled or recorded after the event',
    to_jsonb(created_event),
    actor_employee_id
  );

  RETURN created_event;
EXCEPTION
  WHEN exclusion_violation OR unique_violation THEN
    RAISE EXCEPTION 'Another organisation downtime overlaps this time';
END;
$$;

CREATE OR REPLACE FUNCTION public.update_organisation_downtime(
  target_downtime_event_id UUID,
  downtime_category TEXT,
  downtime_title TEXT,
  downtime_notes TEXT,
  downtime_started_at TIMESTAMPTZ,
  downtime_ended_at TIMESTAMPTZ,
  change_reason TEXT
)
RETURNS public.organisation_downtime_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID := public.current_employee_id();
  existing_event public.organisation_downtime_events;
  saved_event public.organisation_downtime_events;
BEGIN
  IF NOT public.can_manage_organisation_downtime() THEN
    RAISE EXCEPTION 'Downtime Manager access is required';
  END IF;
  IF COALESCE(length(btrim(change_reason)), 0) = 0 THEN
    RAISE EXCEPTION 'A change reason is required';
  END IF;
  IF downtime_category NOT IN ('maintenance', 'power_cut', 'company_event', 'other') THEN
    RAISE EXCEPTION 'Choose a valid downtime category';
  END IF;
  IF COALESCE(length(btrim(downtime_title)), 0) = 0 THEN
    RAISE EXCEPTION 'A downtime reason is required';
  END IF;
  IF downtime_started_at IS NULL OR downtime_ended_at IS NULL
    OR downtime_ended_at <= downtime_started_at
  THEN
    RAISE EXCEPTION 'Choose a completed positive-duration downtime range';
  END IF;

  SELECT event.* INTO existing_event
  FROM public.organisation_downtime_events event
  WHERE event.id = target_downtime_event_id
  FOR UPDATE;

  IF existing_event.id IS NULL THEN RAISE EXCEPTION 'Downtime event not found'; END IF;
  IF existing_event.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Cancelled downtime cannot be edited'; END IF;
  IF existing_event.ended_at IS NULL THEN RAISE EXCEPTION 'End active downtime before editing its range'; END IF;
  IF EXISTS (
    SELECT 1
    FROM public.organisation_downtime_events event
    WHERE event.id <> target_downtime_event_id
      AND event.cancelled_at IS NULL
      AND event.ended_at IS NULL
      AND downtime_started_at < clock_timestamp()
      AND downtime_ended_at > event.started_at
  ) THEN
    RAISE EXCEPTION 'Another organisation downtime overlaps this time';
  END IF;

  UPDATE public.organisation_downtime_events
  SET category = downtime_category,
      title = btrim(downtime_title),
      notes = NULLIF(btrim(downtime_notes), ''),
      started_at = downtime_started_at,
      ended_at = downtime_ended_at,
      updated_by = actor_employee_id,
      updated_at = statement_timestamp()
  WHERE id = target_downtime_event_id
  RETURNING * INTO saved_event;

  INSERT INTO public.organisation_downtime_audit (
    downtime_event_id, action, change_reason, old_record, new_record, changed_by
  ) VALUES (
    saved_event.id,
    'updated',
    btrim(change_reason),
    to_jsonb(existing_event),
    to_jsonb(saved_event),
    actor_employee_id
  );

  RETURN saved_event;
EXCEPTION
  WHEN exclusion_violation OR unique_violation THEN
    RAISE EXCEPTION 'Another organisation downtime overlaps this time';
END;
$$;

CREATE OR REPLACE FUNCTION public.end_organisation_downtime(
  target_downtime_event_id UUID
)
RETURNS public.organisation_downtime_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID := public.current_employee_id();
  existing_event public.organisation_downtime_events;
  saved_event public.organisation_downtime_events;
  ended_timestamp TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT public.can_manage_organisation_downtime() THEN
    RAISE EXCEPTION 'Downtime Manager access is required';
  END IF;

  SELECT event.* INTO existing_event
  FROM public.organisation_downtime_events event
  WHERE event.id = target_downtime_event_id
  FOR UPDATE;

  IF existing_event.id IS NULL THEN RAISE EXCEPTION 'Downtime event not found'; END IF;
  IF existing_event.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Cancelled downtime cannot be ended'; END IF;
  IF existing_event.ended_at IS NOT NULL THEN RAISE EXCEPTION 'Downtime has already ended'; END IF;
  IF ended_timestamp <= existing_event.started_at THEN RAISE EXCEPTION 'Downtime end must be after its start'; END IF;

  UPDATE public.organisation_downtime_events
  SET ended_at = ended_timestamp,
      updated_by = actor_employee_id,
      updated_at = statement_timestamp()
  WHERE id = target_downtime_event_id
  RETURNING * INTO saved_event;

  INSERT INTO public.organisation_downtime_audit (
    downtime_event_id, action, change_reason, old_record, new_record, changed_by
  ) VALUES (
    saved_event.id,
    'ended',
    'Ended in real time',
    to_jsonb(existing_event),
    to_jsonb(saved_event),
    actor_employee_id
  );

  RETURN saved_event;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_organisation_downtime(
  target_downtime_event_id UUID,
  change_reason TEXT
)
RETURNS public.organisation_downtime_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID := public.current_employee_id();
  existing_event public.organisation_downtime_events;
  saved_event public.organisation_downtime_events;
BEGIN
  IF NOT public.can_manage_organisation_downtime() THEN
    RAISE EXCEPTION 'Downtime Manager access is required';
  END IF;
  IF COALESCE(length(btrim(change_reason)), 0) = 0 THEN
    RAISE EXCEPTION 'A cancellation reason is required';
  END IF;

  SELECT event.* INTO existing_event
  FROM public.organisation_downtime_events event
  WHERE event.id = target_downtime_event_id
  FOR UPDATE;

  IF existing_event.id IS NULL THEN RAISE EXCEPTION 'Downtime event not found'; END IF;
  IF existing_event.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Downtime is already cancelled'; END IF;

  UPDATE public.organisation_downtime_events
  SET cancelled_at = statement_timestamp(),
      cancelled_by = actor_employee_id,
      updated_by = actor_employee_id,
      updated_at = statement_timestamp()
  WHERE id = target_downtime_event_id
  RETURNING * INTO saved_event;

  INSERT INTO public.organisation_downtime_audit (
    downtime_event_id, action, change_reason, old_record, new_record, changed_by
  ) VALUES (
    saved_event.id,
    'cancelled',
    btrim(change_reason),
    to_jsonb(existing_event),
    to_jsonb(saved_event),
    actor_employee_id
  );

  RETURN saved_event;
END;
$$;

CREATE OR REPLACE FUNCTION public.organisation_downtime_for_period(
  requested_start_at TIMESTAMPTZ,
  requested_end_at TIMESTAMPTZ
)
RETURNS TABLE (
  downtime_event_id UUID,
  category TEXT,
  title TEXT,
  notes TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  event_status TEXT,
  recorded_seconds BIGINT,
  created_by_name TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_employee() THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;
  IF requested_start_at IS NULL OR requested_end_at IS NULL
    OR requested_end_at <= requested_start_at
    OR requested_end_at - requested_start_at > INTERVAL '370 days'
  THEN
    RAISE EXCEPTION 'Choose a valid downtime reporting range';
  END IF;

  RETURN QUERY
  SELECT
    event.id,
    event.category,
    event.title,
    event.notes,
    event.started_at,
    event.ended_at,
    CASE
      WHEN event.started_at > clock_timestamp() THEN 'scheduled'
      WHEN event.ended_at IS NULL OR event.ended_at > clock_timestamp() THEN 'active'
      ELSE 'completed'
    END,
    greatest(
      0,
      floor(extract(epoch FROM (
        least(
          COALESCE(event.ended_at, clock_timestamp()),
          requested_end_at,
          clock_timestamp()
        ) - greatest(event.started_at, requested_start_at)
      )))
    )::BIGINT,
    creator.name,
    event.updated_at
  FROM public.organisation_downtime_events event
  JOIN public.employees creator ON creator.id = event.created_by
  WHERE event.cancelled_at IS NULL
    AND event.started_at < requested_end_at
    AND COALESCE(event.ended_at, clock_timestamp()) > requested_start_at
  ORDER BY event.started_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.active_organisation_downtime()
RETURNS TABLE (
  downtime_event_id UUID,
  category TEXT,
  title TEXT,
  notes TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_by_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_employee() THEN
    RAISE EXCEPTION 'An active employee session is required';
  END IF;

  RETURN QUERY
  SELECT event.id, event.category, event.title, event.notes, event.started_at, event.ended_at, creator.name
  FROM public.organisation_downtime_events event
  JOIN public.employees creator ON creator.id = event.created_by
  WHERE event.cancelled_at IS NULL
    AND event.started_at <= clock_timestamp()
    AND (event.ended_at IS NULL OR event.ended_at > clock_timestamp())
  ORDER BY event.started_at DESC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.organisation_downtime_history(
  target_downtime_event_id UUID
)
RETURNS TABLE (
  audit_id UUID,
  action TEXT,
  change_reason TEXT,
  old_record JSONB,
  new_record JSONB,
  changed_by_name TEXT,
  changed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_organisation_downtime() THEN
    RAISE EXCEPTION 'Downtime Manager access is required';
  END IF;

  RETURN QUERY
  SELECT
    audit.id,
    audit.action,
    audit.change_reason,
    audit.old_record,
    audit.new_record,
    actor.name,
    audit.changed_at
  FROM public.organisation_downtime_audit audit
  JOIN public.employees actor ON actor.id = audit.changed_by
  WHERE audit.downtime_event_id = target_downtime_event_id
  ORDER BY audit.changed_at DESC;
END;
$$;

ALTER TABLE public.organisation_downtime_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_downtime_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.organisation_downtime_events,
  public.organisation_downtime_audit
FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.organisation_downtime_events TO authenticated;
GRANT SELECT ON TABLE public.organisation_downtime_audit TO authenticated;

CREATE POLICY organisation_downtime_events_select_active_employee
  ON public.organisation_downtime_events FOR SELECT TO authenticated
  USING (public.is_active_employee());

CREATE POLICY organisation_downtime_audit_select_manager
  ON public.organisation_downtime_audit FOR SELECT TO authenticated
  USING (public.can_manage_organisation_downtime());

REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.organisation_downtime_events,
  public.organisation_downtime_audit
FROM authenticated;

REVOKE ALL ON FUNCTION public.can_manage_organisation_downtime() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_downtime_manager_access(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.protect_downtime_manager_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_organisation_downtime_audit_mutation() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_organisation_downtime(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_organisation_downtime(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_organisation_downtime(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_organisation_downtime(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_organisation_downtime(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organisation_downtime_for_period(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.active_organisation_downtime() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organisation_downtime_history(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_manage_organisation_downtime() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_downtime_manager_access(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_organisation_downtime(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organisation_downtime(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_organisation_downtime(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_organisation_downtime(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_organisation_downtime(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organisation_downtime_for_period(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.active_organisation_downtime() TO authenticated;
GRANT EXECUTE ON FUNCTION public.organisation_downtime_history(UUID) TO authenticated;

COMMIT;
