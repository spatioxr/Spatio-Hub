-- HRMS-012: operational BOS/EOD reports and per-employee requirements.
-- Timer enforcement and settings UI remain separate issues.

BEGIN;

UPDATE public.daily_reports
SET bos_report = NULL,
    bos_submitted_at = NULL
WHERE bos_report IS NOT NULL
  AND length(btrim(bos_report)) = 0;

UPDATE public.daily_reports
SET eod_report = NULL,
    eod_submitted_at = NULL
WHERE eod_report IS NOT NULL
  AND length(btrim(eod_report)) = 0;

ALTER TABLE public.daily_reports
  ADD CONSTRAINT daily_reports_bos_content
    CHECK (bos_report IS NULL OR length(btrim(bos_report)) > 0),
  ADD CONSTRAINT daily_reports_eod_content
    CHECK (eod_report IS NULL OR length(btrim(eod_report)) > 0);

CREATE OR REPLACE FUNCTION public.guard_daily_report_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  submitted_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF TG_OP = 'UPDATE'
    AND (
      NEW.employee_id IS DISTINCT FROM OLD.employee_id
      OR NEW.date IS DISTINCT FROM OLD.date
    )
  THEN
    RAISE EXCEPTION 'Daily report employee and date cannot be changed';
  END IF;

  NEW.bos_report := NULLIF(btrim(NEW.bos_report), '');
  NEW.eod_report := NULLIF(btrim(NEW.eod_report), '');

  IF TG_OP = 'INSERT'
    OR NEW.bos_report IS DISTINCT FROM OLD.bos_report
  THEN
    NEW.bos_submitted_at := CASE
      WHEN NEW.bos_report IS NULL THEN NULL
      ELSE submitted_at
    END;
  ELSE
    NEW.bos_submitted_at := OLD.bos_submitted_at;
  END IF;

  IF TG_OP = 'INSERT'
    OR NEW.eod_report IS DISTINCT FROM OLD.eod_report
  THEN
    NEW.eod_submitted_at := CASE
      WHEN NEW.eod_report IS NULL THEN NULL
      ELSE submitted_at
    END;
  ELSE
    NEW.eod_submitted_at := OLD.eod_submitted_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_reports_guard_write
  ON public.daily_reports;
CREATE TRIGGER daily_reports_guard_write
  BEFORE INSERT OR UPDATE ON public.daily_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_daily_report_write();

INSERT INTO public.employee_work_settings (employee_id)
SELECT employee.id
FROM public.employees employee
ON CONFLICT (employee_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_default_employee_work_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.employee_work_settings (employee_id)
  VALUES (NEW.id)
  ON CONFLICT (employee_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_create_default_work_settings
  ON public.employees;
CREATE TRIGGER employees_create_default_work_settings
  AFTER INSERT ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_employee_work_settings();

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
  ) THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  INSERT INTO public.employee_work_settings (
    employee_id,
    bos_required,
    eod_required,
    updated_by,
    updated_at
  )
  VALUES (
    target_employee_id,
    require_bos,
    require_eod,
    actor_employee_id,
    clock_timestamp()
  )
  ON CONFLICT (employee_id) DO UPDATE
  SET bos_required = EXCLUDED.bos_required,
      eod_required = EXCLUDED.eod_required,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at
  RETURNING * INTO saved_settings;

  RETURN saved_settings;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.employee_work_settings
  FROM authenticated;

REVOKE ALL ON FUNCTION public.guard_daily_report_write()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_default_employee_work_settings()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_daily_report_requirements(UUID, BOOLEAN, BOOLEAN)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_daily_report_requirements(
  UUID,
  BOOLEAN,
  BOOLEAN
) TO authenticated;

COMMIT;
