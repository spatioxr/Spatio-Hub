-- Confirm a valid completed short day without funding its unworked hours.
BEGIN;
DO $$
DECLARE definition TEXT;
BEGIN
  SELECT pg_get_functiondef('public.workload_person_days(uuid,date)'::regprocedure) INTO definition;
  IF position('THEN ''missing_time'' END' IN definition) = 0 THEN RAISE EXCEPTION 'Expected missing-time flag not found'; END IF;
  definition := replace(definition, 'THEN ''missing_time'' END', 'AND NOT f.confirmed THEN ''missing_time'' END');
  definition := replace(definition, 'CASE WHEN f.recorded > 28800 THEN ''above_eight'' END',
    'CASE WHEN f.recorded > 28800 THEN ''above_eight'' END,
    CASE WHEN f.recorded > 0 AND f.recorded < 28800 THEN ''below_eight'' END');
  EXECUTE definition;
  SELECT pg_get_functiondef('public.confirm_workload_day(uuid,date,text,text)'::regprocedure) INTO definition;
  IF position('NOT (''long_day'' = ANY(fact.flags))' IN definition) = 0 THEN RAISE EXCEPTION 'Expected confirmation guard not found'; END IF;
  definition := replace(definition, 'NOT (''long_day'' = ANY(fact.flags))',
    'NOT (''long_day'' = ANY(fact.flags) OR (''missing_time'' = ANY(fact.flags) AND fact.recorded_seconds > 0))');
  definition := replace(definition, 'Only a completed long day without blocking issues can be confirmed',
    'Only a completed short or long day with recorded work and no blocking issues can be confirmed');
  EXECUTE definition;
END;
$$;
COMMIT;
