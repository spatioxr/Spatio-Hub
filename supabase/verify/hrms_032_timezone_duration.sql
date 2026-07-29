-- HRMS-032 rollback-only timezone and duration verification.
-- Expected result: all_checks_pass is true.

BEGIN;

SET LOCAL TimeZone TO 'America/New_York';

WITH checks AS (
  SELECT
    public.app_current_date('2026-07-29 18:29:59+00') = DATE '2026-07-29'
      AS instant_before_ist_midnight_stays_previous_day,
    public.app_current_date('2026-07-29 18:30:00+00') = DATE '2026-07-30'
      AS ist_midnight_starts_next_day,
    public.app_day_start(DATE '2026-07-30')
      = TIMESTAMPTZ '2026-07-29 18:30:00+00'
      AS ist_day_start_is_explicit,
    extract(epoch FROM (
      public.app_day_start(DATE '2026-07-31')
      - public.app_day_start(DATE '2026-07-30')
    )) = 86400
      AS kolkata_day_duration_is_24_hours,
    public.app_clock_time('2026-07-30 06:30:00+00') = TIME '12:00:00'
      AS utc_timestamp_displays_as_ist_clock,
    public.app_day_start(DATE '2026-03-08')
      = TIMESTAMPTZ '2026-03-07 18:30:00+00'
      AS us_spring_dst_does_not_shift_kolkata,
    public.app_day_start(DATE '2026-11-01')
      = TIMESTAMPTZ '2026-10-31 18:30:00+00'
      AS us_autumn_dst_does_not_shift_kolkata,
    (
      SELECT proconfig @> ARRAY['TimeZone=Asia/Kolkata']
      FROM pg_proc
      WHERE oid = 'public.current_work_day_requirements()'::regprocedure
    ) AS requirements_use_kolkata,
    (
      SELECT proconfig @> ARRAY['TimeZone=Asia/Kolkata']
      FROM pg_proc
      WHERE oid = 'public.start_work_day(uuid,uuid,text,text)'::regprocedure
    ) AS start_day_uses_kolkata,
    (
      SELECT proconfig @> ARRAY['TimeZone=Asia/Kolkata']
      FROM pg_proc
      WHERE oid = 'public.end_work_day(uuid,text)'::regprocedure
    ) AS end_day_uses_kolkata
)
SELECT
  (
    SELECT bool_and(check_value::boolean)
    FROM checks result
    CROSS JOIN LATERAL jsonb_each_text(to_jsonb(result)) item(
      check_name,
      check_value
    )
  ) AS all_checks_pass,
  to_jsonb(checks) AS checks
FROM checks;

ROLLBACK;
