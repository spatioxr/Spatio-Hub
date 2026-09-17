-- Feedback 14/50: rollback-only actual-role allocation, review and RLS tests.
BEGIN;
CREATE TEMP TABLE workload_checks(name TEXT PRIMARY KEY, passed BOOLEAN NOT NULL);
ALTER TABLE workload_checks ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION pg_temp.workload_assert(label TEXT, result BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
  IF result IS DISTINCT FROM true THEN RAISE EXCEPTION 'Workload check failed: %', label; END IF;
  INSERT INTO workload_checks VALUES(label,true);
END; $$;
DO $$
<<checks>>
DECLARE
  super_auth UUID := gen_random_uuid(); manager_auth UUID := gen_random_uuid(); employee_auth UUID := gen_random_uuid(); admin_auth UUID := gen_random_uuid();
  super_id UUID; manager_id UUID; employee_id UUID; admin_id UUID; night_id UUID; stale_id UUID; outside_id UUID;
  owned UUID; other UUID; activity UUID; entry_id UUID; stale_entry UUID; leave_id UUID; hidden_entry UUID; day_one DATE; day_two DATE; day_three DATE;
  test_month DATE := (date_trunc('month',public.app_current_date()) - interval '1 month')::date;
  current_month DATE := date_trunc('month',public.app_current_date())::date;
  report JSONB; person JSONB; fact JSONB; n NUMERIC; denied BOOLEAN; signature TEXT;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(super_auth,'cost-super@example.invalid'),(manager_auth,'cost-manager@example.invalid'),(employee_auth,'cost-employee@example.invalid'),(admin_auth,'cost-admin@example.invalid');
  INSERT INTO public.employees(auth_id,emp_code,name,email,role,status,date_of_joining) VALUES
    (super_auth,'COSTSUP','Cost Super','cost-super@example.invalid','superadmin','Active','2020-01-01'),
    (manager_auth,'COSTMGR','Cost Manager','cost-manager@example.invalid','manager','Active','2020-01-01'),
    (employee_auth,'COSTEMP','Cost Employee','cost-employee@example.invalid','employee','Active','2020-01-01'),
    (admin_auth,'COSTADM','Cost Admin','cost-admin@example.invalid','admin','Active','2020-01-01'),
    (NULL,'COSTNGT','Cost Night','cost-night@example.invalid','employee','Active','2020-01-01'),
    (NULL,'COSTSTL','Cost Stale','cost-stale@example.invalid','employee','Active','2020-01-01'),
    (NULL,'COSTOUT','Cost Outside','cost-outside@example.invalid','employee','Active','2020-01-01');
  SELECT id INTO super_id FROM public.employees WHERE auth_id=super_auth;
  SELECT id INTO manager_id FROM public.employees WHERE auth_id=manager_auth;
  SELECT id INTO employee_id FROM public.employees WHERE auth_id=employee_auth;
  SELECT id INTO admin_id FROM public.employees WHERE auth_id=admin_auth;
  SELECT id INTO night_id FROM public.employees WHERE emp_code='COSTNGT';
  SELECT id INTO stale_id FROM public.employees WHERE emp_code='COSTSTL';
  SELECT id INTO outside_id FROM public.employees WHERE emp_code='COSTOUT';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',super_auth,'role','authenticated')::text,true);
  INSERT INTO public.projects(code,name) VALUES('COSTOWN','Visible project') RETURNING id INTO owned;
  INSERT INTO public.projects(code,name) VALUES('COSTOTHER','Secret project') RETURNING id INTO other;
  INSERT INTO public.project_managers(project_id,employee_id) VALUES(owned,manager_id),(other,super_id);
  INSERT INTO public.project_members(project_id,employee_id) VALUES(owned,employee_id),(other,employee_id),(owned,night_id),(owned,stale_id);
  INSERT INTO public.activities(name) VALUES('Cost internal') RETURNING id INTO activity;
  INSERT INTO public.work_entries(employee_id,project_id,activity_id,task_description,started_at,ended_at)
    SELECT employee_id, CASE WHEN extract(day FROM d)::int % 3=0 THEN NULL WHEN extract(day FROM d)::int % 3=1 THEN owned ELSE other END,
      CASE WHEN extract(day FROM d)::int % 3=0 THEN activity END, 'Recorded work', public.app_day_start(d::date)+interval '9 hours',public.app_day_start(d::date)+interval '18 hours'
    FROM generate_series(test_month::timestamp,(test_month+interval '1 month - 1 day')::timestamp,interval '1 day') d
    WHERE extract(isodow FROM d) BETWEEN 1 AND 5 AND NOT EXISTS(SELECT 1 FROM public.holidays h WHERE h.date=d::date);
  SELECT min(public.app_current_date(started_at)) INTO day_one FROM public.work_entries e WHERE e.employee_id=checks.employee_id;
  SELECT min(public.app_current_date(started_at)) INTO day_two FROM public.work_entries e WHERE e.employee_id=checks.employee_id AND public.app_current_date(started_at)>day_one;
  EXECUTE 'SET LOCAL ROLE authenticated';
  report := public.workload_month(test_month);
  SELECT p INTO person FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=employee_id::text;
  PERFORM pg_temp.workload_assert('default_176', (report->>'monthly_hours')::numeric=176);
  PERFORM pg_temp.workload_assert('overtime_does_not_inflate_pool', abs((person->>'allocated_hours')::numeric-176)<0.000001);
  SELECT sum((c->>'costing_hours')::numeric) INTO n FROM jsonb_array_elements(person->'days') d CROSS JOIN LATERAL jsonb_array_elements(d->'contexts') c;
  PERFORM pg_temp.workload_assert('all_project_and_internal_allocations_reconcile',abs(n-176)<0.000001);
  PERFORM pg_temp.workload_assert('internal_work_gets_share',EXISTS(SELECT 1 FROM jsonb_array_elements(person->'days') d CROSS JOIN LATERAL jsonb_array_elements(d->'contexts') c WHERE c->>'context_type'='activity' AND (c->>'costing_hours')::numeric>0));
  denied:=false; BEGIN PERFORM * FROM public.workload_person_days(employee_id,test_month); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  PERFORM pg_temp.workload_assert('private_calculator_not_callable',denied);
  denied:=false; BEGIN PERFORM public.set_costing_baseline(test_month,160,'Backdate'); EXCEPTION WHEN OTHERS THEN denied:=true; END;
  PERFORM pg_temp.workload_assert('past_baseline_locked',denied);
  PERFORM public.set_costing_baseline(current_month,160,'Current monthly baseline');
  PERFORM public.set_costing_baseline((current_month+interval '3 months')::date,168,'Next quarter');
  PERFORM pg_temp.workload_assert('effective_month_versions', (public.workload_month(test_month)->>'monthly_hours')::numeric=176 AND (public.workload_month(current_month)->>'monthly_hours')::numeric=160 AND (public.workload_month((current_month+interval '3 months')::date)->>'monthly_hours')::numeric=168);
  EXECUTE 'RESET ROLE';

  -- Partial day leaves missing hours unallocated, not redistributed.
  UPDATE public.work_entries SET ended_at=started_at+interval '4 hours' WHERE work_entries.employee_id=checks.employee_id AND public.app_current_date(started_at)=day_one;
  report:=public.workload_month(test_month);
  SELECT p INTO person FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=employee_id::text;
  PERFORM pg_temp.workload_assert('partial_day_reserved',abs((person->>'unallocated_hours')::numeric - 176/(report->>'working_days')::numeric/2)<0.000001);

  SELECT d INTO fact FROM jsonb_array_elements(person->'days') d WHERE d->>'work_date'=day_one::text;
  n := (person->>'allocated_hours')::numeric;
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.confirm_workload_day(employee_id,day_one,fact->>'fingerprint','Four hours is correct');
  report:=public.workload_month(test_month);
  SELECT p INTO person FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=employee_id::text;
  SELECT d INTO fact FROM jsonb_array_elements(person->'days') d WHERE d->>'work_date'=day_one::text;
  PERFORM pg_temp.workload_assert('short_day_confirmation_clears_queue', (fact->>'confirmed')::boolean AND NOT fact->'flags' ? 'missing_time' AND fact->'flags' ? 'below_eight');
  PERFORM pg_temp.workload_assert('short_day_confirmation_does_not_inflate_cost',abs((person->>'allocated_hours')::numeric-n)<0.000001);
  EXECUTE 'RESET ROLE';
  UPDATE public.work_entries SET task_description='Short day changed' WHERE work_entries.employee_id=checks.employee_id AND public.app_current_date(started_at)=day_one;
  report:=public.workload_month(test_month);
  SELECT p INTO person FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=employee_id::text;
  PERFORM pg_temp.workload_assert('short_day_edit_requires_review_again',EXISTS(SELECT 1 FROM jsonb_array_elements(person->'days') d WHERE d->>'work_date'=day_one::text AND d->'flags' ? 'missing_time'));

  INSERT INTO public.leave_balances(employee_id) VALUES(employee_id) ON CONFLICT DO NOTHING;
  -- Leave uses the canonical submit / decide workflow.
  SELECT id INTO entry_id FROM public.work_entries e WHERE e.employee_id=checks.employee_id AND public.app_current_date(e.started_at)=day_two;
  PERFORM public.void_manual_time_entry(entry_id,'Leave day was logged accidentally');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',employee_auth,'role','authenticated')::text,true);
  SELECT id INTO leave_id FROM public.submit_leave_request('Casual Leave',day_two,day_two,true,'Test approved half day');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',super_auth,'role','authenticated')::text,true);
  PERFORM public.decide_leave_request(leave_id,true,NULL);
  report:=public.workload_month(test_month);
  SELECT p INTO person FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=employee_id::text;
  PERFORM pg_temp.workload_assert('half_leave_reserved',abs((person->>'leave_hours')::numeric - 176/(report->>'working_days')::numeric/2)<0.000001);
  PERFORM pg_temp.workload_assert('pool_leave_unallocated_reconcile',abs((person->>'allocated_hours')::numeric+(person->>'leave_hours')::numeric+(person->>'unallocated_hours')::numeric-176)<0.000001);

  SELECT min(public.app_current_date(started_at)) INTO day_three FROM public.work_entries e WHERE e.employee_id=checks.employee_id AND e.voided_at IS NULL AND public.app_current_date(started_at)>day_two;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',employee_auth,'role','authenticated')::text,true);
  SELECT id INTO leave_id FROM public.submit_leave_request('Casual Leave',day_three,day_three,false,'Full day leave');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',super_auth,'role','authenticated')::text,true);
  PERFORM public.decide_leave_request(leave_id,true,NULL);
  report:=public.workload_month(test_month);
  SELECT p INTO person FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=employee_id::text;
  SELECT d INTO fact FROM jsonb_array_elements(person->'days') d WHERE d->>'work_date'=day_three::text;
  PERFORM pg_temp.workload_assert('full_leave_conflict_blocks_allocation',fact->'flags' ? 'work_on_leave' AND (fact->>'costing_hours')::numeric=0 AND (fact->>'leave_fraction')::numeric=1);
  SELECT p INTO person FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=outside_id::text;
  PERFORM pg_temp.workload_assert('no_records_no_manufactured_cost',(person->>'allocated_hours')::numeric=0 AND (person->>'unallocated_hours')::numeric=176);

  -- Midnight and month overlap with break clipping; 23:00–02:00 less 23:30–01:30.
  INSERT INTO public.work_entries(employee_id,project_id,task_description,started_at,ended_at)
    VALUES(night_id,owned,'Overnight',public.app_day_start(test_month)-interval '1 hour',public.app_day_start(test_month)+interval '2 hours') RETURNING id INTO entry_id;
  INSERT INTO public.break_entries(work_entry_id,started_at,ended_at) VALUES(entry_id,public.app_day_start(test_month)-interval '30 minutes',public.app_day_start(test_month)+interval '90 minutes');
  report:=public.workload_month(test_month);
  SELECT p INTO person FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=night_id::text;
  PERFORM pg_temp.workload_assert('overnight_month_and_break_split', (person->'days'->0->>'recorded_seconds')::numeric=1800);

  -- Stale timer is still visible but contributes no costing hours, then resolves atomically.
  INSERT INTO public.work_entries(employee_id,project_id,task_description,started_at)
    VALUES(stale_id,owned,'Unfinished timer',public.app_day_start(public.app_current_date()-2)+interval '9 hours') RETURNING id INTO stale_entry;
  INSERT INTO public.attendance(employee_id,date,check_in,status) VALUES(stale_id,public.app_current_date()-2,'09:00','Present');
  report:=public.workload_month(current_month);
  SELECT p INTO person FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=stale_id::text;
  PERFORM pg_temp.workload_assert('stale_timer_excluded', (person->>'allocated_hours')::numeric=0 AND EXISTS(SELECT 1 FROM jsonb_array_elements(person->'days') d WHERE d->'flags' ? 'stale_session'));
  PERFORM pg_temp.workload_assert('daily_slices_never_exceed_24h',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(person->'days') d WHERE (d->>'recorded_seconds')::numeric>86400));
  EXECUTE 'SET LOCAL ROLE authenticated';
  denied:=false; BEGIN PERFORM public.close_stale_work_entry(stale_entry,statement_timestamp()+interval '1 hour','Wrong end'); EXCEPTION WHEN OTHERS THEN denied:=true; END;
  PERFORM pg_temp.workload_assert('future_close_denied',denied);
  PERFORM public.close_stale_work_entry(stale_entry,public.app_day_start(public.app_current_date()-1)+interval '1 hour','Actual end confirmed with employee');
  PERFORM pg_temp.workload_assert('stale_close_audited', (SELECT count(*)=1 FROM public.work_entry_audit WHERE work_entry_id=stale_entry));
  PERFORM pg_temp.workload_assert('overnight_actual_end_preserved',(SELECT checked_out_at=public.app_day_start(public.app_current_date()-1)+interval '1 hour' FROM public.attendance WHERE attendance.employee_id=stale_id AND date=public.app_current_date()-2));
  PERFORM pg_temp.workload_assert('admin_timer_audit_recorded',(SELECT count(*)=1 FROM public.admin_work_action_audit WHERE work_entry_id=stale_entry));
  EXECUTE 'RESET ROLE';

  -- Confirmed long days are tied to an exact snapshot, not a permanent exemption.
  UPDATE public.work_entries SET ended_at=started_at+interval '13 hours' WHERE work_entries.employee_id=checks.employee_id AND public.app_current_date(started_at)=day_one;
  report:=public.workload_month(test_month);
  SELECT p INTO person FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=employee_id::text;
  SELECT d INTO fact FROM jsonb_array_elements(person->'days') d WHERE d->>'work_date'=day_one::text;
  signature:=fact->>'fingerprint';
  PERFORM pg_temp.workload_assert('unconfirmed_long_day_excluded',(fact->>'costing_hours')::numeric=0 AND fact->'flags' ? 'long_day');
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.confirm_workload_day(employee_id,day_one,signature,'Delivery work verified');
  report:=public.workload_month(test_month);
  SELECT p INTO person FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=employee_id::text;
  SELECT d INTO fact FROM jsonb_array_elements(person->'days') d WHERE d->>'work_date'=day_one::text;
  PERFORM pg_temp.workload_assert('confirmed_long_day_allocates_without_extra_pool',(fact->>'confirmed')::boolean AND (fact->>'costing_hours')::numeric>0 AND (person->>'allocated_hours')::numeric<=176);
  denied:=false; BEGIN UPDATE public.workload_day_reviews SET reason='Rewrite'; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  PERFORM pg_temp.workload_assert('reviews_immutable_to_client',denied);
  EXECUTE 'RESET ROLE';
  UPDATE public.work_entries SET task_description='Changed after confirmation' WHERE work_entries.employee_id=checks.employee_id AND public.app_current_date(started_at)=day_one;
  report:=public.workload_month(test_month);
  SELECT p INTO person FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=employee_id::text;
  PERFORM pg_temp.workload_assert('edit_invalidates_confirmation',EXISTS(SELECT 1 FROM jsonb_array_elements(person->'days') d WHERE d->>'work_date'=day_one::text AND d->'flags' ? 'long_day' AND NOT (d->>'confirmed')::boolean));

  SELECT id INTO hidden_entry FROM public.work_entries WHERE project_id=other AND voided_at IS NULL LIMIT 1;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',manager_auth,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  report:=public.workload_month(test_month);
  PERFORM pg_temp.workload_assert('other_reviewers_notes_not_exposed',NOT EXISTS(SELECT 1 FROM public.workload_day_reviews));
  PERFORM pg_temp.workload_assert('manager_person_scope',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=outside_id::text));
  SELECT p INTO person FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=employee_id::text;
  SELECT d INTO fact FROM jsonb_array_elements(person->'days') d WHERE d->>'work_date'=day_one::text;
  PERFORM pg_temp.workload_assert('manager_cannot_review_day',NOT (fact->>'can_review')::boolean);
  denied:=false; BEGIN PERFORM public.confirm_workload_day(employee_id,day_one,fact->>'fingerprint','Manager confirms own team'); EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='Only Admins can resolve workload reviews'; END;
  PERFORM pg_temp.workload_assert('manager_valid_confirmation_denied',denied);
  PERFORM pg_temp.workload_assert('cross_project_aggregate_only',person::text LIKE '%other_projects%' AND person::text NOT LIKE '%Secret project%' AND person::text NOT LIKE '%'||other::text||'%');
  denied:=false; BEGIN PERFORM * FROM public.work_entry_change_history(hidden_entry); EXCEPTION WHEN OTHERS THEN denied:=true; END;
  PERFORM pg_temp.workload_assert('other_project_history_denied',denied);
  denied:=false; BEGIN PERFORM public.confirm_workload_day(outside_id,day_one,'forged','Forged review'); EXCEPTION WHEN OTHERS THEN denied:=true; END;
  PERFORM pg_temp.workload_assert('forged_review_denied',denied);
  PERFORM pg_temp.workload_assert('raw_rls_hides_other_project',NOT EXISTS(SELECT 1 FROM public.work_entries WHERE project_id=other));
  PERFORM pg_temp.workload_assert('rpc_hides_other_project',NOT EXISTS(SELECT 1 FROM public.scoped_timesheet_entries(public.app_day_start(test_month),public.app_day_start((test_month+interval '1 month')::date),'managed',NULL) WHERE context_id=other));
  denied:=false; BEGIN PERFORM public.set_costing_baseline(current_month,200,'Manager attempt'); EXCEPTION WHEN OTHERS THEN denied:=true; END;
  PERFORM pg_temp.workload_assert('manager_baseline_denied',denied);
  denied:=false; BEGIN PERFORM public.close_stale_work_entry(stale_entry,statement_timestamp(),'Manager attempt'); EXCEPTION WHEN OTHERS THEN denied:=true; END;
  PERFORM pg_temp.workload_assert('manager_live_mutation_denied',denied);
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',employee_auth,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  denied:=false; BEGIN PERFORM public.workload_month(test_month); EXCEPTION WHEN OTHERS THEN denied:=true; END;
  PERFORM pg_temp.workload_assert('employee_management_denied',denied);
  PERFORM pg_temp.workload_assert('employee_baseline_rls_denied',NOT EXISTS(SELECT 1 FROM public.costing_baselines));
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_auth,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  report:=public.workload_month(test_month);
  SELECT p INTO person FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=employee_id::text;
  SELECT d INTO fact FROM jsonb_array_elements(person->'days') d WHERE d->>'work_date'=day_one::text;
  PERFORM public.confirm_workload_day(employee_id,day_one,fact->>'fingerprint','Admin verified');
  PERFORM pg_temp.workload_assert('admin_can_confirm_day',EXISTS(SELECT 1 FROM public.workload_day_reviews WHERE reviewed_by=admin_id));
  PERFORM pg_temp.workload_assert('admin_organisation_scope',EXISTS(SELECT 1 FROM jsonb_array_elements(report->'people') p WHERE p->>'id'=outside_id::text));
  EXECUTE 'RESET ROLE';
  UPDATE public.employees SET must_change_password=true WHERE id=admin_id;
  EXECUTE 'SET LOCAL ROLE authenticated';
  denied:=false; BEGIN PERFORM public.workload_month(test_month); EXCEPTION WHEN OTHERS THEN denied:=true; END;
  PERFORM pg_temp.workload_assert('password_gate_denied',denied);
  EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE anon';
  denied:=false; BEGIN PERFORM public.workload_month(test_month); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  PERFORM pg_temp.workload_assert('anonymous_denied',denied);
  EXECUTE 'RESET ROLE';
END;
$$;
SELECT bool_and(passed) AS all_checks_pass,jsonb_object_agg(name,passed) AS checks FROM workload_checks;
ROLLBACK;
