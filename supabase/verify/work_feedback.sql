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
SET LOCAL ROLE authenticated;
DO $$
DECLARE actor record; response_id uuid := gen_random_uuid(); caught boolean; n integer;
BEGIN
  SELECT * INTO actor FROM feedback_actors WHERE role='employee';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_id,'role','authenticated')::text,true);
  IF NOT public.claim_work_feedback_prompt() OR public.claim_work_feedback_prompt() THEN RAISE EXCEPTION 'Weekly prompt not deduplicated'; END IF;
  PERFORM public.submit_work_feedback(response_id,1,'Synthetic feedback',true,'weekly');
  PERFORM public.submit_work_feedback(response_id,1,'Synthetic feedback',true,'weekly');
  IF EXISTS(SELECT 1 FROM public.work_feedback) THEN RAISE EXCEPTION 'Employee can read submitted feedback'; END IF;
  INSERT INTO feedback_test_ids VALUES(response_id);
  IF public.claim_work_feedback_prompt() THEN RAISE EXCEPTION 'Prompt after response'; END IF;
  caught := false;
  BEGIN PERFORM public.submit_work_feedback(gen_random_uuid(),5,'Duplicate weekly',false,'weekly'); EXCEPTION WHEN raise_exception THEN caught := true; END;
  IF NOT caught THEN RAISE EXCEPTION 'Second weekly response allowed'; END IF;
  caught := false;
  BEGIN PERFORM public.submit_work_feedback(gen_random_uuid(),6); EXCEPTION WHEN raise_exception THEN caught := true; END;
  IF NOT caught THEN RAISE EXCEPTION 'Invalid rating allowed'; END IF;
  caught := false;
  BEGIN UPDATE public.work_feedback SET status='followed_up'; EXCEPTION WHEN insufficient_privilege THEN caught := true; END;
  IF NOT caught THEN RAISE EXCEPTION 'Direct mutation allowed'; END IF;
  FOR n IN 1..5 LOOP
    PERFORM public.submit_work_feedback(gen_random_uuid(),n,'Rating coverage',false,'anytime');
  END LOOP;
  caught := false;
  BEGIN PERFORM public.submit_work_feedback(gen_random_uuid(),3,repeat('x',2001)); EXCEPTION WHEN raise_exception THEN caught := true; END;
  IF NOT caught THEN RAISE EXCEPTION 'Oversized comment allowed'; END IF;
  FOR actor IN SELECT * FROM feedback_actors WHERE role IN ('employee','manager','admin') LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_id,'role','authenticated')::text,true);
    IF EXISTS(SELECT 1 FROM public.work_feedback) THEN RAISE EXCEPTION 'Cross-person read'; END IF;
    caught := false;
    BEGIN PERFORM public.list_work_feedback(); EXCEPTION WHEN raise_exception THEN caught := true; END;
    IF NOT caught THEN RAISE EXCEPTION 'Inbox allowed for %',actor.role; END IF;
    caught := false;
    BEGIN PERFORM public.advance_work_feedback(response_id,'new'); EXCEPTION WHEN raise_exception THEN caught := true; END;
    IF NOT caught THEN RAISE EXCEPTION 'Status change allowed for %',actor.role; END IF;
  END LOOP;
  SELECT * INTO actor FROM feedback_actors WHERE role='superadmin';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_id,'role','authenticated')::text,true);
  IF NOT EXISTS(SELECT 1 FROM public.work_feedback WHERE id=response_id) OR NOT EXISTS(SELECT 1 FROM public.list_work_feedback() WHERE id=response_id) THEN RAISE EXCEPTION 'Superadmin missing feedback'; END IF;
  IF (SELECT count(*) FROM public.work_feedback WHERE id=response_id) <> 1 THEN RAISE EXCEPTION 'Retry deduplication failed'; END IF;
  PERFORM public.advance_work_feedback(response_id,'new');
  caught := false;
  BEGIN PERFORM public.advance_work_feedback(response_id,'new'); EXCEPTION WHEN raise_exception THEN caught := true; END;
  IF NOT caught THEN RAISE EXCEPTION 'Stale update allowed'; END IF;
  PERFORM public.advance_work_feedback(response_id,'acknowledged');
  IF NOT EXISTS(SELECT 1 FROM public.work_feedback WHERE id=response_id AND status='followed_up') THEN RAISE EXCEPTION 'Status did not advance'; END IF;
END $$;
RESET ROLE;
-- Previous-week skips do not suppress a new week; anytime feedback suppresses it.
INSERT INTO public.work_feedback_prompts(employee_id,week_start)
SELECT employee_id,date_trunc('week',now() AT TIME ZONE 'Asia/Kolkata')::date-7 FROM feedback_actors WHERE role='manager';
SET LOCAL ROLE authenticated;
DO $$ DECLARE actor record; BEGIN
  SELECT * INTO actor FROM feedback_actors WHERE role='manager';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_id,'role','authenticated')::text,true);
  IF NOT public.claim_work_feedback_prompt() THEN RAISE EXCEPTION 'Previous week suppressed current week'; END IF;
  SELECT * INTO actor FROM feedback_actors WHERE role='admin';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_id,'role','authenticated')::text,true);
  PERFORM public.submit_work_feedback(gen_random_uuid(),4);
  IF public.claim_work_feedback_prompt() THEN RAISE EXCEPTION 'Anytime submission did not suppress prompt'; END IF;
  IF has_function_privilege('anon','public.list_work_feedback(text,integer)','EXECUTE')
    OR has_function_privilege('anon','public.submit_work_feedback(uuid,integer,text,boolean,text,uuid)','EXECUTE')
    OR has_table_privilege('anon','public.work_feedback','SELECT') THEN RAISE EXCEPTION 'Anonymous grants'; END IF;
END $$;
RESET ROLE;
-- Archived and password-gated employees lose all feedback access.
UPDATE public.employees SET status='Released' WHERE id=(SELECT employee_id FROM feedback_actors WHERE role='employee');
SET LOCAL ROLE authenticated;
DO $$ DECLARE actor record; caught boolean; BEGIN
  SELECT * INTO actor FROM feedback_actors WHERE role='employee';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_id,'role','authenticated')::text,true);
  IF EXISTS(SELECT 1 FROM public.work_feedback) THEN RAISE EXCEPTION 'Archived access'; END IF;
  caught:=false;
  BEGIN PERFORM public.submit_work_feedback(gen_random_uuid(),3); EXCEPTION WHEN raise_exception THEN caught:=true; END;
  IF NOT caught THEN RAISE EXCEPTION 'Archived submission'; END IF;
END $$;
RESET ROLE;
UPDATE public.employees SET status='Active',must_change_password=true WHERE id=(SELECT employee_id FROM feedback_actors WHERE role='employee');
SET LOCAL ROLE authenticated;
DO $$ DECLARE caught boolean:=false; BEGIN
  IF EXISTS(SELECT 1 FROM public.work_feedback) THEN RAISE EXCEPTION 'Password-gated read'; END IF;
  BEGIN PERFORM public.list_work_feedback(); EXCEPTION WHEN raise_exception THEN caught:=true; END;
  IF NOT caught THEN RAISE EXCEPTION 'Password-gated RPC'; END IF;
  PERFORM set_config('request.jwt.claims','{}',true);
  IF EXISTS(SELECT 1 FROM public.work_feedback) THEN RAISE EXCEPTION 'No-session read'; END IF;
END $$;
RESET ROLE;
SELECT 'Feedback isolation, ratings, retries, prompt cadence and status transitions passed' AS verification;
ROLLBACK;
