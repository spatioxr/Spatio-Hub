BEGIN;
CREATE TEMP TABLE role_edit_fixture(kind TEXT PRIMARY KEY, id UUID, auth_id UUID);
INSERT INTO role_edit_fixture VALUES ('superadmin',gen_random_uuid(),gen_random_uuid()),
 ('admin',gen_random_uuid(),gen_random_uuid()),('employee',gen_random_uuid(),gen_random_uuid());
INSERT INTO auth.users(id,email) SELECT auth_id,'role-editor-'||kind||'@example.invalid' FROM role_edit_fixture;
INSERT INTO public.employees(id,auth_id,emp_code,name,email,role,status)
SELECT id,auth_id,'ROLE-'||kind,'Role editor '||kind,'role-editor-'||kind||'@example.invalid',kind,'Active' FROM role_edit_fixture;
INSERT INTO public.leave_balances(employee_id,sick_leave,casual_leave,comp_off)
SELECT id,12,12,0 FROM role_edit_fixture;
GRANT SELECT ON role_edit_fixture TO authenticated;
CREATE TEMP TABLE edited_observer(id UUID);
GRANT ALL ON edited_observer TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',auth_id,'role','authenticated')::text,true)
 FROM role_edit_fixture WHERE kind='superadmin';
DO $$
DECLARE saved JSONB; actor UUID := (SELECT id FROM role_edit_fixture WHERE kind='employee');
  entry public.work_entries; snapshot JSONB; denied BOOLEAN := false;
BEGIN
  entry := public.create_manual_time_entry(actor,NULL,(SELECT id FROM public.activities WHERE archived_at IS NULL LIMIT 1),
    'Before Observer','2026-09-14 09:00+05:30','2026-09-14 10:00+05:30','[]'::jsonb,'Role test','office');
  saved := public.save_observer_role_profile(jsonb_build_object('name','Investor','email','role-editor-employee@example.invalid',
    'role','observer','status','Active','designation','Board member'),actor,'staff');
  INSERT INTO edited_observer VALUES ((saved->>'id')::uuid);
  IF saved->>'role' <> 'observer' OR saved->>'auth_id' <> (SELECT auth_id::text FROM role_edit_fixture WHERE kind='employee') THEN
    RAISE EXCEPTION 'Observer conversion lost login'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id=actor AND status='Released' AND auth_id IS NULL AND observer_account_id=(saved->>'id')::uuid) THEN
    RAISE EXCEPTION 'Staff history was not retired safely'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_entries WHERE id=entry.id AND employee_id=actor) THEN RAISE EXCEPTION 'Work history lost'; END IF;
  IF (SELECT count(*) FROM public.user_access_profiles() p WHERE p->>'email'='role-editor-employee@example.invalid')<>1 THEN
    RAISE EXCEPTION 'Unified list duplicated the user'; END IF;
  BEGIN
    PERFORM public.update_employee_profile(actor,'ROLE-employee','Bypass','role-editor-employee@example.invalid',NULL,NULL,'admin',NULL,NULL,'Active');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IN ('Change the Observer role through Users & Access','This identity already belongs to an external account') THEN denied:=true; ELSE RAISE; END IF;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Legacy staff editor reactivated Observer history'; END IF;
END;
$$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',auth_id,'role','authenticated')::text,true)
 FROM role_edit_fixture WHERE kind='employee';
DO $$ BEGIN
  IF public.current_employee_id() IS NOT NULL THEN RAISE EXCEPTION 'Converted Observer still has staff permissions'; END IF;
  PERFORM public.observer_hub_snapshot('2026-09-14','2026-09-14');
  BEGIN PERFORM public.user_access_profiles(); RAISE EXCEPTION 'Observer can read account administration';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'User administration access is required' THEN RAISE; END IF; END;
END; $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',auth_id,'role','authenticated')::text,true)
 FROM role_edit_fixture WHERE kind='superadmin';
DO $$
DECLARE saved JSONB; fresh JSONB; denied BOOLEAN:=false;
BEGIN
  saved := public.save_observer_role_profile(jsonb_build_object('name','Restored','emp_code','ROLE-employee',
    'email','role-editor-employee@example.invalid','role','employee','status','Active'),(SELECT id FROM edited_observer),'external');
  IF saved->>'id' <> (SELECT id::text FROM role_edit_fixture WHERE kind='employee')
    OR saved->>'auth_id' <> (SELECT auth_id::text FROM role_edit_fixture WHERE kind='employee') THEN RAISE EXCEPTION 'Restoration lost identity'; END IF;
  IF EXISTS (SELECT 1 FROM public.external_accounts WHERE id=(SELECT id FROM edited_observer)) THEN RAISE EXCEPTION 'Duplicate external login remains'; END IF;
  fresh := public.save_observer_role_profile('{"name":"New board member","email":"new-role-board@example.invalid","role":"observer","status":"Active"}');
  IF fresh->>'role' <> 'observer' THEN RAISE EXCEPTION 'New Observer creation failed'; END IF;
  saved := public.save_observer_role_profile('{"emp_code":"NEWSTAFF","name":"New staff","email":"new-role-board@example.invalid","role":"manager","status":"Active"}',(fresh->>'id')::uuid,'external');
  IF saved->>'role' <> 'manager' THEN RAISE EXCEPTION 'New Observer could not become staff'; END IF;
  BEGIN
    PERFORM public.save_observer_role_profile('{"name":"Self","email":"role-editor-superadmin@example.invalid","role":"observer","status":"Active"}',
      (SELECT id FROM role_edit_fixture WHERE kind='superadmin'),'staff');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='You cannot change your own account to Observer' THEN denied:=true; ELSE RAISE; END IF;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Self-conversion allowed'; END IF;
END; $$;
DO $$
DECLARE entry public.work_entries; target UUID := (SELECT id FROM role_edit_fixture WHERE kind='employee'); denied BOOLEAN := false;
BEGIN
  entry := public.admin_start_work_day(target,NULL,(SELECT id FROM public.activities WHERE archived_at IS NULL LIMIT 1),'Role test plan','office');
  BEGIN PERFORM public.save_observer_role_profile('{"name":"Investor","email":"role-editor-employee@example.invalid","role":"observer","status":"Active"}',target,'staff');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='End the running work session before changing this user to Observer' THEN denied:=true; ELSE RAISE; END IF;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Running session conversion allowed'; END IF;
  PERFORM public.admin_end_work_day(target,entry.id,'Role test finished');
END; $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',auth_id,'role','authenticated')::text,true)
 FROM role_edit_fixture WHERE kind='employee';
SELECT public.submit_leave_request('Sick Leave','2026-09-21','2026-09-21',false,'Fixture private reason');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',auth_id,'role','authenticated')::text,true)
 FROM role_edit_fixture WHERE kind='superadmin';
DO $$
DECLARE denied BOOLEAN := false; manager_id UUID; project public.projects;
BEGIN
  BEGIN PERFORM public.save_observer_role_profile('{"name":"Investor","email":"role-editor-employee@example.invalid","role":"observer","status":"Active"}',
    (SELECT id FROM role_edit_fixture WHERE kind='employee'),'staff');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Resolve pending leave before changing this user to Observer' THEN denied:=true; ELSE RAISE; END IF;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Pending leave conversion allowed'; END IF;
  SELECT id INTO manager_id FROM public.employees WHERE email='new-role-board@example.invalid';
  project := public.create_project_with_manager('OBSERVER-OWNER','Observer ownership fixture',NULL,manager_id);
  denied:=false;
  BEGIN PERFORM public.save_observer_role_profile('{"name":"Investor","email":"new-role-board@example.invalid","role":"observer","status":"Active"}',manager_id,'staff');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Employee role/status change would leave an active project without a manager' THEN denied:=true; ELSE RAISE; END IF;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Final project manager conversion allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id=manager_id AND status='Active') THEN RAISE EXCEPTION 'Failed conversion changed staff status'; END IF;
END; $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',auth_id,'role','authenticated')::text,true)
 FROM role_edit_fixture WHERE kind='admin';
DO $$ BEGIN
  PERFORM public.user_access_profiles();
  BEGIN PERFORM public.save_observer_role_profile('{"role":"observer"}'); RAISE EXCEPTION 'Admin can assign Observer';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Only a Superadmin can assign or change Observer access' THEN RAISE; END IF; END;
END; $$;
RESET ROLE;
SELECT true AS all_checks_pass,jsonb_build_object('unified_user_list',true,'role_round_trip_preserves_auth_and_history',true,
 'legacy_reactivation_denied',true,'observer_creation_and_staff_conversion',true,'superadmin_only',true) AS checks;
ROLLBACK;
