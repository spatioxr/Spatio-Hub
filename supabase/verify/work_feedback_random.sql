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

DO $$ DECLARE actor uuid; due timestamp; again timestamp; n integer; dates timestamp[]:=ARRAY[]::timestamp[]; BEGIN
 FOR n IN 1..100 LOOP
  actor:=md5(n::text)::uuid;
  due:=public.feedback_person_due(actor,'2026-09-14','weekly',0,'random',600);
  again:=public.feedback_person_due(actor,'2026-09-20','weekly',0,'random',600);
  IF due<>again OR due::date NOT BETWEEN date '2026-09-14' AND date '2026-09-18' OR due::time<time '10:00' OR due::time>=time '17:00' THEN RAISE EXCEPTION 'Random weekly schedule invalid or rerolled'; END IF;
  dates:=array_append(dates,due);
  due:=public.feedback_person_due(actor,'2026-09-17','monthly',0,'random',600);
  IF date_trunc('month',due)<>timestamp '2026-09-01' OR extract(isodow FROM due)>5 THEN RAISE EXCEPTION 'Random monthly schedule invalid'; END IF;
  due:=public.feedback_person_due(actor,'2026-09-17','fortnightly',0,'random',600);
  IF due::date NOT BETWEEN date '2026-09-14' AND date '2026-09-25' OR extract(isodow FROM due)>5 THEN RAISE EXCEPTION 'Random fortnightly schedule invalid'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT d) FROM unnest(dates) d)<10 THEN RAISE EXCEPTION 'Random schedule not distributed'; END IF;
 IF public.feedback_person_due(actor,'2026-09-17','weekly',5,'fixed',870)<>timestamp '2026-09-18 14:30' THEN RAISE EXCEPTION 'Fixed time incorrect'; END IF;
END $$;
UPDATE public.work_feedback_settings SET weekday=extract(isodow FROM now() AT TIME ZONE 'Asia/Kolkata'),time_mode='fixed',time_minutes=0,sound_enabled=false;
SET LOCAL ROLE authenticated;
DO $$ DECLARE actor record; result jsonb; denied boolean; BEGIN
 SELECT * INTO actor FROM feedback_actors WHERE role='employee';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_id,'role','authenticated')::text,true);
 IF public.claim_work_feedback_prompt() THEN RAISE EXCEPTION 'Legacy End Day offered timed prompt'; END IF;
 result:=public.claim_scheduled_work_feedback(false);
 IF result IS NULL OR (result->>'sound')::boolean OR (result->>'after_end_day')::boolean THEN RAISE EXCEPTION 'Timed claim or sound setting incorrect'; END IF;
 IF public.claim_scheduled_work_feedback(false) IS NOT NULL OR public.claim_scheduled_work_feedback(true) IS NOT NULL THEN RAISE EXCEPTION 'Repeat scheduled prompt'; END IF;
 FOR actor IN SELECT * FROM feedback_actors WHERE role<>'superadmin' LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_id,'role','authenticated')::text,true);
  denied:=false; BEGIN PERFORM public.save_work_feedback_schedule(true,'weekly',0,'random',600,true); EXCEPTION WHEN raise_exception THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Non-superadmin changed random schedule'; END IF;
 END LOOP;
 SELECT * INTO actor FROM feedback_actors WHERE role='superadmin';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_id,'role','authenticated')::text,true);
 result:=public.save_work_feedback_schedule(true,'monthly',0,'random',600,true);
 IF result->>'time_mode'<>'random' OR (result->>'weekday')::integer<>0 OR NOT (result->>'sound_enabled')::boolean THEN RAISE EXCEPTION 'Random settings not persisted'; END IF;
 denied:=false; BEGIN PERFORM public.save_work_feedback_schedule(true,'weekly',0,'fixed',1440,true); EXCEPTION WHEN raise_exception THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Invalid time accepted'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.claim_scheduled_work_feedback(boolean)','EXECUTE') OR has_function_privilege('anon','public.save_work_feedback_schedule(boolean,text,integer,text,integer,boolean)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous access'; END IF;
END $$;
SELECT 'Random schedule windows, stable distribution, timed claims, sound and role checks passed' AS result;
ROLLBACK;
