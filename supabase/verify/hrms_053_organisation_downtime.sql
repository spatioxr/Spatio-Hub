-- HRMS-053 rollback-only verification. Expected: all_checks_pass=true.

BEGIN;

DO $$
DECLARE
  original_superadmin_id UUID;
  actor_auth_id UUID;
  superadmin_actor_id UUID;
  downtime_manager_id UUID;
  employee_actor_id UUID;
  active_event public.organisation_downtime_events;
  historical_event public.organisation_downtime_events;
  denied BOOLEAN := false;
BEGIN
  SELECT employee.id, employee.auth_id
  INTO original_superadmin_id, actor_auth_id
  FROM public.employees employee
  WHERE employee.role = 'superadmin'
    AND employee.status = 'Active'
    AND employee.auth_id IS NOT NULL
  LIMIT 1;

  IF original_superadmin_id IS NULL THEN
    RAISE EXCEPTION 'An Auth-linked superadmin is required';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', actor_auth_id::TEXT, 'role', 'authenticated')::TEXT,
    true
  );

  UPDATE public.employees SET auth_id = NULL WHERE id = original_superadmin_id;
  INSERT INTO public.employees (
    auth_id, emp_code, name, email, department, role, status
  ) VALUES
    (actor_auth_id, 'HRMS053SUP', 'HRMS-053 Superadmin', 'hrms-053-superadmin@example.invalid', 'Operations', 'superadmin', 'Active'),
    (NULL, 'HRMS053MGR', 'HRMS-053 Downtime Manager', 'hrms-053-manager@example.invalid', 'Operations', 'manager', 'Active'),
    (NULL, 'HRMS053EMP', 'HRMS-053 Employee', 'hrms-053-employee@example.invalid', 'Delivery', 'employee', 'Active');

  SELECT id INTO superadmin_actor_id FROM public.employees WHERE emp_code = 'HRMS053SUP';
  SELECT id INTO downtime_manager_id FROM public.employees WHERE emp_code = 'HRMS053MGR';
  SELECT id INTO employee_actor_id FROM public.employees WHERE emp_code = 'HRMS053EMP';

  -- Keep this rollback-only verifier isolated from a genuine live incident.
  UPDATE public.organisation_downtime_events
  SET cancelled_at = statement_timestamp(),
      cancelled_by = superadmin_actor_id,
      updated_by = superadmin_actor_id,
      updated_at = statement_timestamp()
  WHERE cancelled_at IS NULL
    AND started_at <= clock_timestamp()
    AND (ended_at IS NULL OR ended_at > clock_timestamp());

  PERFORM public.set_downtime_manager_access(downtime_manager_id, true);
  IF NOT (SELECT is_downtime_manager FROM public.employees WHERE id = downtime_manager_id) THEN
    RAISE EXCEPTION 'Superadmin could not assign Downtime Manager access';
  END IF;

  UPDATE public.employees SET auth_id = NULL WHERE id = superadmin_actor_id;
  UPDATE public.employees SET auth_id = actor_auth_id WHERE id = downtime_manager_id;

  SELECT * INTO active_event
  FROM public.start_organisation_downtime(
    'power_cut', 'Unexpected office power cut', 'Rollback-only verification'
  );

  IF active_event.id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.active_organisation_downtime() current_event
      WHERE current_event.downtime_event_id = active_event.id
    )
  THEN
    RAISE EXCEPTION 'Real-time downtime did not become active';
  END IF;

  PERFORM pg_sleep(0.01);
  SELECT * INTO active_event
  FROM public.end_organisation_downtime(active_event.id);
  IF active_event.ended_at IS NULL OR active_event.ended_at <= active_event.started_at THEN
    RAISE EXCEPTION 'Real-time downtime did not end safely';
  END IF;

  SELECT * INTO historical_event
  FROM public.create_organisation_downtime(
    'maintenance',
    'Historical maintenance',
    'Recorded after connectivity returned',
    '2026-01-05 10:00:00+05:30'::TIMESTAMPTZ,
    '2026-01-05 12:00:00+05:30'::TIMESTAMPTZ
  );

  IF (
    SELECT event.recorded_seconds
    FROM public.organisation_downtime_for_period(
      '2026-01-05 11:00:00+05:30'::TIMESTAMPTZ,
      '2026-01-05 13:00:00+05:30'::TIMESTAMPTZ
    ) event
    WHERE event.downtime_event_id = historical_event.id
  ) <> 3600 THEN
    RAISE EXCEPTION 'Downtime was not clipped to the reporting range';
  END IF;

  SELECT * INTO historical_event
  FROM public.update_organisation_downtime(
    historical_event.id,
    'maintenance',
    'Historical maintenance corrected',
    'Corrected rollback-only record',
    '2026-01-05 10:00:00+05:30'::TIMESTAMPTZ,
    '2026-01-05 11:30:00+05:30'::TIMESTAMPTZ,
    'Correct the recorded restoration time'
  );

  IF (
    SELECT count(*) FROM public.organisation_downtime_audit audit
    WHERE audit.downtime_event_id = historical_event.id
  ) <> 2 THEN
    RAISE EXCEPTION 'Create and update were not audited';
  END IF;

  BEGIN
    PERFORM public.create_organisation_downtime(
      'other',
      'Overlapping event',
      NULL,
      '2026-01-05 10:30:00+05:30'::TIMESTAMPTZ,
      '2026-01-05 12:30:00+05:30'::TIMESTAMPTZ
    );
    RAISE EXCEPTION 'Overlapping downtime was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Overlapping downtime was accepted' THEN RAISE; END IF;
  END;

  SELECT * INTO historical_event
  FROM public.cancel_organisation_downtime(
    historical_event.id,
    'Rollback-only cancellation check'
  );
  IF historical_event.cancelled_at IS NULL THEN
    RAISE EXCEPTION 'Downtime cancellation was not recorded';
  END IF;

  BEGIN
    UPDATE public.organisation_downtime_audit
    SET change_reason = 'Tampered'
    WHERE downtime_event_id = historical_event.id;
    RAISE EXCEPTION 'Downtime audit history was mutable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Downtime audit history was mutable' THEN RAISE; END IF;
  END;

  UPDATE public.employees SET auth_id = NULL WHERE id = downtime_manager_id;
  UPDATE public.employees SET auth_id = actor_auth_id WHERE id = employee_actor_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organisation_downtime_for_period(
      active_event.started_at - INTERVAL '1 minute',
      active_event.ended_at + INTERVAL '1 minute'
    ) event
    WHERE event.downtime_event_id = active_event.id
  ) THEN
    RAISE EXCEPTION 'Employee could not see organisation downtime';
  END IF;

  BEGIN
    PERFORM public.start_organisation_downtime('other', 'Unauthorised event', NULL);
    RAISE EXCEPTION 'Employee received downtime mutation access';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Employee received downtime mutation access' THEN RAISE; END IF;
    denied := true;
  END;

  IF NOT denied THEN
    RAISE EXCEPTION 'Employee denial was not verified';
  END IF;

  IF has_table_privilege('authenticated', 'public.organisation_downtime_events', 'INSERT')
    OR has_table_privilege('authenticated', 'public.organisation_downtime_events', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.organisation_downtime_events', 'DELETE')
    OR has_table_privilege('authenticated', 'public.organisation_downtime_audit', 'INSERT')
    OR has_table_privilege('authenticated', 'public.organisation_downtime_audit', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.organisation_downtime_audit', 'DELETE')
  THEN
    RAISE EXCEPTION 'Authenticated direct downtime writes are not denied';
  END IF;
END
$$;

SELECT true AS all_checks_pass, jsonb_build_object(
  'superadmin_assigns_downtime_manager', true,
  'real_time_start_and_end', true,
  'scheduled_and_backfilled_ranges', true,
  'range_clipping', true,
  'overlap_rejected', true,
  'all_employees_can_view', true,
  'employee_mutation_denied', true,
  'direct_writes_denied', true,
  'audit_history_immutable', true
) AS checks;

ROLLBACK;
