-- Workload review belongs to Admin/Superadmin; managers retain read-only flags.
BEGIN;
DO $$
DECLARE definition TEXT;
BEGIN
  SELECT pg_get_functiondef('public.workload_person_days(uuid,date)'::regprocedure) INTO definition;
  IF position('AND target_employee <> public.current_employee_id()) AS can_review' IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected workload review predicate missing';
  END IF;
  definition := replace(definition,
    'public.has_organisation_access() OR (public.current_employee_role() = ''manager'' AND f.all_visible AND public.can_access_employee(target_employee)
    AND target_employee <> public.current_employee_id()) AS can_review',
    'public.has_organisation_access() AS can_review');
  EXECUTE definition;
  SELECT pg_get_functiondef('public.confirm_workload_day(uuid,date,text,text)'::regprocedure) INTO definition;
  definition := replace(definition,
    'IF public.current_employee_role() IS NULL OR public.current_employee_role() NOT IN (''manager'',''admin'',''superadmin'') THEN RAISE EXCEPTION ''Management access is required''; END IF;',
    'IF NOT public.has_organisation_access() THEN RAISE EXCEPTION ''Only Admins can resolve workload reviews''; END IF;');
  EXECUTE definition;
END;
$$;
COMMIT;
