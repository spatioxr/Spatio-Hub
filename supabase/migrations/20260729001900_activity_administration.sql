-- HRMS-028: controlled internal activity administration.

BEGIN;

CREATE OR REPLACE FUNCTION public.activity_administration_overview()
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  has_history BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_organisation_access() THEN
    RAISE EXCEPTION 'Only admins and superadmins can administer activities';
  END IF;

  RETURN QUERY
  SELECT
    activity.id,
    activity.name,
    activity.description,
    activity.archived_at,
    activity.created_at,
    EXISTS (
      SELECT 1
      FROM public.work_entries entry
      WHERE entry.activity_id = activity.id
    ) AS has_history
  FROM public.activities activity
  ORDER BY activity.archived_at NULLS FIRST, activity.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_activity_definition(
  target_activity_id UUID,
  activity_name TEXT,
  activity_description TEXT
)
RETURNS public.activities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_activity public.activities;
BEGIN
  IF NOT public.has_organisation_access() THEN
    RAISE EXCEPTION 'Only admins and superadmins can edit activities';
  END IF;

  IF COALESCE(length(btrim(activity_name)), 0) = 0 THEN
    RAISE EXCEPTION 'Activity name is required';
  END IF;

  UPDATE public.activities
  SET name = btrim(activity_name),
      description = NULLIF(btrim(activity_description), '')
  WHERE activities.id = target_activity_id
  RETURNING * INTO updated_activity;

  IF updated_activity.id IS NULL THEN
    RAISE EXCEPTION 'Activity not found';
  END IF;

  RETURN updated_activity;
END;
$$;

REVOKE INSERT, UPDATE ON TABLE public.activities FROM authenticated;

REVOKE ALL ON FUNCTION public.activity_administration_overview()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_activity_definition(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.activity_administration_overview()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_activity_definition(UUID, TEXT, TEXT)
  TO authenticated;

COMMIT;
