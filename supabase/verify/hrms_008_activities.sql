-- HRMS-008 rollback-only behavioural verification.
-- Expected result: every value is true. The transaction is rolled back.

BEGIN;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', auth_id::text,
    'role', 'authenticated',
    'email', email
  )::text,
  true
)
FROM public.employees
WHERE role = 'superadmin'
  AND status = 'Active'
LIMIT 1;

CREATE TEMP TABLE hrms_008_activity AS
SELECT activity.*
FROM public.create_activity(
  '  HRMS-008 Verification Activity  ',
  'Rollback-only activity catalogue verification.'
) AS activity;

INSERT INTO public.work_entries (
  employee_id,
  activity_id,
  task_description,
  started_at,
  ended_at
)
SELECT
  public.current_employee_id(),
  activity.id,
  'Verify historical activity label retention.',
  '1900-01-01 09:00:00+00'::timestamptz,
  '1900-01-01 10:00:00+00'::timestamptz
FROM hrms_008_activity activity;

CREATE TEMP TABLE hrms_008_archived AS
SELECT archived.*
FROM hrms_008_activity created
CROSS JOIN LATERAL public.set_activity_archived(
  created.id,
  true
) AS archived;

DO $$
DECLARE
  verification_activity_id UUID;
  rename_blocked BOOLEAN := false;
BEGIN
  SELECT id
  INTO verification_activity_id
  FROM hrms_008_activity;

  BEGIN
    UPDATE public.activities
    SET name = 'Changed historical label'
    WHERE id = verification_activity_id;
  EXCEPTION
    WHEN OTHERS THEN
      rename_blocked := true;
  END;

  IF NOT rename_blocked THEN
    RAISE EXCEPTION 'Changing a historical activity label was not blocked';
  END IF;
END
$$;

SELECT
  created.name = 'HRMS-008 Verification Activity' AS name_normalised,
  archived.archived_at IS NOT NULL AS archived,
  EXISTS (
    SELECT 1
    FROM public.work_entries entry
    JOIN public.activities activity
      ON activity.id = entry.activity_id
    WHERE entry.activity_id = created.id
      AND activity.name = created.name
  ) AS historical_label_retained,
  (
    SELECT count(*) = 5
    FROM public.activities activity
    WHERE activity.name IN (
      'Pre-sales',
      'Proposal making',
      'Estimation',
      'Demo video making',
      'Marketing material making'
    )
      AND activity.archived_at IS NULL
  ) AS seeded_activities_selectable,
  to_regprocedure(
    'public.create_activity(text,text)'
  ) IS NOT NULL AS create_rpc_exists,
  to_regprocedure(
    'public.set_activity_archived(uuid,boolean)'
  ) IS NOT NULL AS archive_rpc_exists,
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'activities_preserve_historical_label'
      AND NOT tgisinternal
  ) AS historical_label_guard_exists,
  NOT has_table_privilege(
    'authenticated',
    'public.activities',
    'DELETE'
  ) AS authenticated_delete_denied,
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'activities'
      AND policyname = 'activities_delete_denied'
      AND qual = 'false'
  ) AS delete_deny_policy_exists,
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'work_entries'
      AND policyname = 'work_entries_insert_own'
      AND with_check LIKE '%archived_at IS NULL%'
  ) AS archived_activity_entry_guard_exists
FROM hrms_008_activity created
CROSS JOIN hrms_008_archived archived;

ROLLBACK;
