-- Observer is selected in Users & Access; separate storage keeps staff obligations scoped.
BEGIN;
ALTER TABLE public.external_accounts ADD COLUMN staff_profile_id UUID UNIQUE REFERENCES public.employees(id);
ALTER TABLE public.employees ADD COLUMN observer_account_id UUID UNIQUE
  REFERENCES public.external_accounts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.guard_account_identity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(lower(NEW.email), 160002));
  IF NEW.auth_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.auth_id::text, 160002));
  END IF;
  IF TG_TABLE_NAME = 'external_accounts' THEN
    IF EXISTS (SELECT 1 FROM public.employees e
      WHERE (lower(e.email) = lower(NEW.email) OR (NEW.auth_id IS NOT NULL AND e.auth_id = NEW.auth_id))
        AND NOT (e.id = coalesce(NEW.staff_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
          AND e.auth_id IS NULL AND e.status = 'Released')) THEN
      RAISE EXCEPTION 'This identity already belongs to a staff account';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.external_accounts e
      WHERE (e.email = lower(NEW.email) OR (NEW.auth_id IS NOT NULL AND e.auth_id = NEW.auth_id))
        AND NOT (e.staff_profile_id IS NOT DISTINCT FROM NEW.id AND NEW.auth_id IS NULL AND NEW.status = 'Released')) THEN
      RAISE EXCEPTION 'This identity already belongs to an external account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Historical staff rows cannot be reactivated by the old staff editor while an Observer owns the login.
CREATE FUNCTION public.guard_observer_staff_history() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.observer_account_id IS NOT NULL AND
    (NEW.status <> 'Released' OR NEW.auth_id IS NOT NULL OR NEW.is_leave_admin OR NEW.is_downtime_manager) THEN
    RAISE EXCEPTION 'Change the Observer role through Users & Access';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER observer_staff_history_guard BEFORE INSERT OR UPDATE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.guard_observer_staff_history();
REVOKE ALL ON FUNCTION public.guard_observer_staff_history() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.user_access_profiles() RETURNS SETOF JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_manage_people() THEN RAISE EXCEPTION 'User administration access is required'; END IF;
  RETURN QUERY
  SELECT profile FROM (
    SELECT to_jsonb(e) - 'avatar_url' - 'avatar_path' || jsonb_build_object('account_type','staff') AS profile
    FROM public.employees e WHERE e.observer_account_id IS NULL
    UNION ALL
    SELECT coalesce(to_jsonb(e) - 'avatar_url' - 'avatar_path', '{}'::jsonb) || to_jsonb(a)
      || jsonb_build_object('is_leave_admin',false,'is_downtime_manager',false)
    FROM public.external_accounts a LEFT JOIN public.employees e ON e.id = a.staff_profile_id
  ) accounts ORDER BY profile->>'name', profile->>'id';
END;
$$;

CREATE FUNCTION public.save_observer_role_profile(profile JSONB, target_id UUID DEFAULT NULL,
  source_account_type TEXT DEFAULT 'staff') RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  staff public.employees; observer public.external_accounts; saved public.employees;
  observer_id UUID; requested_role TEXT := profile->>'role';
  requested_status TEXT := profile->>'status';
  requested_email TEXT := lower(btrim(profile->>'email'));
BEGIN
  IF public.is_superadmin() IS NOT TRUE THEN RAISE EXCEPTION 'Only a Superadmin can assign or change Observer access'; END IF;
  IF source_account_type IS NULL OR source_account_type NOT IN ('staff','external') THEN RAISE EXCEPTION 'Invalid account type'; END IF;
  IF requested_role IS NULL OR requested_role NOT IN ('employee','manager','admin','superadmin','observer') THEN RAISE EXCEPTION 'Invalid application role'; END IF;
  IF requested_status IS NULL OR requested_status NOT IN ('Active','On Leave','On Notice','Released') THEN RAISE EXCEPTION 'Invalid account status'; END IF;
  IF requested_email IS NULL OR requested_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Enter a valid email'; END IF;
  IF target_id IS NOT NULL AND source_account_type = 'staff' THEN
    SELECT * INTO staff FROM public.employees WHERE id = target_id FOR UPDATE;
    IF staff.id IS NULL OR staff.observer_account_id IS NOT NULL THEN RAISE EXCEPTION 'Staff account changed. Refresh Users & Access'; END IF;
    IF staff.id = public.current_employee_id() THEN RAISE EXCEPTION 'You cannot change your own account to Observer'; END IF;
    IF requested_role <> 'observer' THEN RAISE EXCEPTION 'Use the staff editor for staff role changes'; END IF;
    IF requested_email IS DISTINCT FROM staff.email THEN RAISE EXCEPTION 'Keep the existing login email when changing account type'; END IF;
    IF EXISTS (SELECT 1 FROM public.work_entries WHERE employee_id = staff.id AND ended_at IS NULL AND voided_at IS NULL) THEN
      RAISE EXCEPTION 'End the running work session before changing this user to Observer';
    END IF;
    IF EXISTS (SELECT 1 FROM public.leaves WHERE employee_id = staff.id AND status = 'Pending') THEN
      RAISE EXCEPTION 'Resolve pending leave before changing this user to Observer';
    END IF;
  ELSIF source_account_type = 'external' THEN
    SELECT * INTO observer FROM public.external_accounts WHERE id = target_id FOR UPDATE;
    IF observer.id IS NULL THEN RAISE EXCEPTION 'Observer account changed. Refresh Users & Access'; END IF;
    IF requested_email IS DISTINCT FROM observer.email AND (observer.auth_id IS NOT NULL OR observer.staff_profile_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Keep the existing login email when editing this Observer';
    END IF;
  END IF;

  IF requested_role = 'observer' THEN
    IF requested_status NOT IN ('Active','Released') THEN RAISE EXCEPTION 'Observers can be Active or Archived'; END IF;
    IF staff.id IS NOT NULL THEN
      -- Preserve the staff row and every history FK; move only the portal identity.
      UPDATE public.employees SET status = 'Released', auth_id = NULL,
        is_leave_admin = false, is_downtime_manager = false WHERE id = staff.id;
      INSERT INTO public.external_accounts(name,email,designation,status,auth_id,must_change_password,
        temporary_password_issued_at,temporary_password_issued_by,created_by,staff_profile_id)
      VALUES (btrim(profile->>'name'), requested_email, btrim(coalesce(profile->>'designation','')), requested_status,
        staff.auth_id,staff.must_change_password,staff.temporary_password_issued_at,staff.temporary_password_issued_by,
        public.current_employee_id(),staff.id) RETURNING id INTO observer_id;
      UPDATE public.employees SET observer_account_id = observer_id WHERE id = staff.id;
    ELSE
      observer_id := public.save_external_account(profile->>'name', requested_email, profile->>'designation', observer.id, requested_status);
    END IF;
    SELECT * INTO observer FROM public.external_accounts WHERE id = observer_id;
    RETURN to_jsonb(observer);
  END IF;

  IF observer.id IS NULL THEN RAISE EXCEPTION 'Choose an Observer account to change to staff'; END IF;
  -- Delete only the external identity, never its linked staff history. The whole move is atomic.
  DELETE FROM public.external_accounts WHERE id = observer.id;
  IF observer.staff_profile_id IS NULL THEN
    saved := public.create_employee_profile(profile->>'emp_code',profile->>'name',requested_email,
      profile->>'department',profile->>'designation',requested_role,
      nullif(profile->>'reports_to','')::uuid,nullif(profile->>'date_of_joining','')::date,
      requested_status,profile->>'phone_number');
  ELSE
    saved := public.update_employee_profile(observer.staff_profile_id,profile->>'emp_code',profile->>'name',requested_email,
      profile->>'department',profile->>'designation',requested_role,
      nullif(profile->>'reports_to','')::uuid,nullif(profile->>'date_of_joining','')::date,
      requested_status,profile->>'phone_number');
  END IF;
  UPDATE public.employees SET auth_id = observer.auth_id, must_change_password = observer.must_change_password,
    temporary_password_issued_at = observer.temporary_password_issued_at,
    temporary_password_issued_by = observer.temporary_password_issued_by WHERE id = saved.id RETURNING * INTO saved;
  RETURN to_jsonb(saved) || jsonb_build_object('account_type','staff');
END;
$$;
REVOKE ALL ON FUNCTION public.user_access_profiles(), public.save_observer_role_profile(JSONB,UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_access_profiles(), public.save_observer_role_profile(JSONB,UUID,TEXT) TO authenticated;
COMMIT;
