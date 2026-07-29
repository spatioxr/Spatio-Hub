-- HRMS-019: superadmin BOS/EOD exceptions with immutable audit history.

BEGIN;

CREATE TABLE public.daily_report_settings_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  changed_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  old_bos_required BOOLEAN NOT NULL,
  new_bos_required BOOLEAN NOT NULL,
  old_eod_required BOOLEAN NOT NULL,
  new_eod_required BOOLEAN NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    old_bos_required IS DISTINCT FROM new_bos_required
    OR old_eod_required IS DISTINCT FROM new_eod_required
  )
);

CREATE INDEX daily_report_settings_audit_employee_changed_idx
  ON public.daily_report_settings_audit (employee_id, changed_at DESC);

ALTER TABLE public.daily_report_settings_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.daily_report_settings_audit FROM anon;
GRANT SELECT ON TABLE public.daily_report_settings_audit TO authenticated;

CREATE POLICY daily_report_settings_audit_select_superadmin
  ON public.daily_report_settings_audit FOR SELECT TO authenticated
  USING (public.is_superadmin());

CREATE OR REPLACE FUNCTION public.prevent_daily_report_settings_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Daily-report settings audit history is immutable';
END;
$$;

CREATE TRIGGER daily_report_settings_audit_prevent_mutation
  BEFORE UPDATE OR DELETE ON public.daily_report_settings_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_daily_report_settings_audit_mutation();

CREATE OR REPLACE FUNCTION public.set_daily_report_requirements(
  target_employee_id UUID,
  require_bos BOOLEAN,
  require_eod BOOLEAN
)
RETURNS public.employee_work_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID;
  previous_settings public.employee_work_settings;
  saved_settings public.employee_work_settings;
BEGIN
  actor_employee_id := public.current_employee_id();

  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Only a superadmin can change BOS/EOD requirements';
  END IF;

  IF require_bos IS NULL OR require_eod IS NULL THEN
    RAISE EXCEPTION 'BOS and EOD requirements must be specified';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = target_employee_id
      AND employee.status = 'Active'
  ) THEN
    RAISE EXCEPTION 'Active employee not found';
  END IF;

  INSERT INTO public.employee_work_settings (employee_id)
  VALUES (target_employee_id)
  ON CONFLICT (employee_id) DO NOTHING;

  SELECT *
  INTO previous_settings
  FROM public.employee_work_settings settings
  WHERE settings.employee_id = target_employee_id
  FOR UPDATE;

  IF previous_settings.bos_required = require_bos
    AND previous_settings.eod_required = require_eod
  THEN
    RETURN previous_settings;
  END IF;

  UPDATE public.employee_work_settings settings
  SET bos_required = require_bos,
      eod_required = require_eod,
      updated_by = actor_employee_id,
      updated_at = clock_timestamp()
  WHERE settings.employee_id = target_employee_id
  RETURNING * INTO saved_settings;

  INSERT INTO public.daily_report_settings_audit (
    employee_id,
    changed_by,
    old_bos_required,
    new_bos_required,
    old_eod_required,
    new_eod_required,
    changed_at
  )
  VALUES (
    target_employee_id,
    actor_employee_id,
    previous_settings.bos_required,
    saved_settings.bos_required,
    previous_settings.eod_required,
    saved_settings.eod_required,
    saved_settings.updated_at
  );

  RETURN saved_settings;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.daily_report_settings_audit
  FROM authenticated;
REVOKE ALL ON FUNCTION public.prevent_daily_report_settings_audit_mutation()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_daily_report_requirements(
  UUID,
  BOOLEAN,
  BOOLEAN
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_daily_report_requirements(
  UUID,
  BOOLEAN,
  BOOLEAN
) TO authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'employee_work_settings'
    )
  THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.employee_work_settings;
  END IF;
END;
$$;

COMMIT;
