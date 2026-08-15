-- Dashboard visual-sync read boundary. Expected result: all_checks_pass true.

BEGIN;

WITH results AS (
  SELECT
    to_regprocedure('public.current_reporting_manager()') IS NOT NULL
      AS has_reporting_manager_projection,
    pg_get_function_result(
      'public.live_work_status()'::regprocedure
    ) ILIKE '%avatar_url text%'
      AS live_status_has_avatar,
    NOT has_function_privilege(
      'anon',
      'public.current_reporting_manager()',
      'EXECUTE'
    )
      AS manager_projection_denies_anon,
    has_function_privilege(
      'authenticated',
      'public.current_reporting_manager()',
      'EXECUTE'
    )
      AS manager_projection_allows_authenticated,
    NOT has_function_privilege(
      'anon',
      'public.live_work_status()',
      'EXECUTE'
    )
      AS live_status_denies_anon,
    has_function_privilege(
      'authenticated',
      'public.live_work_status()',
      'EXECUTE'
    )
      AS live_status_allows_authenticated
)
SELECT
  has_reporting_manager_projection
    AND live_status_has_avatar
    AND manager_projection_denies_anon
    AND manager_projection_allows_authenticated
    AND live_status_denies_anon
    AND live_status_allows_authenticated AS all_checks_pass,
  to_jsonb(results) AS checks
FROM results;

ROLLBACK;
