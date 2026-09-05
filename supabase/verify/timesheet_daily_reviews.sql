-- HRMS-021/022 follow-up: rollback-only report projection and RLS checks.
BEGIN;
CREATE TEMP TABLE review_checks (name TEXT PRIMARY KEY, passed BOOLEAN NOT NULL);
CREATE FUNCTION pg_temp.review_assert(check_name TEXT, passed BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF passed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Review check failed: %', check_name; END IF;
  INSERT INTO review_checks VALUES (check_name, true);
END;
$$;
DO $$
<<review_test>>
DECLARE
  employee_auth UUID := gen_random_uuid(); manager_auth UUID := gen_random_uuid();
  admin_auth UUID := gen_random_uuid(); super_auth UUID := gen_random_uuid();
  employee_id UUID; manager_id UUID; outside_id UUID; project_id UUID;
  actor UUID; denied BOOLEAN;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (employee_auth, 'review-employee@example.invalid'), (manager_auth, 'review-manager@example.invalid'),
    (admin_auth, 'review-admin@example.invalid'), (super_auth, 'review-super@example.invalid');
  INSERT INTO public.employees (auth_id, emp_code, name, email, role, status) VALUES
    (employee_auth, 'REVEMP', 'Review Employee', 'review-employee@example.invalid', 'employee', 'Active'),
    (manager_auth, 'REVMGR', 'Review Manager', 'review-manager@example.invalid', 'manager', 'Active'),
    (admin_auth, 'REVADM', 'Review Admin', 'review-admin@example.invalid', 'admin', 'Active'),
    (super_auth, 'REVSUP', 'Review Super', 'review-super@example.invalid', 'superadmin', 'Active'),
    (NULL, 'REVOUT', 'Review Outside', 'review-outside@example.invalid', 'employee', 'Active');
  SELECT id INTO employee_id FROM public.employees WHERE auth_id = employee_auth;
  SELECT id INTO manager_id FROM public.employees WHERE auth_id = manager_auth;
  SELECT id INTO outside_id FROM public.employees WHERE emp_code = 'REVOUT';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', super_auth, 'role', 'authenticated')::TEXT, true);
  INSERT INTO public.projects (code, name) VALUES ('REVTEST', 'Review scope test') RETURNING id INTO project_id;
  INSERT INTO public.project_managers (project_id, employee_id) VALUES (project_id, manager_id);
  INSERT INTO public.project_members (project_id, employee_id) VALUES (project_id, employee_id);
  INSERT INTO public.daily_reports (employee_id, date, bos_report, eod_report) VALUES
    (employee_id, '2026-09-01', 'Daily plan', 'Completed work'),
    (employee_id, '2026-09-02', 'Next plan', NULL),
    (outside_id, '2026-09-01', 'Outside plan', NULL);
  INSERT INTO public.employee_work_settings (employee_id, bos_required, eod_required)
    VALUES (employee_id, true, false)
    ON CONFLICT ON CONSTRAINT employee_work_settings_pkey DO UPDATE SET eod_required = false;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', employee_auth, 'role', 'authenticated')::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM pg_temp.review_assert('personal_report_only_days_and_timestamps',
    (SELECT count(*) = 2 AND bool_and(bos_submitted_at IS NOT NULL) AND bool_and(NOT eod_required)
      FROM public.scoped_daily_reviews('2026-09-01','2026-09-30','personal',NULL)));
  PERFORM pg_temp.review_assert('employee_cannot_request_other_person',
    NOT EXISTS (SELECT 1 FROM public.scoped_daily_reviews('2026-09-01','2026-09-30','personal',outside_id)));
  PERFORM pg_temp.review_assert('direct_table_rls_denies_outside',
    NOT EXISTS (SELECT 1 FROM public.daily_reports WHERE daily_reports.employee_id = outside_id));
  denied := false;
  BEGIN PERFORM * FROM public.scoped_daily_reviews('2026-09-01','2026-09-30','organisation',NULL);
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  PERFORM pg_temp.review_assert('employee_denied_organisation', denied);
  denied := false;
  BEGIN PERFORM * FROM public.scoped_daily_reviews('2026-09-01','2026-10-02','personal',NULL);
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  PERFORM pg_temp.review_assert('bounded_range', denied);
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', manager_auth, 'role', 'authenticated')::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM pg_temp.review_assert('manager_assigned_team_only',
    (SELECT count(*) = 2 AND bool_and(review.employee_id = review_test.employee_id)
      FROM public.scoped_daily_reviews('2026-09-01','2026-09-30','managed',NULL) review));
  PERFORM pg_temp.review_assert('manager_direct_rls_matches_projection',
    NOT EXISTS (SELECT 1 FROM public.daily_reports WHERE daily_reports.employee_id = outside_id));
  denied := false;
  BEGIN PERFORM * FROM public.scoped_daily_reviews('2026-09-01','2026-09-30','organisation',NULL);
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  PERFORM pg_temp.review_assert('manager_denied_organisation', denied);
  EXECUTE 'RESET ROLE';
  FOREACH actor IN ARRAY ARRAY[admin_auth, super_auth] LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', actor, 'role', 'authenticated')::TEXT, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM pg_temp.review_assert('organisation_outside_access_' || actor::text,
      (SELECT count(*) = 1 FROM public.scoped_daily_reviews('2026-09-01','2026-09-30','organisation',outside_id)));
    EXECUTE 'RESET ROLE';
  END LOOP;
  UPDATE public.employees SET must_change_password = true WHERE auth_id = admin_auth;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', admin_auth, 'role', 'authenticated')::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  denied := false;
  BEGIN PERFORM * FROM public.scoped_daily_reviews('2026-09-01','2026-09-30','organisation',NULL);
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  PERFORM pg_temp.review_assert('password_gate_denied', denied);
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE anon';
  denied := false;
  BEGIN PERFORM * FROM public.scoped_daily_reviews('2026-09-01','2026-09-30','personal',NULL);
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM pg_temp.review_assert('anonymous_denied', denied);
  EXECUTE 'RESET ROLE';
END;
$$;
SELECT bool_and(passed) AS all_checks_pass, jsonb_object_agg(name, passed) AS checks FROM review_checks;
ROLLBACK;
