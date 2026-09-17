-- Rollback-only synthetic security and workflow verification.
BEGIN;
CREATE TEMP TABLE feedback_actors(role text, employee_id uuid, auth_id uuid);
WITH seed(role) AS (VALUES ('employee'),('manager'),('admin'),('superadmin')),
users AS (INSERT INTO auth.users(id,email) SELECT gen_random_uuid(),'feedback-'||role||'@example.invalid' FROM seed RETURNING id,email),
people AS (INSERT INTO public.employees(auth_id,emp_code,name,email,role,status)
  SELECT u.id,'FB-'||s.role,'Feedback '||s.role,u.email,s.role,'Active' FROM seed s JOIN users u ON u.email='feedback-'||s.role||'@example.invalid' RETURNING id,auth_id,role)
INSERT INTO feedback_actors SELECT role,id,auth_id FROM people;
GRANT SELECT ON feedback_actors TO authenticated;
CREATE TEMP TABLE feedback_test_ids(id uuid);
GRANT SELECT,INSERT ON feedback_test_ids TO authenticated;
DO $$ BEGIN
 IF public.feedback_schedule_due('2026-09-17','weekly',5) <> date '2026-09-11'
 OR public.feedback_schedule_due('2026-09-21','weekly',5) <> date '2026-09-18'
 OR public.feedback_schedule_due('2026-09-17','fortnightly',1) <> date '2026-09-14'
 OR public.feedback_schedule_due('2026-09-02','monthly',5) <> date '2026-08-07'
 OR public.feedback_schedule_due('2026-09-17','monthly',5) <> date '2026-09-04'
 THEN RAISE EXCEPTION 'Schedule dates incorrect'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE actor record; pulse uuid; response uuid:=gen_random_uuid(); result jsonb; denied boolean;
BEGIN
 FOR actor IN SELECT * FROM feedback_actors WHERE role <> 'superadmin' LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_id,'role','authenticated')::text,true);
  denied:=false;
  BEGIN PERFORM public.manage_work_feedback('launch'); EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Non-superadmin launch allowed'; END IF;
  IF EXISTS(SELECT 1 FROM public.work_feedback_settings) OR EXISTS(SELECT 1 FROM public.work_feedback_pulses) THEN RAISE EXCEPTION 'Settings RLS failed'; END IF;
 END LOOP;
 SELECT * INTO actor FROM feedback_actors WHERE role='superadmin';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_id,'role','authenticated')::text,true);
 PERFORM public.manage_work_feedback('save',false,'monthly',5);
 IF public.claim_work_feedback_prompt() THEN RAISE EXCEPTION 'Disabled schedule prompted'; END IF;
 result:=public.manage_work_feedback('launch'); pulse:=(result->'pulse'->>'id')::uuid;
 IF pulse IS NULL OR (public.manage_work_feedback('launch')->'pulse'->>'id')::uuid<>pulse THEN RAISE EXCEPTION 'Launch not idempotent'; END IF;
 IF public.claim_work_feedback_pulse() IS NOT NULL THEN RAISE EXCEPTION 'Sender prompted'; END IF;
 SELECT * INTO actor FROM feedback_actors WHERE role='employee';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_id,'role','authenticated')::text,true);
 denied:=false;
 BEGIN PERFORM public.submit_work_feedback(gen_random_uuid(),3,'',false,'pulse',pulse); EXCEPTION WHEN raise_exception THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Unclaimed pulse accepted'; END IF;
 IF public.claim_work_feedback_pulse() IS DISTINCT FROM pulse OR public.claim_work_feedback_pulse() IS NOT NULL THEN RAISE EXCEPTION 'Pulse claim not deduplicated'; END IF;
 PERFORM public.submit_work_feedback(response,4,'Test pulse',false,'pulse',pulse);
 PERFORM public.submit_work_feedback(response,4,'Test pulse',false,'pulse',pulse);
 denied:=false;
 BEGIN PERFORM public.submit_work_feedback(gen_random_uuid(),4,'',false,'pulse',pulse); EXCEPTION WHEN unique_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Duplicate pulse response accepted'; END IF;
 IF EXISTS(SELECT 1 FROM public.work_feedback) THEN RAISE EXCEPTION 'Employee response leaked'; END IF;
 SELECT * INTO actor FROM feedback_actors WHERE role='superadmin';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_id,'role','authenticated')::text,true);
 IF NOT EXISTS(SELECT 1 FROM public.list_work_feedback() WHERE id=response AND source='pulse') THEN RAISE EXCEPTION 'Inbox missing pulse'; END IF;
 PERFORM public.manage_work_feedback('close');
 SELECT * INTO actor FROM feedback_actors WHERE role='manager';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_id,'role','authenticated')::text,true);
 IF public.claim_work_feedback_pulse() IS NOT NULL THEN RAISE EXCEPTION 'Closed pulse prompted'; END IF;
END $$;
RESET ROLE;
-- Expired pulses and future schedules are never offered.
UPDATE public.work_feedback_pulses SET closed_at=NULL,expires_at=now()-interval '1 second';
UPDATE public.work_feedback_settings SET enabled=true,starts_on=(now() AT TIME ZONE 'Asia/Kolkata')::date+30;
SET LOCAL ROLE authenticated;
DO $$ DECLARE actor record; BEGIN
 SELECT * INTO actor FROM feedback_actors WHERE role='admin';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_id,'role','authenticated')::text,true);
 IF public.claim_work_feedback_pulse() IS NOT NULL OR public.claim_work_feedback_prompt() THEN RAISE EXCEPTION 'Expired pulse or future schedule offered'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.manage_work_feedback(text,boolean,text,integer)','EXECUTE')
 OR has_function_privilege('anon','public.claim_work_feedback_pulse()','EXECUTE')
 OR has_function_privilege('anon','public.submit_work_feedback(uuid,integer,text,boolean,text,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Anonymous RPC access'; END IF;
END $$;
SELECT 'Feedback schedule, pulse isolation, claims, retries and closure passed' AS result;
ROLLBACK;
