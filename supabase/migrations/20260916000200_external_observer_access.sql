-- User-approved extension of HRMS-004/005/045: non-staff, read-only hub access.
BEGIN;

CREATE TABLE public.external_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  email TEXT UNIQUE NOT NULL CHECK (email = lower(btrim(email)) AND email LIKE '%@%'),
  designation TEXT NOT NULL DEFAULT '' CHECK (length(designation) <= 120),
  account_type TEXT NOT NULL DEFAULT 'external' CHECK (account_type = 'external'),
  role TEXT NOT NULL DEFAULT 'observer' CHECK (role = 'observer'),
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Released')),
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  temporary_password_issued_at TIMESTAMPTZ,
  temporary_password_issued_by UUID REFERENCES public.employees(id),
  created_by UUID NOT NULL REFERENCES public.employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.external_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.external_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.external_accounts TO authenticated;
GRANT ALL ON public.external_accounts TO service_role;

CREATE FUNCTION public.is_external_identity()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.external_accounts WHERE auth_id = auth.uid()); $$;
REVOKE ALL ON FUNCTION public.is_external_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_external_identity() TO authenticated;

CREATE POLICY external_accounts_read ON public.external_accounts
FOR SELECT TO authenticated USING (auth_id = auth.uid() OR coalesce(public.is_superadmin(), false));

-- One Auth identity/email cannot become both staff and an external stakeholder.
CREATE FUNCTION public.guard_account_identity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(lower(NEW.email), 160002));
  IF NEW.auth_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.auth_id::text, 160002));
  END IF;
  IF TG_TABLE_NAME = 'external_accounts' THEN
    IF EXISTS (SELECT 1 FROM public.employees e WHERE lower(e.email) = lower(NEW.email)
      OR (NEW.auth_id IS NOT NULL AND e.auth_id = NEW.auth_id)) THEN
      RAISE EXCEPTION 'This identity already belongs to a staff account';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.external_accounts e WHERE e.email = lower(NEW.email)
      OR (NEW.auth_id IS NOT NULL AND e.auth_id = NEW.auth_id)) THEN
      RAISE EXCEPTION 'This identity already belongs to an external account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_identity_guard BEFORE INSERT OR UPDATE OF email, auth_id ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.guard_account_identity();
CREATE TRIGGER account_identity_guard BEFORE INSERT OR UPDATE OF email, auth_id ON public.external_accounts
FOR EACH ROW EXECUTE FUNCTION public.guard_account_identity();

CREATE FUNCTION public.save_external_account(
  account_name TEXT, account_email TEXT, account_designation TEXT DEFAULT '',
  target_account_id UUID DEFAULT NULL, account_status TEXT DEFAULT 'Active'
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE saved_id UUID;
BEGIN
  IF public.is_superadmin() IS NOT TRUE THEN
    RAISE EXCEPTION 'Only an active Superadmin can manage external access';
  END IF;
  IF account_status IS NULL OR account_status NOT IN ('Active', 'Released') THEN
    RAISE EXCEPTION 'Choose an active or revoked account status';
  END IF;
  IF target_account_id IS NULL THEN
    INSERT INTO public.external_accounts(name, email, designation, status, created_by)
    VALUES (btrim(account_name), lower(btrim(account_email)), btrim(coalesce(account_designation, '')),
      account_status, public.current_employee_id()) RETURNING id INTO saved_id;
  ELSE
    -- Login emails stay fixed once provisioned; changing Auth requires a separate verified workflow.
    UPDATE public.external_accounts SET name = btrim(account_name),
      email = lower(btrim(account_email)), designation = btrim(coalesce(account_designation, '')),
      status = account_status, updated_at = now()
    WHERE id = target_account_id AND (auth_id IS NULL OR email = lower(btrim(account_email)))
    RETURNING id INTO saved_id;
    IF saved_id IS NULL THEN RAISE EXCEPTION 'Account not found or its login email cannot be changed'; END IF;
  END IF;
  RETURN saved_id;
END;
$$;

-- Defense in depth: restrictive RLS denies raw staff tables, and triggers also
-- deny writes reached through SECURITY DEFINER RPCs. Revoked/password-gated
-- external identities remain subject to this boundary.
CREATE FUNCTION public.prevent_external_data_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.is_external_identity() THEN
    RAISE EXCEPTION 'Observer accounts have read-only access' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DO $$
DECLARE relation RECORD;
BEGIN
  FOR relation IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    IF relation.tablename <> 'external_accounts' THEN
      EXECUTE format('CREATE POLICY external_identity_boundary ON public.%I AS RESTRICTIVE '
        || 'FOR ALL TO authenticated USING (NOT public.is_external_identity()) '
        || 'WITH CHECK (NOT public.is_external_identity())', relation.tablename);
    END IF;
    EXECUTE format('CREATE TRIGGER external_write_gate BEFORE INSERT OR UPDATE OR DELETE '
      || 'ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_external_data_write()', relation.tablename);
  END LOOP;
END;
$$;
CREATE POLICY external_identity_boundary ON storage.objects AS RESTRICTIVE
FOR ALL TO authenticated USING (NOT public.is_external_identity()) WITH CHECK (NOT public.is_external_identity());

-- Deliberately narrow projection: no contacts, leave reasons/types/balances,
-- private employee records, credentials, BOS/EOD text or administrative settings.
CREATE FUNCTION public.observer_hub_snapshot(start_date DATE, end_date DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE result JSONB; range_start TIMESTAMPTZ; range_end TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.external_accounts a WHERE a.auth_id = auth.uid()
    AND a.status = 'Active' AND NOT a.must_change_password) THEN
    RAISE EXCEPTION 'An active Observer session is required' USING ERRCODE = '42501';
  END IF;
  IF start_date IS NULL OR end_date IS NULL OR end_date < start_date OR end_date - start_date > 30 THEN
    RAISE EXCEPTION 'Choose a range of 31 days or fewer';
  END IF;
  range_start := public.app_day_start(start_date);
  range_end := public.app_day_start(end_date + 1);

  WITH people AS (
    SELECT e.id, e.name, e.department, e.designation,
      CASE WHEN live.id IS NULL THEN 'Out'
        WHEN EXISTS (SELECT 1 FROM public.break_entries b WHERE b.work_entry_id = live.id AND b.ended_at IS NULL)
          THEN 'Break' ELSE 'In' END AS work_status,
      coalesce(live.started_at < statement_timestamp() - interval '24 hours', false) AS stale
    FROM public.employees e
    LEFT JOIN LATERAL (SELECT w.id, w.started_at FROM public.work_entries w
      WHERE w.employee_id = e.id AND w.ended_at IS NULL AND w.voided_at IS NULL
      ORDER BY w.started_at DESC LIMIT 1) live ON true
    WHERE e.status = 'Active'
  ), entries AS (
    SELECT w.id, w.employee_id, e.name AS employee_name, e.department,
      w.project_id, coalesce(p.name, a.name) AS context_name,
      CASE WHEN w.project_id IS NULL THEN 'activity' ELSE 'project' END AS context_type,
      w.started_at, w.ended_at,
      w.ended_at IS NULL AND w.started_at < statement_timestamp() - interval '24 hours' AS stale,
      CASE WHEN w.ended_at IS NULL AND w.started_at < statement_timestamp() - interval '24 hours' THEN NULL
        ELSE greatest(0, extract(epoch FROM least(coalesce(w.ended_at, statement_timestamp()), range_end)
          - greatest(w.started_at, range_start)) - coalesce((
            SELECT sum(greatest(0, extract(epoch FROM
              least(coalesce(b.ended_at, statement_timestamp()), coalesce(w.ended_at, statement_timestamp()), range_end)
              - greatest(b.started_at, w.started_at, range_start))))
            FROM public.break_entries b WHERE b.work_entry_id = w.id
          ), 0)) END AS worked_seconds
    FROM public.work_entries w JOIN public.employees e ON e.id = w.employee_id
    LEFT JOIN public.projects p ON p.id = w.project_id
    LEFT JOIN public.activities a ON a.id = w.activity_id
    WHERE w.voided_at IS NULL AND w.started_at < range_end
      AND coalesce(w.ended_at, statement_timestamp()) > range_start
  ), projects AS (
    SELECT p.id, p.code, p.name, p.description, p.archived_at,
      (SELECT count(*) FROM public.project_members m JOIN public.employees e ON e.id = m.employee_id
        WHERE m.project_id = p.id AND e.status = 'Active') AS member_count
    FROM public.projects p
  ), attendance AS (
    SELECT e.id AS employee_id, e.name AS employee_name, day::date AS date,
      a.check_in, a.check_out, a.status,
      EXISTS (SELECT 1 FROM public.leaves l WHERE l.employee_id = e.id AND l.status = 'Approved'
        AND day::date BETWEEN l.from_date AND l.to_date
        AND extract(isodow FROM day) BETWEEN 1 AND 5
        AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.date = day::date)) AS approved_leave
    FROM public.employees e CROSS JOIN generate_series(start_date::timestamp, end_date::timestamp, interval '1 day') day
    LEFT JOIN public.attendance a ON a.employee_id = e.id AND a.date = day::date
    WHERE e.status = 'Active' OR a.id IS NOT NULL
  )
  SELECT jsonb_build_object(
    'updated_at', statement_timestamp(),
    'people', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.name, p.id) FROM people p), '[]'::jsonb),
    'projects', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.name, p.id) FROM projects p), '[]'::jsonb),
    'entries', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.started_at DESC, e.id) FROM entries e), '[]'::jsonb),
    'attendance', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.date DESC, a.employee_name, a.employee_id)
      FROM attendance a), '[]'::jsonb),
    'holidays', coalesce((SELECT jsonb_agg(jsonb_build_object('date', h.date, 'name', h.name) ORDER BY h.date)
      FROM public.holidays h WHERE h.date BETWEEN start_date AND end_date), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_account_identity(), public.prevent_external_data_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_external_account(TEXT,TEXT,TEXT,UUID,TEXT),
  public.observer_hub_snapshot(DATE,DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_external_account(TEXT,TEXT,TEXT,UUID,TEXT),
  public.observer_hub_snapshot(DATE,DATE) TO authenticated;
COMMIT;
