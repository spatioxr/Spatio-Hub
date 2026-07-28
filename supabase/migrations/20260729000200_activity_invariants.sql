-- HRMS-008: make the internal activity catalogue operational.
-- Activity administration UI remains tracked by HRMS-028.

BEGIN;

CREATE OR REPLACE FUNCTION public.assert_activity_label_stable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name
    AND EXISTS (
      SELECT 1
      FROM public.work_entries entry
      WHERE entry.activity_id = OLD.id
    )
  THEN
    RAISE EXCEPTION
      'Activity names cannot be changed after work has been logged against them';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS activities_preserve_historical_label
  ON public.activities;
CREATE TRIGGER activities_preserve_historical_label
  BEFORE UPDATE OF name ON public.activities
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_activity_label_stable();

CREATE OR REPLACE FUNCTION public.create_activity(
  activity_name TEXT,
  activity_description TEXT
)
RETURNS public.activities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created_activity public.activities;
BEGIN
  IF NOT public.has_organisation_access() THEN
    RAISE EXCEPTION 'Only admins and superadmins can create activities';
  END IF;

  IF COALESCE(length(btrim(activity_name)), 0) = 0 THEN
    RAISE EXCEPTION 'Activity name is required';
  END IF;

  INSERT INTO public.activities (
    name,
    description,
    created_by
  )
  VALUES (
    btrim(activity_name),
    NULLIF(btrim(activity_description), ''),
    public.current_employee_id()
  )
  RETURNING * INTO created_activity;

  RETURN created_activity;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_activity_archived(
  target_activity_id UUID,
  should_archive BOOLEAN
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
    RAISE EXCEPTION 'Only admins and superadmins can archive activities';
  END IF;

  IF should_archive IS NULL THEN
    RAISE EXCEPTION 'Archive state is required';
  END IF;

  UPDATE public.activities
  SET archived_at = CASE
    WHEN should_archive THEN COALESCE(archived_at, timezone('utc', now()))
    ELSE NULL
  END
  WHERE id = target_activity_id
  RETURNING * INTO updated_activity;

  IF updated_activity.id IS NULL THEN
    RAISE EXCEPTION 'Activity not found';
  END IF;

  RETURN updated_activity;
END;
$$;

DROP POLICY IF EXISTS activities_delete_superadmin
  ON public.activities;
DROP POLICY IF EXISTS activities_delete_denied
  ON public.activities;
CREATE POLICY activities_delete_denied
  ON public.activities FOR DELETE TO authenticated
  USING (false);

REVOKE DELETE ON TABLE public.activities FROM authenticated;

REVOKE ALL ON FUNCTION public.assert_activity_label_stable()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_activity(TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_activity_archived(UUID, BOOLEAN)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_activity(TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_activity_archived(UUID, BOOLEAN)
  TO authenticated;

COMMIT;
