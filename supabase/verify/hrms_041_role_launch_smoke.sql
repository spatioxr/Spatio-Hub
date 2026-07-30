-- HRMS-041 rollback-only four-role launch smoke verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_041_actors (
  role_name TEXT PRIMARY KEY,
  employee_id UUID NOT NULL,
  auth_id UUID NOT NULL
);

WITH actor_seed(role_name, emp_code, email) AS (
  VALUES
    ('employee', 'HRMS041EMP', 'hrms-041-employee@example.invalid'),
    ('manager', 'HRMS041MGR', 'hrms-041-manager@example.invalid'),
    ('admin', 'HRMS041ADM', 'hrms-041-admin@example.invalid'),
    ('superadmin', 'HRMS041SUP', 'hrms-041-superadmin@example.invalid')
),
inserted_auth AS (
  INSERT INTO auth.users (id, email)
  SELECT gen_random_uuid(), actor.email
  FROM actor_seed actor
  RETURNING id, email
),
inserted_employees AS (
  INSERT INTO public.employees (
    auth_id,
    emp_code,
    name,
    email,
    department,
    designation,
    role,
    status
  )
  SELECT
    auth_user.id,
    actor.emp_code,
    'HRMS-041 ' || initcap(actor.role_name),
    actor.email,
    'HRMS-041 Verification',
    'Launch Smoke',
    actor.role_name,
    'Active'
  FROM actor_seed actor
  JOIN inserted_auth auth_user
    ON auth_user.email = actor.email
  RETURNING id, auth_id, role
)
INSERT INTO hrms_041_actors (role_name, employee_id, auth_id)
SELECT role, id, auth_id
FROM inserted_employees;

INSERT INTO public.leave_balances (employee_id)
SELECT employee_id
FROM hrms_041_actors;

INSERT INTO public.employee_work_settings (
  employee_id,
  bos_required,
  eod_required
)
SELECT employee_id, false, false
FROM hrms_041_actors
ON CONFLICT (employee_id) DO UPDATE
SET bos_required = false,
    eod_required = false;

CREATE TEMP TABLE hrms_041_activities AS
SELECT
  (
    SELECT id
    FROM public.activities
    WHERE name = 'Pre-sales'
      AND archived_at IS NULL
    LIMIT 1
  ) AS first_activity_id,
  (
    SELECT id
    FROM public.activities
    WHERE name = 'Estimation'
      AND archived_at IS NULL
    LIMIT 1
  ) AS second_activity_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM hrms_041_activities
    WHERE first_activity_id IS NULL
       OR second_activity_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Pre-sales and Estimation activities are required';
  END IF;
END
$$;

CREATE TEMP TABLE hrms_041_projects (
  project_name TEXT PRIMARY KEY,
  project_id UUID NOT NULL
);

WITH inserted AS (
  INSERT INTO public.projects (code, name, description, created_by)
  VALUES
    (
      'HRMS041TEAM',
      'HRMS-041 Managed Project',
      'Manager-scoped rollback-only launch fixture.',
      (
        SELECT employee_id
        FROM hrms_041_actors
        WHERE role_name = 'superadmin'
      )
    ),
    (
      'HRMS041ORG',
      'HRMS-041 Organisation Project',
      'Organisation-scoped rollback-only launch fixture.',
      (
        SELECT employee_id
        FROM hrms_041_actors
        WHERE role_name = 'superadmin'
      )
    )
  RETURNING id, code
)
INSERT INTO hrms_041_projects (project_name, project_id)
SELECT
  CASE code
    WHEN 'HRMS041TEAM' THEN 'managed'
    ELSE 'organisation'
  END,
  id
FROM inserted;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_041_actors
WHERE role_name = 'superadmin';

INSERT INTO public.project_managers (
  project_id,
  employee_id,
  assigned_by
)
SELECT
  project.project_id,
  manager.employee_id,
  superadmin.employee_id
FROM hrms_041_projects project
CROSS JOIN hrms_041_actors manager
CROSS JOIN hrms_041_actors superadmin
WHERE project.project_name = 'managed'
  AND manager.role_name = 'manager'
  AND superadmin.role_name = 'superadmin';

INSERT INTO public.project_members (
  project_id,
  employee_id,
  assigned_by
)
SELECT
  project.project_id,
  employee.employee_id,
  superadmin.employee_id
FROM hrms_041_projects project
CROSS JOIN hrms_041_actors employee
CROSS JOIN hrms_041_actors superadmin
WHERE project.project_name = 'managed'
  AND employee.role_name = 'employee'
  AND superadmin.role_name = 'superadmin';

CREATE TEMP TABLE hrms_041_results (
  role_name TEXT PRIMARY KEY,
  login_resolved BOOLEAN NOT NULL,
  timer_started BOOLEAN NOT NULL,
  break_resumed BOOLEAN NOT NULL,
  context_switched BOOLEAN NOT NULL,
  work_day_ended BOOLEAN NOT NULL,
  personal_timesheet_visible BOOLEAN NOT NULL,
  project_scope_correct BOOLEAN NOT NULL,
  people_visibility_correct BOOLEAN NOT NULL,
  admin_settings_visibility_correct BOOLEAN NOT NULL,
  own_leave_submitted BOOLEAN NOT NULL
);

CREATE TEMP TABLE hrms_041_scope_results (
  check_name TEXT PRIMARY KEY,
  check_value BOOLEAN NOT NULL
);

GRANT SELECT ON hrms_041_actors TO authenticated;
GRANT SELECT ON hrms_041_activities TO authenticated;
GRANT SELECT ON hrms_041_projects TO authenticated;
GRANT SELECT, INSERT ON hrms_041_results TO authenticated;
GRANT SELECT, INSERT ON hrms_041_scope_results TO authenticated;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  actor RECORD;
  first_activity_id UUID;
  second_activity_id UUID;
  first_session public.work_entries;
  started_break public.break_entries;
  resumed_break public.break_entries;
  switched_session public.work_entries;
  ended_session public.work_entries;
  submitted_leave public.leaves;
  expected_project_count INTEGER;
  expected_people_count INTEGER;
  expected_people_access BOOLEAN;
  expected_admin_access BOOLEAN;
  leave_date DATE;
BEGIN
  SELECT activities.first_activity_id, activities.second_activity_id
  INTO first_activity_id, second_activity_id
  FROM hrms_041_activities activities;

  FOR actor IN
    SELECT *
    FROM hrms_041_actors
    ORDER BY CASE role_name
      WHEN 'employee' THEN 1
      WHEN 'manager' THEN 2
      WHEN 'admin' THEN 3
      ELSE 4
    END
  LOOP
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', actor.auth_id::text,
        'role', 'authenticated'
      )::text,
      true
    );

    SELECT *
    INTO first_session
    FROM public.start_work_day(
      NULL,
      first_activity_id,
      'HRMS-041 start as ' || actor.role_name,
      NULL
    );

    SELECT *
    INTO started_break
    FROM public.start_work_break();

    SELECT *
    INTO resumed_break
    FROM public.resume_work_session();

    SELECT *
    INTO switched_session
    FROM public.switch_work_session(
      NULL,
      second_activity_id,
      'HRMS-041 switch as ' || actor.role_name
    );

    SELECT *
    INTO ended_session
    FROM public.end_work_day(switched_session.id, NULL);

    leave_date := DATE '2099-08-01'
      + CASE actor.role_name
          WHEN 'employee' THEN 0
          WHEN 'manager' THEN 1
          WHEN 'admin' THEN 2
          ELSE 3
        END;

    SELECT *
    INTO submitted_leave
    FROM public.submit_leave_request(
      'Casual Leave',
      leave_date,
      leave_date,
      false,
      'HRMS-041 ' || actor.role_name || ' launch smoke'
    );

    expected_project_count := CASE
      WHEN actor.role_name IN ('employee', 'manager') THEN 1
      ELSE 2
    END;
    expected_people_count := CASE actor.role_name
      WHEN 'employee' THEN 1
      WHEN 'manager' THEN 2
      ELSE 4
    END;
    expected_people_access := actor.role_name <> 'employee';
    expected_admin_access := actor.role_name IN ('admin', 'superadmin');

    INSERT INTO hrms_041_results
    SELECT
      actor.role_name,
      public.current_employee_id() = actor.employee_id
        AND public.current_employee_role() = actor.role_name,
      first_session.id IS NOT NULL,
      started_break.id = resumed_break.id
        AND resumed_break.ended_at IS NOT NULL,
      switched_session.id IS NOT NULL
        AND switched_session.id <> first_session.id
        AND EXISTS (
          SELECT 1
          FROM public.work_entries entry
          WHERE entry.id = first_session.id
            AND entry.ended_at IS NOT NULL
        ),
      ended_session.id = switched_session.id
        AND ended_session.ended_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.current_work_session()),
      (
        SELECT count(*) = 2
        FROM public.personal_timesheet_entries(
          current_date::timestamptz,
          (current_date + 1)::timestamptz
        )
      ),
      (
        SELECT count(*) = expected_project_count
        FROM public.projects project
        WHERE project.id IN (
          SELECT project_id
          FROM hrms_041_projects
        )
      ),
      public.can_view_people_directory() = expected_people_access
        AND (
          SELECT count(*) = expected_people_count
          FROM public.employees employee
          WHERE employee.id IN (
            SELECT employee_id
            FROM hrms_041_actors
          )
      ),
      public.can_access_admin_settings() = expected_admin_access,
      submitted_leave.employee_id = actor.employee_id
        AND submitted_leave.status = CASE
          WHEN actor.role_name = 'superadmin' THEN 'Approved'
          ELSE 'Pending'
        END
        AND EXISTS (
          SELECT 1
          FROM public.leaves leave_request
          WHERE leave_request.id = submitted_leave.id
            AND leave_request.employee_id = actor.employee_id
        );
  END LOOP;
END
$$;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_041_actors
WHERE role_name = 'manager';

INSERT INTO hrms_041_scope_results (check_name, check_value)
SELECT
  'manager_scope',
  (
    SELECT count(*) = 1
    FROM public.timesheet_scope_members('managed')
    WHERE employee_id IN (
      SELECT employee_id
      FROM hrms_041_actors
    )
  )
  AND (
    SELECT count(*) = 2
    FROM public.scoped_timesheet_entries(
      current_date::timestamptz,
      (current_date + 1)::timestamptz,
      'managed',
      (
        SELECT employee_id
        FROM hrms_041_actors
        WHERE role_name = 'employee'
      )
    )
  );

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_041_actors
WHERE role_name = 'admin';

INSERT INTO hrms_041_scope_results (check_name, check_value)
SELECT
  'admin_organisation_scope',
  (
    SELECT count(*) = 4
    FROM public.timesheet_scope_members('organisation')
    WHERE employee_id IN (
      SELECT employee_id
      FROM hrms_041_actors
    )
  )
  AND (
    SELECT count(*) = 8
    FROM public.scoped_timesheet_entries(
      current_date::timestamptz,
      (current_date + 1)::timestamptz,
      'organisation',
      NULL
    )
    WHERE employee_id IN (
      SELECT employee_id
      FROM hrms_041_actors
    )
  );

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_041_actors
WHERE role_name = 'superadmin';

INSERT INTO hrms_041_scope_results (check_name, check_value)
SELECT
  'admin_superadmin_parity_and_leave_review',
  (
    SELECT count(*) = 4
    FROM public.timesheet_scope_members('organisation')
    WHERE employee_id IN (
      SELECT employee_id
      FROM hrms_041_actors
    )
  )
  AND (
    SELECT count(*) = 8
    FROM public.scoped_timesheet_entries(
      current_date::timestamptz,
      (current_date + 1)::timestamptz,
      'organisation',
      NULL
    )
    WHERE employee_id IN (
      SELECT employee_id
      FROM hrms_041_actors
    )
  )
  AND (
    SELECT count(*) = 4
    FROM public.leaves leave_request
    WHERE leave_request.employee_id IN (
      SELECT employee_id
      FROM hrms_041_actors
    )
  );

RESET ROLE;

SELECT
  (
    SELECT bool_and(
      login_resolved
      AND timer_started
      AND break_resumed
      AND context_switched
      AND work_day_ended
      AND personal_timesheet_visible
      AND project_scope_correct
      AND people_visibility_correct
      AND admin_settings_visibility_correct
      AND own_leave_submitted
    )
    FROM hrms_041_results
  )
  AND (
    SELECT bool_and(check_value)
    FROM hrms_041_scope_results
  ) AS all_checks_pass,
  jsonb_build_object(
    'roles', (
      SELECT jsonb_agg(to_jsonb(result) ORDER BY result.role_name)
      FROM hrms_041_results result
    ),
    'scopes', (
      SELECT jsonb_object_agg(check_name, check_value)
      FROM hrms_041_scope_results
    )
  ) AS checks;

ROLLBACK;
