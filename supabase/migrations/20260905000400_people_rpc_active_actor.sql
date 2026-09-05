-- HRMS-038/044: CI exposed a NULL-role bypass in both People RPC versions.
-- Preserve each deployed signature and body, tightening only its actor guard.
BEGIN;

DO $$
DECLARE
  signature TEXT;
  definition TEXT;
  old_guard CONSTANT TEXT := 'IF actor_role NOT IN (''admin'', ''superadmin'') THEN';
  new_guard CONSTANT TEXT := 'IF actor_role IS NULL OR actor_role NOT IN (''admin'', ''superadmin'') THEN';
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.create_employee_profile(text,text,text,text,text,text,uuid,date,text)',
    'public.create_employee_profile(text,text,text,text,text,text,uuid,date,text,text)',
    'public.update_employee_profile(uuid,text,text,text,text,text,text,uuid,date,text)',
    'public.update_employee_profile(uuid,text,text,text,text,text,text,uuid,date,text,text)'
  ] LOOP
    SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
    IF position(old_guard IN definition) = 0 THEN
      RAISE EXCEPTION 'Expected People actor guard missing in %', signature;
    END IF;
    IF signature = 'public.create_employee_profile(text,text,text,text,text,text,uuid,date,text,text)' THEN
      -- The phone-aware overload's defaults made legacy 8/9-argument calls
      -- ambiguous even with exact types. The legacy overload owns defaults.
      IF position('employee_phone_number text DEFAULT NULL::text' IN definition) = 0 THEN
        RAISE EXCEPTION 'Expected phone parameter default missing';
      END IF;
      definition := replace(definition,
        'employment_status text DEFAULT ''Active''::text', 'employment_status text');
      definition := replace(definition,
        'employee_phone_number text DEFAULT NULL::text', 'employee_phone_number text');
    END IF;
    EXECUTE replace(definition, old_guard, new_guard);
  END LOOP;
END;
$$;

COMMIT;
