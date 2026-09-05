-- HRMS-020 avatar-egress regression verification.
-- Expected result: all_checks_pass is true. No data is mutated.

BEGIN;

WITH policy_checks AS (
  SELECT
    count(*) FILTER (WHERE cmd = 'SELECT') = 1 AS has_read_policy,
    count(*) FILTER (WHERE cmd = 'INSERT') = 1 AS has_insert_policy,
    count(*) FILTER (WHERE cmd = 'UPDATE') = 1 AS has_update_policy,
    count(*) FILTER (WHERE cmd = 'DELETE') = 1 AS has_delete_policy,
    bool_and(
      roles = ARRAY['authenticated']::NAME[]
    ) AS policies_are_authenticated_only
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname LIKE 'employee_avatars_%'
),
results AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'employees'
        AND column_name = 'avatar_path'
        AND data_type = 'text'
    ) AS has_avatar_path,
    EXISTS (
      SELECT 1
      FROM storage.buckets
      WHERE id = 'employee-avatars'
        AND public = false
        AND file_size_limit = 524288
        AND allowed_mime_types = ARRAY['image/jpeg']::TEXT[]
    ) AS has_private_avatar_bucket,
    (SELECT has_read_policy FROM policy_checks) AS has_read_policy,
    (SELECT has_insert_policy FROM policy_checks) AS has_insert_policy,
    (SELECT has_update_policy FROM policy_checks) AS has_update_policy,
    (SELECT has_delete_policy FROM policy_checks) AS has_delete_policy,
    (SELECT policies_are_authenticated_only FROM policy_checks)
      AS policies_are_authenticated_only,
    pg_get_function_result(
      'public.live_work_status()'::REGPROCEDURE
    ) ILIKE '%avatar_path text%'
      AND pg_get_function_result(
        'public.live_work_status()'::REGPROCEDURE
      ) ILIKE '%work_mode text%'
      AS live_status_is_combined,
    pg_get_functiondef(
      'public.live_work_status()'::REGPROCEDURE
    ) ILIKE '%WHEN employee.avatar_url ~* ''^https://''%'
      AS live_status_rejects_embedded_avatars,
    pg_get_function_result(
      'public.current_reporting_manager()'::REGPROCEDURE
    ) ILIKE '%manager_avatar_path text%'
      AS manager_projection_has_avatar_path,
    pg_get_functiondef(
      'public.guard_employee_self_update()'::REGPROCEDURE
    ) ILIKE '%NEW.avatar_path IS NOT DISTINCT FROM OLD.avatar_path%'
      AND pg_get_functiondef(
        'public.guard_employee_self_update()'::REGPROCEDURE
      ) ILIKE '%storage.foldername(NEW.avatar_path)%'
      AS profile_guard_covers_avatar_path
)
SELECT
  has_avatar_path
    AND has_private_avatar_bucket
    AND has_read_policy
    AND has_insert_policy
    AND has_update_policy
    AND has_delete_policy
    AND policies_are_authenticated_only
    AND live_status_is_combined
    AND live_status_rejects_embedded_avatars
    AND manager_projection_has_avatar_path
    AND profile_guard_covers_avatar_path AS all_checks_pass,
  to_jsonb(results) AS checks
FROM results;

ROLLBACK;
