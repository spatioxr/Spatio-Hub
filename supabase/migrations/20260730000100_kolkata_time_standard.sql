-- HRMS-032: make Asia/Kolkata the explicit Phase 1 calendar and clock boundary.
-- Timestamps remain timestamptz/UTC-safe; only business-day interpretation changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.app_current_date(
  reference_time TIMESTAMPTZ DEFAULT statement_timestamp()
)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT (reference_time AT TIME ZONE 'Asia/Kolkata')::date;
$$;

CREATE OR REPLACE FUNCTION public.app_day_start(target_date DATE)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT target_date::timestamp AT TIME ZONE 'Asia/Kolkata';
$$;

CREATE OR REPLACE FUNCTION public.app_clock_time(reference_time TIMESTAMPTZ)
RETURNS TIME
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT (reference_time AT TIME ZONE 'Asia/Kolkata')::time;
$$;

-- These workflow functions intentionally use current_date, date-to-timestamptz,
-- and timestamptz-to-time casts. Pinning their execution timezone makes all
-- three operations agree on the Asia/Kolkata work day regardless of the
-- database role or connection timezone.
ALTER FUNCTION public.current_work_day_requirements()
  SET TimeZone TO 'Asia/Kolkata';
ALTER FUNCTION public.start_work_day(UUID, UUID, TEXT, TEXT)
  SET TimeZone TO 'Asia/Kolkata';
ALTER FUNCTION public.end_work_day(UUID, TEXT)
  SET TimeZone TO 'Asia/Kolkata';

REVOKE ALL ON FUNCTION public.app_current_date(TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_day_start(DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_clock_time(TIMESTAMPTZ) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.app_current_date(TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_day_start(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_clock_time(TIMESTAMPTZ) TO authenticated;

COMMIT;
