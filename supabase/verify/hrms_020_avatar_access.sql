-- HRMS-020 avatar permissions. Isolated fixtures, always rolled back.
BEGIN;
CREATE TEMP TABLE avatar_actors AS
WITH seed(code) AS (VALUES ('AVATAROWN'), ('AVATAROTHER')),
identities AS (
  INSERT INTO auth.users (id, email)
  SELECT gen_random_uuid(), lower(code) || '@avatar-check.example.invalid' FROM seed
  RETURNING id, email
), employees AS (
  INSERT INTO public.employees (auth_id, emp_code, name, email, role, status)
  SELECT identities.id, seed.code, seed.code, identities.email, 'employee', 'Active'
  FROM seed JOIN identities ON identities.email = lower(seed.code) || '@avatar-check.example.invalid'
  RETURNING id, auth_id, emp_code
)
SELECT * FROM employees;
ALTER TABLE avatar_actors ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_read ON avatar_actors FOR SELECT TO authenticated USING (true);
GRANT SELECT ON avatar_actors TO authenticated;
INSERT INTO storage.objects (bucket_id, name)
SELECT 'employee-avatars', id::text || '/existing.jpg' FROM avatar_actors;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  actor RECORD;
  other_id UUID;
  denied BOOLEAN;
  changed INTEGER;
BEGIN
  SELECT * INTO actor FROM avatar_actors WHERE emp_code = 'AVATAROWN';
  SELECT id INTO other_id FROM avatar_actors WHERE emp_code = 'AVATAROTHER';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', actor.auth_id, 'role', 'authenticated')::text, true);
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='employee-avatars' AND name IN (actor.id::text || '/existing.jpg', other_id::text || '/existing.jpg')) <> 2 THEN
    RAISE EXCEPTION 'Active employees cannot read permitted avatars';
  END IF;
  INSERT INTO storage.objects (bucket_id, name) VALUES ('employee-avatars', actor.id::text || '/new.jpg');
  UPDATE public.employees SET avatar_path=actor.id::text || '/new.jpg', avatar_url=NULL WHERE id=actor.id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'Own avatar profile update did not persist'; END IF;
  UPDATE storage.objects SET name=actor.id::text || '/renamed.jpg' WHERE bucket_id='employee-avatars' AND name=actor.id::text || '/new.jpg';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'Own avatar update denied'; END IF;

  denied := false;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('employee-avatars', other_id::text || '/forbidden.jpg');
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-employee avatar upload allowed'; END IF;
  UPDATE storage.objects SET name=other_id::text || '/forbidden-rename.jpg' WHERE bucket_id='employee-avatars' AND name=other_id::text || '/existing.jpg';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN RAISE EXCEPTION 'Cross-employee avatar update allowed'; END IF;

  denied := false;
  BEGIN UPDATE public.employees SET avatar_path=other_id::text || '/existing.jpg' WHERE id=actor.id;
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Profile can link another employee folder'; END IF;
  denied := false;
  BEGIN UPDATE public.employees SET avatar_url='data:image/jpeg;base64,AA==' WHERE id=actor.id;
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Profile can reintroduce base64'; END IF;
  denied := false;
  BEGIN UPDATE public.employees SET role='superadmin' WHERE id=actor.id;
  EXCEPTION WHEN OTHERS THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Avatar guard allows role escalation'; END IF;
  IF has_function_privilege('anon','public.live_work_status()','EXECUTE')
    OR has_function_privilege('anon','public.current_reporting_manager()','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous access to live projections';
  END IF;
END $$;
RESET ROLE;
UPDATE public.employees SET status='Released' WHERE emp_code='AVATAROWN';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='employee-avatars') THEN
    RAISE EXCEPTION 'Inactive employee retains avatar read access';
  END IF;
END $$;
RESET ROLE;
SELECT true AS all_checks_pass, jsonb_build_object('avatar_access_boundaries',true) AS checks;
ROLLBACK;
