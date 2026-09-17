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

UPDATE public.employees SET department='Pulse Design' WHERE id IN (SELECT employee_id FROM feedback_actors WHERE role IN ('employee','manager'));
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',(SELECT auth_id FROM feedback_actors WHERE role='superadmin'),'role','authenticated')::text,true);
CREATE TEMP TABLE pulse_test_project AS SELECT gen_random_uuid() AS id;
GRANT SELECT ON pulse_test_project TO authenticated;
INSERT INTO public.projects(id,code,name) SELECT id,'PULSE-AUDIENCE-TEST','Pulse audience test' FROM pulse_test_project;
INSERT INTO public.project_members(project_id,employee_id) SELECT p.id,a.employee_id FROM pulse_test_project p,feedback_actors a WHERE a.role IN ('employee','manager');
INSERT INTO public.project_managers(project_id,employee_id) SELECT p.id,a.employee_id FROM pulse_test_project p,feedback_actors a WHERE a.role='manager';
SET LOCAL ROLE authenticated;
DO $$ DECLARE boss record; person record; outsider record; manager record; result jsonb; pulse uuid; project_key text; denied boolean; BEGIN
 SELECT * INTO boss FROM feedback_actors WHERE role='superadmin';
 SELECT * INTO person FROM feedback_actors WHERE role='employee';
 SELECT * INTO manager FROM feedback_actors WHERE role='manager';
 SELECT * INTO outsider FROM feedback_actors WHERE role='admin';
 SELECT id::text INTO project_key FROM pulse_test_project;
 FOR outsider IN SELECT * FROM feedback_actors WHERE role<>'superadmin' LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider.auth_id,'role','authenticated')::text,true);
  denied:=false; BEGIN PERFORM public.work_feedback_audiences(); EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Audience directory exposed'; END IF;
  denied:=false; BEGIN PERFORM public.launch_work_feedback_pulse('person',person.employee_id::text); EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Targeted launch allowed for non-superadmin'; END IF;
 END LOOP;
 SELECT * INTO outsider FROM feedback_actors WHERE role='admin';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',boss.auth_id,'role','authenticated')::text,true);
 result:=public.launch_work_feedback_pulse('person',person.employee_id::text); pulse:=(result->'pulse'->>'id')::uuid;
 IF (result->'pulse'->>'recipient_count')::integer<>1 THEN RAISE EXCEPTION 'Individual audience incorrect'; END IF;
 IF (public.launch_work_feedback_pulse('person',person.employee_id::text)->'pulse'->>'id')::uuid<>pulse THEN RAISE EXCEPTION 'Retry created duplicate'; END IF;
 denied:=false; BEGIN PERFORM public.launch_work_feedback_pulse('everyone',NULL); EXCEPTION WHEN raise_exception THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Existing targeted pulse widened'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider.auth_id,'role','authenticated')::text,true);
 IF public.claim_work_feedback_pulse() IS NOT NULL THEN RAISE EXCEPTION 'Outsider got targeted pulse'; END IF;
 denied:=false; BEGIN PERFORM public.submit_work_feedback(gen_random_uuid(),3,'',false,'pulse',pulse); EXCEPTION WHEN raise_exception THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Outsider submitted targeted pulse'; END IF;
 denied:=false; BEGIN PERFORM * FROM public.work_feedback_pulse_recipients; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Recipient list exposed'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',person.auth_id,'role','authenticated')::text,true);
 IF public.claim_work_feedback_pulse() IS DISTINCT FROM pulse OR public.claim_work_feedback_pulse() IS NOT NULL THEN RAISE EXCEPTION 'Individual delivery failed'; END IF;
 PERFORM public.submit_work_feedback(gen_random_uuid(),4,'Test targeted pulse',false,'pulse',pulse);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',boss.auth_id,'role','authenticated')::text,true);
 PERFORM public.manage_work_feedback('close');
 result:=public.launch_work_feedback_pulse('department','Pulse Design');
 IF (result->'pulse'->>'recipient_count')::integer<>2 THEN RAISE EXCEPTION 'Department audience incorrect'; END IF;
 PERFORM public.manage_work_feedback('close');
 result:=public.launch_work_feedback_pulse('project',project_key); pulse:=(result->'pulse'->>'id')::uuid;
 IF (result->'pulse'->>'recipient_count')::integer<>2 THEN RAISE EXCEPTION 'Project manager/member deduplication failed'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',manager.auth_id,'role','authenticated')::text,true);
 IF public.claim_work_feedback_pulse() IS DISTINCT FROM pulse THEN RAISE EXCEPTION 'Project manager excluded'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',boss.auth_id,'role','authenticated')::text,true);
 PERFORM public.manage_work_feedback('close');
 denied:=false; BEGIN PERFORM public.launch_work_feedback_pulse('person',boss.employee_id::text); EXCEPTION WHEN raise_exception THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Sender-only pulse allowed'; END IF;
 denied:=false; BEGIN PERFORM public.launch_work_feedback_pulse('project',gen_random_uuid()::text); EXCEPTION WHEN raise_exception THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Missing project accepted'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('authenticated','public.feedback_pulse_audience_members(text,text)','EXECUTE') OR has_function_privilege('anon','public.launch_work_feedback_pulse(text,text)','EXECUTE') OR has_function_privilege('anon','public.work_feedback_audiences()','EXECUTE') THEN RAISE EXCEPTION 'Audience function grants too broad'; END IF;
END $$;
SELECT 'Targeted pulse audience isolation and delivery passed' AS result;
ROLLBACK;
