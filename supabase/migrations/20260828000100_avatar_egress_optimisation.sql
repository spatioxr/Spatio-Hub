-- HRMS-020 performance correction: keep profile-photo bytes out of the
-- frequently refreshed live-status response and store new photos as private,
-- cacheable Storage objects.

BEGIN;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS avatar_path TEXT;

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_avatar_path_valid;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_avatar_path_valid CHECK (
    avatar_path IS NULL
    OR (
      avatar_path = btrim(avatar_path)
      AND length(avatar_path) BETWEEN 1 AND 512
      AND avatar_path !~ '(^/|\.\.)'
    )
  );

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'employee-avatars',
  'employee-avatars',
  false,
  524288,
  ARRAY['image/jpeg']::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS employee_avatars_read
  ON storage.objects;
CREATE POLICY employee_avatars_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'employee-avatars'
    AND public.current_employee_id() IS NOT NULL
  );

DROP POLICY IF EXISTS employee_avatars_insert_own
  ON storage.objects;
CREATE POLICY employee_avatars_insert_own
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'employee-avatars'
    AND (storage.foldername(name))[1]
      = public.current_employee_id()::TEXT
  );

DROP POLICY IF EXISTS employee_avatars_update_own
  ON storage.objects;
CREATE POLICY employee_avatars_update_own
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'employee-avatars'
    AND (storage.foldername(name))[1]
      = public.current_employee_id()::TEXT
  )
  WITH CHECK (
    bucket_id = 'employee-avatars'
    AND (storage.foldername(name))[1]
      = public.current_employee_id()::TEXT
  );

DROP POLICY IF EXISTS employee_avatars_delete_own
  ON storage.objects;
CREATE POLICY employee_avatars_delete_own
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'employee-avatars'
    AND (storage.foldername(name))[1]
      = public.current_employee_id()::TEXT
  );

CREATE OR REPLACE FUNCTION public.guard_employee_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF OLD.auth_id IS NULL
    AND OLD.email = lower(auth.jwt() ->> 'email')
    AND NEW.auth_id = auth.uid()
    AND NEW.emp_code IS NOT DISTINCT FROM OLD.emp_code
    AND NEW.name IS NOT DISTINCT FROM OLD.name
    AND NEW.email IS NOT DISTINCT FROM OLD.email
    AND NEW.phone_number IS NOT DISTINCT FROM OLD.phone_number
    AND NEW.department IS NOT DISTINCT FROM OLD.department
    AND NEW.designation IS NOT DISTINCT FROM OLD.designation
    AND NEW.role IS NOT DISTINCT FROM OLD.role
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.date_of_joining IS NOT DISTINCT FROM OLD.date_of_joining
    AND NEW.managed_department IS NOT DISTINCT FROM OLD.managed_department
    AND NEW.reports_to IS NOT DISTINCT FROM OLD.reports_to
    AND NEW.avatar_url IS NOT DISTINCT FROM OLD.avatar_url
    AND NEW.avatar_path IS NOT DISTINCT FROM OLD.avatar_path
    AND NEW.must_change_password IS NOT DISTINCT FROM OLD.must_change_password
    AND NEW.temporary_password_issued_at IS NOT DISTINCT FROM OLD.temporary_password_issued_at
    AND NEW.temporary_password_issued_by IS NOT DISTINCT FROM OLD.temporary_password_issued_by
  THEN
    RETURN NEW;
  END IF;

  IF OLD.auth_id = auth.uid()
    AND NEW.auth_id IS NOT DISTINCT FROM OLD.auth_id
    AND NEW.emp_code IS NOT DISTINCT FROM OLD.emp_code
    AND NEW.name IS NOT DISTINCT FROM OLD.name
    AND NEW.email IS NOT DISTINCT FROM OLD.email
    AND NEW.phone_number IS NOT DISTINCT FROM OLD.phone_number
    AND NEW.department IS NOT DISTINCT FROM OLD.department
    AND NEW.designation IS NOT DISTINCT FROM OLD.designation
    AND NEW.role IS NOT DISTINCT FROM OLD.role
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.date_of_joining IS NOT DISTINCT FROM OLD.date_of_joining
    AND NEW.managed_department IS NOT DISTINCT FROM OLD.managed_department
    AND NEW.reports_to IS NOT DISTINCT FROM OLD.reports_to
    AND NEW.must_change_password IS NOT DISTINCT FROM OLD.must_change_password
    AND NEW.temporary_password_issued_at IS NOT DISTINCT FROM OLD.temporary_password_issued_at
    AND NEW.temporary_password_issued_by IS NOT DISTINCT FROM OLD.temporary_password_issued_by
    AND (
      NEW.avatar_url IS NOT DISTINCT FROM OLD.avatar_url
      OR NEW.avatar_url IS NULL
      OR NEW.avatar_url ~* '^https://'
    )
    AND (
      NEW.avatar_path IS NULL
      OR (storage.foldername(NEW.avatar_path))[1] = OLD.id::TEXT
    )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Employee fields must be changed through the controlled People workflow';
END;
$$;

DROP FUNCTION public.live_work_status();

CREATE FUNCTION public.live_work_status()
RETURNS TABLE (
  employee_id UUID,
  employee_name TEXT,
  employee_code TEXT,
  avatar_path TEXT,
  avatar_url TEXT,
  work_status TEXT,
  status_started_at TIMESTAMPTZ,
  context_type TEXT,
  context_id UUID,
  context_label TEXT,
  is_stale BOOLEAN,
  first_check_in_at TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ,
  break_started_at TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ,
  work_mode TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    employee.id AS employee_id,
    employee.name AS employee_name,
    employee.emp_code AS employee_code,
    employee.avatar_path,
    CASE
      WHEN employee.avatar_url ~* '^https://' THEN employee.avatar_url
      ELSE NULL
    END AS avatar_url,
    CASE
      WHEN open_entry.id IS NULL THEN 'Out'
      WHEN active_break.id IS NOT NULL THEN 'Break'
      ELSE 'In'
    END AS work_status,
    CASE
      WHEN open_entry.id IS NULL THEN COALESCE(
        today_attendance.checked_out_at,
        latest_closed_today.ended_at
      )
      WHEN active_break.id IS NOT NULL THEN active_break.started_at
      ELSE COALESCE(
        today_attendance.checked_in_at,
        first_entry_today.started_at
      )
    END AS status_started_at,
    CASE
      WHEN open_entry.activity_id IS NOT NULL THEN 'activity'
      WHEN open_entry.project_id IS NOT NULL
        AND (
          public.current_employee_role() IN ('manager', 'admin', 'superadmin')
          OR public.can_access_project(open_entry.project_id)
        )
      THEN 'project'
      ELSE NULL
    END AS context_type,
    CASE
      WHEN open_entry.activity_id IS NOT NULL THEN open_entry.activity_id
      WHEN open_entry.project_id IS NOT NULL
        AND (
          public.current_employee_role() IN ('manager', 'admin', 'superadmin')
          OR public.can_access_project(open_entry.project_id)
        )
      THEN open_entry.project_id
      ELSE NULL
    END AS context_id,
    CASE
      WHEN open_entry.activity_id IS NOT NULL THEN activity.name
      WHEN open_entry.project_id IS NOT NULL
        AND (
          public.current_employee_role() IN ('manager', 'admin', 'superadmin')
          OR public.can_access_project(open_entry.project_id)
        )
      THEN concat_ws(' · ', project.code, project.name)
      ELSE NULL
    END AS context_label,
    COALESCE(
      open_entry.started_at <= statement_timestamp() - INTERVAL '24 hours',
      false
    ) AS is_stale,
    COALESCE(
      today_attendance.checked_in_at,
      first_entry_today.started_at
    ) AS first_check_in_at,
    COALESCE(
      today_attendance.checked_in_at,
      first_entry_today.started_at
    ) AS checked_in_at,
    active_break.started_at AS break_started_at,
    CASE
      WHEN open_entry.id IS NULL
        AND COALESCE(
          today_attendance.checked_in_at,
          first_entry_today.started_at
        ) IS NOT NULL
      THEN COALESCE(
        today_attendance.checked_out_at,
        latest_closed_today.ended_at
      )
      ELSE NULL
    END AS checked_out_at,
    today_attendance.work_mode
  FROM public.employees employee
  LEFT JOIN LATERAL (
    SELECT entry.*
    FROM public.work_entries entry
    WHERE entry.employee_id = employee.id
      AND entry.ended_at IS NULL
    ORDER BY entry.started_at DESC
    LIMIT 1
  ) open_entry ON true
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN attendance_entry.check_in IS NOT NULL
        THEN (attendance_entry.date + attendance_entry.check_in)
          AT TIME ZONE 'Asia/Kolkata'
        ELSE NULL
      END AS checked_in_at,
      CASE
        WHEN attendance_entry.check_out IS NOT NULL
        THEN (attendance_entry.date + attendance_entry.check_out)
          AT TIME ZONE 'Asia/Kolkata'
        ELSE NULL
      END AS checked_out_at,
      attendance_entry.work_mode
    FROM public.attendance attendance_entry
    WHERE attendance_entry.employee_id = employee.id
      AND attendance_entry.date = public.app_current_date(statement_timestamp())
    LIMIT 1
  ) today_attendance ON true
  LEFT JOIN LATERAL (
    SELECT min(entry.started_at) AS started_at
    FROM public.work_entries entry
    WHERE entry.employee_id = employee.id
      AND entry.started_at >= public.app_day_start(
        public.app_current_date(statement_timestamp())
      )
      AND entry.started_at < public.app_day_start(
        public.app_current_date(statement_timestamp()) + 1
      )
  ) first_entry_today ON true
  LEFT JOIN LATERAL (
    SELECT break_entry.*
    FROM public.break_entries break_entry
    WHERE break_entry.work_entry_id = open_entry.id
      AND break_entry.ended_at IS NULL
    ORDER BY break_entry.started_at DESC
    LIMIT 1
  ) active_break ON true
  LEFT JOIN LATERAL (
    SELECT entry.ended_at
    FROM public.work_entries entry
    WHERE entry.employee_id = employee.id
      AND entry.ended_at IS NOT NULL
      AND entry.ended_at >= public.app_day_start(
        public.app_current_date(statement_timestamp())
      )
      AND entry.ended_at < public.app_day_start(
        public.app_current_date(statement_timestamp()) + 1
      )
    ORDER BY entry.ended_at DESC
    LIMIT 1
  ) latest_closed_today ON true
  LEFT JOIN public.projects project
    ON project.id = open_entry.project_id
  LEFT JOIN public.activities activity
    ON activity.id = open_entry.activity_id
  WHERE employee.status = 'Active'
    AND public.current_employee_id() IS NOT NULL
  ORDER BY employee.name, employee.emp_code;
$$;

DROP FUNCTION public.current_reporting_manager();

CREATE FUNCTION public.current_reporting_manager()
RETURNS TABLE (
  manager_id UUID,
  manager_name TEXT,
  manager_code TEXT,
  manager_designation TEXT,
  manager_avatar_path TEXT,
  manager_avatar_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    manager.id,
    manager.name,
    manager.emp_code,
    manager.designation,
    manager.avatar_path,
    CASE
      WHEN manager.avatar_url ~* '^https://' THEN manager.avatar_url
      ELSE NULL
    END
  FROM public.employees employee
  LEFT JOIN public.employees manager
    ON manager.id = employee.reports_to
      AND manager.status = 'Active'
  WHERE employee.id = public.current_employee_id()
    AND employee.status = 'Active';
$$;

REVOKE ALL ON FUNCTION public.live_work_status()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_reporting_manager()
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.live_work_status()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_reporting_manager()
  TO authenticated, service_role;

COMMIT;
