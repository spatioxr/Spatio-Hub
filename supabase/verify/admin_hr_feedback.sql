-- Feedback #37/#38/#40/#43. Isolated fixtures; all changes roll back.
BEGIN;
CREATE TEMP TABLE feedback_actors AS
WITH seed(role, code) AS (
  VALUES ('employee', 'FBEMP'), ('manager', 'FBMGR'), ('admin', 'FBADMIN'), ('superadmin', 'FBSUPER')
), identities AS (
  INSERT INTO auth.users (id, email)
  SELECT gen_random_uuid(), lower(code) || '@hr-feedback.example.invalid' FROM seed
  RETURNING id, email
), employees AS (
  INSERT INTO public.employees (auth_id, emp_code, name, email, department, role, status)
  SELECT identities.id, seed.code, seed.code, identities.email, 'Feedback verification', seed.role, 'Active'
  FROM seed JOIN identities ON identities.email = lower(seed.code) || '@hr-feedback.example.invalid'
  RETURNING id, auth_id, role
)
SELECT * FROM employees;
ALTER TABLE feedback_actors ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_read ON feedback_actors FOR SELECT TO authenticated USING (true);
GRANT SELECT ON feedback_actors TO authenticated;
INSERT INTO public.leave_balances (employee_id) SELECT id FROM feedback_actors;

SET LOCAL ROLE authenticated;
DO $$
DECLARE actor RECORD;
BEGIN
  FOR actor IN SELECT * FROM feedback_actors LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', actor.auth_id, 'role', 'authenticated')::text, true);
    IF public.can_manage_leave() IS DISTINCT FROM (actor.role IN ('admin', 'superadmin'))
      OR public.can_manage_organisation_downtime() IS DISTINCT FROM (actor.role IN ('admin', 'superadmin'))
    THEN RAISE EXCEPTION 'Unexpected HR permissions for %', actor.role; END IF;
  END LOOP;
END $$;

SELECT set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'role', 'authenticated')::text, true)
FROM feedback_actors WHERE role = 'employee';
CREATE TEMP TABLE feedback_request AS
SELECT * FROM public.submit_leave_request('Casual Leave', DATE '2099-09-08', DATE '2099-09-08', true, 'Feedback verification');
ALTER TABLE feedback_request ENABLE ROW LEVEL SECURITY;

SELECT set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'role', 'authenticated')::text, true)
FROM feedback_actors WHERE role = 'admin';
DO $$
DECLARE
  target_id UUID := (SELECT id FROM feedback_actors WHERE role = 'employee');
  own_id UUID := (SELECT id FROM feedback_actors WHERE role = 'admin');
  before_days NUMERIC;
  after_days NUMERIC;
  own_request public.leaves;
  holiday public.holidays;
  incident public.organisation_downtime_events;
  denied BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.scoped_leave_requests() WHERE leave_id = (SELECT id FROM feedback_request)) THEN
    RAISE EXCEPTION 'Admin cannot read organisation request history';
  END IF;
  SELECT casual_leave INTO before_days FROM public.leave_admin_balance_overview() WHERE employee_id = target_id;
  PERFORM public.decide_leave_request((SELECT id FROM feedback_request), true, 'Admin approval');
  PERFORM public.adjust_leave_balance(target_id, 'Casual Leave', 0.5, 'Late-joiner entitlement adjustment');
  PERFORM public.adjust_leave_balance(target_id, 'Casual Leave', -0.5, 'Reverse test adjustment');
  SELECT casual_leave INTO after_days FROM public.leave_admin_balance_overview() WHERE employee_id = target_id;
  IF after_days IS DISTINCT FROM before_days - 0.5 THEN RAISE EXCEPTION 'Incorrect balance after approval and adjustments'; END IF;
  IF (SELECT count(*) FROM public.leave_balance_history(target_id)) < 3 THEN RAISE EXCEPTION 'Missing balance audit history'; END IF;

  SELECT * INTO own_request FROM public.submit_leave_request('Casual Leave', DATE '2099-09-09', DATE '2099-09-09', false, 'Admin own request');
  IF own_request.status <> 'Pending' THEN RAISE EXCEPTION 'Admin request auto-approved'; END IF;
  denied := false;
  BEGIN PERFORM public.decide_leave_request(own_request.id, true, NULL);
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Admin self-approval succeeded'; END IF;
  denied := false;
  BEGIN PERFORM public.adjust_leave_balance(own_id, 'Casual Leave', 1, 'Self adjustment');
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Admin self-adjustment succeeded'; END IF;
  denied := false;
  BEGIN PERFORM public.adjust_leave_balance(target_id, 'Casual Leave', 0.25, 'Invalid granularity');
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Quarter-day adjustment succeeded'; END IF;
  denied := false;
  BEGIN PERFORM public.adjust_leave_balance(target_id, 'Casual Leave', -1000, 'Invalid overdraft');
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Balance overdraft succeeded'; END IF;
  denied := false;
  BEGIN PERFORM public.adjust_leave_balance(target_id, 'Casual Leave', 1, '');
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Reasonless adjustment succeeded'; END IF;

  SELECT * INTO holiday FROM public.save_company_holiday(NULL, 'Feedback holiday', DATE '2099-11-02');
  PERFORM public.remove_company_holiday(holiday.id);
  SELECT * INTO incident FROM public.create_organisation_downtime('maintenance', 'Feedback maintenance', 'Rollback only', '2099-11-03 10:00+05:30', '2099-11-03 11:00+05:30');
  IF NOT EXISTS (SELECT 1 FROM public.organisation_downtime_audit WHERE downtime_event_id = incident.id) THEN
    RAISE EXCEPTION 'Missing downtime audit';
  END IF;
  denied := false;
  BEGIN PERFORM public.set_leave_admin_access(target_id, true);
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Admin granted delegated capability'; END IF;
  denied := false;
  BEGIN PERFORM public.set_downtime_manager_access(target_id, true);
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Admin granted downtime capability'; END IF;
END $$;
RESET ROLE;
-- Disabled and password-reset-required Admin identities must still fail closed.
UPDATE public.employees SET status = 'Released' WHERE id = (SELECT id FROM feedback_actors WHERE role = 'admin');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.can_manage_leave() OR public.can_manage_organisation_downtime() THEN RAISE EXCEPTION 'Archived Admin retains access'; END IF;
END $$;
RESET ROLE;
UPDATE public.employees SET status = 'Active', must_change_password = true WHERE id = (SELECT id FROM feedback_actors WHERE role = 'admin');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.can_manage_leave() OR public.can_manage_organisation_downtime() THEN RAISE EXCEPTION 'Password-reset Admin retains access'; END IF;
END $$;
RESET ROLE;
SELECT true AS all_checks_pass, jsonb_build_object('admin_hr_feedback', true);
ROLLBACK;
