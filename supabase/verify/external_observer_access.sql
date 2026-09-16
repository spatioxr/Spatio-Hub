-- Rollback-only real-role Observer and staff regression checks.
BEGIN;
CREATE TEMP TABLE observer_fixture (kind TEXT PRIMARY KEY, auth_id UUID, id UUID);
INSERT INTO observer_fixture VALUES
  ('superadmin', gen_random_uuid(), gen_random_uuid()),
  ('admin', gen_random_uuid(), gen_random_uuid()),
  ('employee', gen_random_uuid(), gen_random_uuid()),
  ('observer', gen_random_uuid(), gen_random_uuid()),
  ('revoked', gen_random_uuid(), gen_random_uuid()),
  ('password', gen_random_uuid(), gen_random_uuid());
INSERT INTO auth.users(id, email) SELECT auth_id, 'observer-test-' || kind || '@example.invalid' FROM observer_fixture;
INSERT INTO public.employees(id, auth_id, emp_code, name, email, role, status)
SELECT id, auth_id, 'OBS-' || kind, 'Test ' || kind, 'observer-test-' || kind || '@example.invalid', kind, 'Active'
FROM observer_fixture WHERE kind IN ('superadmin', 'admin', 'employee');
INSERT INTO public.external_accounts(id, auth_id, name, email, status, must_change_password, created_by)
SELECT id, auth_id, 'Test ' || kind, 'observer-test-' || kind || '@example.invalid',
  CASE WHEN kind = 'revoked' THEN 'Released' ELSE 'Active' END, kind = 'password',
  (SELECT id FROM observer_fixture WHERE kind = 'superadmin')
FROM observer_fixture WHERE kind IN ('observer', 'revoked', 'password');
GRANT SELECT ON observer_fixture TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'role', 'authenticated')::text, true)
FROM observer_fixture WHERE kind = 'superadmin';
DO $$
DECLARE activity UUID; entry public.work_entries; external_id UUID; count_before BIGINT;
BEGIN
  SELECT count(*) INTO count_before FROM public.employees;
  external_id := public.save_external_account('Board Member', 'board-observer@example.invalid', 'Board member');
  PERFORM public.save_external_account('Board Member', 'board-observer@example.invalid', 'Board member', external_id, 'Released');
  PERFORM public.save_external_account('Board Member', 'board-observer@example.invalid', 'Advisor', external_id, 'Active');
  IF (SELECT count(*) FROM public.employees) <> count_before THEN RAISE EXCEPTION 'External account entered employee roster'; END IF;
  IF EXISTS (SELECT 1 FROM public.timesheet_scope_members('organisation') WHERE employee_id = external_id)
    THEN RAISE EXCEPTION 'Observer entered timesheet/capacity scope'; END IF;
  IF EXISTS (SELECT 1 FROM public.leave_balances WHERE employee_id = external_id)
    OR EXISTS (SELECT 1 FROM public.employee_work_settings WHERE employee_id = external_id)
    OR EXISTS (SELECT 1 FROM public.live_work_status() WHERE employee_id = external_id)
    THEN RAISE EXCEPTION 'Observer entered staff obligations'; END IF;
  SELECT id INTO activity FROM public.activities WHERE archived_at IS NULL LIMIT 1;
  entry := public.create_manual_time_entry((SELECT id FROM observer_fixture WHERE kind = 'employee'),
    NULL, activity, 'Observer test work', '2026-09-14 09:00+05:30', '2026-09-14 11:00+05:30',
    '[{"started_at":"2026-09-14T09:30:00+05:30","ended_at":"2026-09-14T10:00:00+05:30"}]'::jsonb,
    'Observer test fixture', 'office');
  entry := public.create_manual_time_entry((SELECT id FROM observer_fixture WHERE kind = 'employee'),
    NULL, activity, 'Overnight observer fixture', '2026-09-14 23:00+05:30', '2026-09-15 01:00+05:30',
    '[{"started_at":"2026-09-14T23:45:00+05:30","ended_at":"2026-09-15T00:15:00+05:30"}]'::jsonb,
    'Observer overnight fixture', 'office');
END;
$$;

SELECT set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'role', 'authenticated')::text, true)
FROM observer_fixture WHERE kind = 'observer';
DO $$
DECLARE snapshot JSONB; row_data JSONB; statement TEXT; denied BOOLEAN;
BEGIN
  IF public.current_employee_id() IS NOT NULL OR public.current_employee_role() IS NOT NULL
    OR public.has_organisation_access() OR public.can_manage_leave() THEN
    RAISE EXCEPTION 'Observer gained staff identity/capabilities'; END IF;
  IF (SELECT count(*) FROM public.external_accounts) <> 1 THEN RAISE EXCEPTION 'Observer can see other accounts'; END IF;
  snapshot := public.observer_hub_snapshot('2026-09-14', '2026-09-14');
  SELECT value INTO row_data FROM jsonb_array_elements(snapshot->'entries')
    WHERE value->>'employee_id' = (SELECT id::text FROM observer_fixture WHERE kind = 'employee')
    ORDER BY (value->>'started_at')::timestamptz LIMIT 1;
  IF row_data IS NULL OR (row_data->>'worked_seconds')::numeric <> 5400 THEN RAISE EXCEPTION 'Read-only work totals incorrect'; END IF;
  IF snapshot::text LIKE '%observer-test-%@%' OR snapshot::text LIKE '%must_change_password%'
    OR snapshot::text LIKE '%bos_report%' OR snapshot::text LIKE '%leave_type%'
    OR snapshot::text LIKE '%reason%' THEN RAISE EXCEPTION 'Snapshot exposes sensitive fields'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->'people') p WHERE p->>'id'
    IN (SELECT id::text FROM observer_fixture WHERE kind IN ('observer','revoked','password')))
    THEN RAISE EXCEPTION 'Observer included in employee headcount'; END IF;
  SELECT value INTO row_data FROM jsonb_array_elements(public.observer_hub_snapshot('2026-09-15','2026-09-15')->'entries')
    WHERE value->>'employee_id' = (SELECT id::text FROM observer_fixture WHERE kind = 'employee');
  IF (row_data->>'worked_seconds')::numeric IS DISTINCT FROM 2700::numeric THEN
    RAISE EXCEPTION 'Overnight work and break clipping incorrect'; END IF;
  FOREACH statement IN ARRAY ARRAY[
    'SELECT public.save_external_account(''Forged'', ''forged@example.invalid'')',
    'SELECT public.observer_hub_snapshot(''2026-09-01'', ''2026-10-02'')',
    'SELECT public.start_work_day(NULL, NULL, ''test'', ''test'')',
    'SELECT public.start_work_break()',
    'SELECT public.submit_leave_request(''Sick Leave'', ''2026-09-17'', ''2026-09-17'', false, ''Private reason'')',
    'SELECT public.scoped_leave_requests()',
    'SELECT public.leave_admin_balance_overview()',
    'SELECT public.timesheet_scope_members(''organisation'')',
    'SELECT public.set_attendance_late_cutoff(''09:30''::time)',
    'SELECT public.create_activity(''forged'', ''forged'')',
    'UPDATE public.external_accounts SET role = ''superadmin''',
    'INSERT INTO public.external_accounts(name,email,created_by) VALUES (''Forged'', ''forged@example.invalid'', gen_random_uuid())'
  ] LOOP
    denied := false;
    BEGIN EXECUTE statement;
    EXCEPTION WHEN raise_exception OR insufficient_privilege THEN denied := true;
    END;
    IF NOT denied THEN RAISE EXCEPTION 'Observer operation unexpectedly allowed: %', statement; END IF;
  END LOOP;
  FOREACH statement IN ARRAY ARRAY['employees','employee_private_details','leaves','leave_balances','daily_reports','work_entries','projects','attendance'] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', statement) INTO denied;
    IF denied THEN RAISE EXCEPTION 'Observer raw read exposed %', statement; END IF;
  END LOOP;
END;
$$;
RESET ROLE;

-- Prove the write trigger also works when a definer bypasses RLS.
CREATE FUNCTION public.observer_test_definer_write() RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$ BEGIN UPDATE public.activities SET description = 'forged'; END; $$;
GRANT EXECUTE ON FUNCTION public.observer_test_definer_write() TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.observer_test_definer_write(); RAISE EXCEPTION 'Definer write was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;

DO $$
DECLARE actor RECORD; denied BOOLEAN;
BEGIN
  FOR actor IN SELECT * FROM observer_fixture WHERE kind IN ('revoked', 'password', 'admin', 'employee') LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', actor.auth_id, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM public.observer_hub_snapshot('2026-09-14', '2026-09-14');
      RAISE EXCEPTION 'Non-Observer read allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    denied := false;
    BEGIN PERFORM public.save_external_account('Forged', 'forged@example.invalid');
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'Only an active Superadmin can manage external access' THEN denied := true; ELSE RAISE; END IF;
    END;
    IF NOT denied THEN RAISE EXCEPTION 'External administration allowed for %', actor.kind; END IF;
  END LOOP;
END;
$$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
DO $$
DECLARE observer_id UUID := (SELECT auth_id FROM observer_fixture WHERE kind = 'observer'); denied BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO public.employees(auth_id,emp_code,name,email,role)
    VALUES(observer_id,'OBS-DUP','Duplicate','duplicate-observer@example.invalid','admin');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'This identity already belongs to an external account' THEN denied := true; ELSE RAISE; END IF;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-account identity was accepted'; END IF;
END;
$$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.observer_hub_snapshot('2026-09-14', '2026-09-14'); RAISE EXCEPTION 'Anonymous snapshot allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SELECT true AS all_checks_pass, jsonb_build_object('observer_read_scope',true,'staff_exclusions',true,
  'read_only_database_boundary',true,'superadmin_lifecycle',true,'revoked_password_anon_denied',true,'unique_identity',true) AS checks;
ROLLBACK;
