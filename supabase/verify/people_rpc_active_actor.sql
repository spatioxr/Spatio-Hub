-- Both legacy and phone-aware RPCs must deny identities without an active role.
BEGIN;

CREATE TEMP TABLE people_denied_actors AS
WITH auth_rows AS (
  INSERT INTO auth.users (id, email)
  SELECT gen_random_uuid(), email
  FROM (VALUES ('people-archived@example.invalid'),
               ('people-password@example.invalid'),
               ('people-unlinked@example.invalid')) seed(email)
  RETURNING id, email
)
SELECT * FROM auth_rows;

INSERT INTO public.employees
  (auth_id, emp_code, name, email, role, status, must_change_password)
SELECT id, CASE WHEN email LIKE '%archived%' THEN 'RPCARCH' ELSE 'RPCPASS' END,
  'People RPC denied actor', email, 'admin',
  CASE WHEN email LIKE '%archived%' THEN 'Released' ELSE 'Active' END,
  email LIKE '%password%'
FROM people_denied_actors WHERE email NOT LIKE '%unlinked%';

CREATE TEMP TABLE people_rpc_target AS
SELECT id FROM public.employees WHERE status = 'Active' AND role = 'superadmin' LIMIT 1;
GRANT SELECT ON people_denied_actors, people_rpc_target TO authenticated;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  actor RECORD;
  phone_aware BOOLEAN;
  action TEXT;
  statement TEXT;
  target_id UUID := (SELECT id FROM people_rpc_target);
  denied BOOLEAN;
  checked INTEGER := 0;
BEGIN
  IF target_id IS NULL THEN RAISE EXCEPTION 'Missing active target fixture'; END IF;
  FOR actor IN SELECT * FROM people_denied_actors LOOP
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', actor.id::text, 'role', 'authenticated')::text, true);
    FOREACH phone_aware IN ARRAY ARRAY[false, true] LOOP
      FOREACH action IN ARRAY ARRAY['create', 'update'] LOOP
        statement := 'SELECT public.' || action || '_employee_profile(';
        IF action = 'update' THEN
          statement := statement || quote_literal(target_id) || '::uuid,';
        END IF;
        statement := statement ||
          '''RPCDENIED''::text,''Denied''::text,''rpc-denied@example.invalid''::text,' ||
          '''Verification''::text,''Verification''::text,''employee''::text,' ||
          'NULL::uuid,NULL::date,''Active''::text';
        IF phone_aware THEN statement := statement || ',NULL::text'; END IF;
        statement := statement || ')';
        denied := false;
        BEGIN
          EXECUTE statement;
        EXCEPTION WHEN raise_exception THEN
          -- Reject accidental passes caused by unrelated SQL/fixture errors.
          IF SQLERRM = 'Only an admin or superadmin can ' ||
              CASE WHEN action = 'create' THEN 'add' ELSE 'edit' END || ' people'
          THEN denied := true;
          ELSE RAISE;
          END IF;
        END;
        IF NOT denied THEN
          RAISE EXCEPTION 'People % allowed denied actor %, phone-aware %',
            action, actor.email, phone_aware;
        END IF;
        checked := checked + 1;
      END LOOP;
    END LOOP;
  END LOOP;
  IF checked <> 12 THEN RAISE EXCEPTION 'Expected 12 actor/overload checks'; END IF;
END;
$$;
RESET ROLE;
SELECT true AS all_checks_pass,
  jsonb_build_object('all_people_overloads_deny_inactive_password_and_unlinked_actors', true) AS checks;
ROLLBACK;
