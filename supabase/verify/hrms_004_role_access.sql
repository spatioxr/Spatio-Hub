-- HRMS-004 rollback-only authenticated-role RLS verification.
-- Expected result: all_checks_pass is true. The transaction is rolled back.

BEGIN;

CREATE TEMP TABLE hrms_004_actors (
  actor_name TEXT PRIMARY KEY,
  employee_id UUID NOT NULL,
  auth_id UUID NOT NULL
);

WITH actor_seed(actor_name, emp_code, name, email, role) AS (
  VALUES
    (
      'employee',
      'HRMS004EMP',
      'HRMS-004 Employee',
      'hrms-004-employee@example.invalid',
      'employee'
    ),
    (
      'manager',
      'HRMS004MGR',
      'HRMS-004 Manager',
      'hrms-004-manager@example.invalid',
      'manager'
    ),
    (
      'admin',
      'HRMS004ADM',
      'HRMS-004 Admin',
      'hrms-004-admin@example.invalid',
      'admin'
    ),
    (
      'superadmin',
      'HRMS004SUPER',
      'HRMS-004 Superadmin',
      'hrms-004-superadmin@example.invalid',
      'superadmin'
    ),
    (
      'outside',
      'HRMS004OUT',
      'HRMS-004 Outside Employee',
      'hrms-004-outside@example.invalid',
      'employee'
    )
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
    role,
    status
  )
  SELECT
    auth_user.id,
    actor.emp_code,
    actor.name,
    actor.email,
    'HRMS-004 Verification',
    actor.role,
    'Active'
  FROM actor_seed actor
  JOIN inserted_auth auth_user
    ON auth_user.email = actor.email
  RETURNING id, auth_id, emp_code
)
INSERT INTO hrms_004_actors (actor_name, employee_id, auth_id)
SELECT
  CASE employee.emp_code
    WHEN 'HRMS004EMP' THEN 'employee'
    WHEN 'HRMS004MGR' THEN 'manager'
    WHEN 'HRMS004ADM' THEN 'admin'
    WHEN 'HRMS004SUPER' THEN 'superadmin'
    WHEN 'HRMS004OUT' THEN 'outside'
  END,
  employee.id,
  employee.auth_id
FROM inserted_employees employee;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_004_actors
WHERE actor_name = 'superadmin';

INSERT INTO public.leave_balances (employee_id)
SELECT employee_id
FROM hrms_004_actors;

INSERT INTO public.attendance (
  employee_id,
  date,
  check_in,
  check_out,
  status
)
SELECT
  employee_id,
  DATE '2099-04-01',
  TIME '09:00',
  TIME '18:00',
  'Present'
FROM hrms_004_actors;

INSERT INTO public.daily_reports (
  employee_id,
  date,
  bos_report,
  eod_report
)
SELECT
  employee_id,
  DATE '2099-04-01',
  'HRMS-004 BOS fixture.',
  'HRMS-004 EOD fixture.'
FROM hrms_004_actors;

INSERT INTO public.leaves (
  employee_id,
  type,
  from_date,
  to_date,
  days,
  reason
)
SELECT
  employee_id,
  'Casual Leave',
  DATE '2099-04-02',
  DATE '2099-04-02',
  1,
  'HRMS-004 rollback-only leave fixture.'
FROM hrms_004_actors;

CREATE TEMP TABLE hrms_004_holiday AS
WITH inserted AS (
  INSERT INTO public.holidays (name, date)
  VALUES ('HRMS-004 Verification Holiday', DATE '2099-04-03')
  RETURNING id
)
SELECT id
FROM inserted;

CREATE TEMP TABLE hrms_004_activity AS
WITH inserted AS (
  INSERT INTO public.activities (name, description)
  VALUES (
    'HRMS-004 Verification Activity',
    'Rollback-only RLS verification.'
  )
  RETURNING id
)
SELECT id
FROM inserted;

CREATE TEMP TABLE hrms_004_projects (
  project_name TEXT PRIMARY KEY,
  project_id UUID NOT NULL
);

WITH inserted AS (
  INSERT INTO public.projects (code, name, description, created_by)
  VALUES
    (
      'HRMS004TEAM',
      'HRMS-004 Team Project',
      'Manager-scoped rollback-only project.',
      (
        SELECT employee_id
        FROM hrms_004_actors
        WHERE actor_name = 'admin'
      )
    ),
    (
      'HRMS004OUTSIDE',
      'HRMS-004 Outside Project',
      'Out-of-scope rollback-only project.',
      (
        SELECT employee_id
        FROM hrms_004_actors
        WHERE actor_name = 'admin'
      )
    )
  RETURNING id, code
)
INSERT INTO hrms_004_projects (project_name, project_id)
SELECT
  CASE code
    WHEN 'HRMS004TEAM' THEN 'team'
    WHEN 'HRMS004OUTSIDE' THEN 'outside'
  END,
  id
FROM inserted;

INSERT INTO public.project_managers (
  project_id,
  employee_id,
  assigned_by
)
SELECT
  project.project_id,
  actor.employee_id,
  (
    SELECT employee_id
    FROM hrms_004_actors
    WHERE actor_name = 'admin'
  )
FROM hrms_004_projects project
JOIN hrms_004_actors actor
  ON (
    project.project_name = 'team'
    AND actor.actor_name = 'manager'
  )
  OR (
    project.project_name = 'outside'
    AND actor.actor_name = 'admin'
  );

INSERT INTO public.project_members (
  project_id,
  employee_id,
  assigned_by
)
SELECT
  project.project_id,
  actor.employee_id,
  (
    SELECT employee_id
    FROM hrms_004_actors
    WHERE actor_name = 'admin'
  )
FROM hrms_004_projects project
JOIN hrms_004_actors actor
  ON (
    project.project_name = 'team'
    AND actor.actor_name = 'employee'
  )
  OR (
    project.project_name = 'outside'
    AND actor.actor_name = 'outside'
  );

CREATE TEMP TABLE hrms_004_work_entries (
  entry_name TEXT PRIMARY KEY,
  work_entry_id UUID NOT NULL
);

WITH inserted AS (
  INSERT INTO public.work_entries (
    employee_id,
    project_id,
    activity_id,
    task_description,
    started_at,
    ended_at
  )
  VALUES
    (
      (
        SELECT employee_id
        FROM hrms_004_actors
        WHERE actor_name = 'employee'
      ),
      (
        SELECT project_id
        FROM hrms_004_projects
        WHERE project_name = 'team'
      ),
      NULL,
      'HRMS-004 assigned-team entry.',
      TIMESTAMPTZ '2099-04-01 09:00:00+00',
      TIMESTAMPTZ '2099-04-01 10:00:00+00'
    ),
    (
      (
        SELECT employee_id
        FROM hrms_004_actors
        WHERE actor_name = 'manager'
      ),
      NULL,
      (SELECT id FROM hrms_004_activity),
      'HRMS-004 manager own entry.',
      TIMESTAMPTZ '2099-04-01 10:00:00+00',
      TIMESTAMPTZ '2099-04-01 11:00:00+00'
    ),
    (
      (
        SELECT employee_id
        FROM hrms_004_actors
        WHERE actor_name = 'outside'
      ),
      (
        SELECT project_id
        FROM hrms_004_projects
        WHERE project_name = 'outside'
      ),
      NULL,
      'HRMS-004 out-of-scope entry.',
      TIMESTAMPTZ '2099-04-01 11:00:00+00',
      TIMESTAMPTZ '2099-04-01 12:00:00+00'
    )
  RETURNING id, task_description
)
INSERT INTO hrms_004_work_entries (entry_name, work_entry_id)
SELECT
  CASE task_description
    WHEN 'HRMS-004 assigned-team entry.' THEN 'team'
    WHEN 'HRMS-004 manager own entry.' THEN 'manager'
    WHEN 'HRMS-004 out-of-scope entry.' THEN 'outside'
  END,
  id
FROM inserted;

INSERT INTO public.break_entries (
  work_entry_id,
  started_at,
  ended_at
)
SELECT
  work_entry_id,
  CASE entry_name
    WHEN 'team' THEN TIMESTAMPTZ '2099-04-01 09:15:00+00'
    WHEN 'manager' THEN TIMESTAMPTZ '2099-04-01 10:15:00+00'
    WHEN 'outside' THEN TIMESTAMPTZ '2099-04-01 11:15:00+00'
  END,
  CASE entry_name
    WHEN 'team' THEN TIMESTAMPTZ '2099-04-01 09:30:00+00'
    WHEN 'manager' THEN TIMESTAMPTZ '2099-04-01 10:30:00+00'
    WHEN 'outside' THEN TIMESTAMPTZ '2099-04-01 11:30:00+00'
  END
FROM hrms_004_work_entries;

INSERT INTO public.work_entry_audit (
  work_entry_id,
  employee_id,
  changed_by,
  change_reason,
  old_record,
  new_record
)
SELECT
  entry.work_entry_id,
  employee.employee_id,
  (
    SELECT employee_id
    FROM hrms_004_actors
    WHERE actor_name = 'superadmin'
  ),
  'HRMS-004 rollback-only audit fixture.',
  '{}'::jsonb,
  jsonb_build_object('id', entry.work_entry_id)
FROM hrms_004_work_entries entry
JOIN hrms_004_actors employee
  ON (
    entry.entry_name = 'team'
    AND employee.actor_name = 'employee'
  )
  OR (
    entry.entry_name = 'manager'
    AND employee.actor_name = 'manager'
  )
  OR (
    entry.entry_name = 'outside'
    AND employee.actor_name = 'outside'
  );

CREATE TEMP TABLE hrms_004_results (
  check_name TEXT PRIMARY KEY,
  check_value BOOLEAN NOT NULL
);

GRANT SELECT ON hrms_004_actors TO authenticated;
GRANT SELECT ON hrms_004_projects TO authenticated;
GRANT SELECT ON hrms_004_work_entries TO authenticated;
GRANT SELECT ON hrms_004_holiday TO authenticated;
GRANT SELECT ON hrms_004_activity TO authenticated;
GRANT SELECT, INSERT ON hrms_004_results TO authenticated;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_004_actors
WHERE actor_name = 'employee';

SET LOCAL ROLE authenticated;

INSERT INTO hrms_004_results (check_name, check_value)
SELECT
  'employee_identity',
  public.current_employee_role() = 'employee'
UNION ALL
SELECT
  'employee_core_scope',
  (
    SELECT count(*) = 1
    FROM public.employees
    WHERE id IN (SELECT employee_id FROM hrms_004_actors)
  )
  AND (
    SELECT count(*) = 1
    FROM public.attendance
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
  AND (
    SELECT count(*) = 1
    FROM public.daily_reports
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
  AND (
    SELECT count(*) = 1
    FROM public.leaves
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
  AND (
    SELECT count(*) = 1
    FROM public.leave_balances
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
UNION ALL
SELECT
  'employee_project_work_scope',
  (
    SELECT count(*) = 1
    FROM public.projects
    WHERE id IN (SELECT project_id FROM hrms_004_projects)
  )
  AND (
    SELECT count(*) = 1
    FROM public.project_managers
    WHERE project_id IN (
      SELECT project_id FROM hrms_004_projects
    )
  )
  AND (
    SELECT count(*) = 1
    FROM public.project_members
    WHERE project_id IN (
      SELECT project_id FROM hrms_004_projects
    )
  )
  AND (
    SELECT count(*) = 1
    FROM public.work_entries
    WHERE id IN (
      SELECT work_entry_id FROM hrms_004_work_entries
    )
  )
  AND (
    SELECT count(*) = 1
    FROM public.break_entries
    WHERE work_entry_id IN (
      SELECT work_entry_id FROM hrms_004_work_entries
    )
  )
  AND (
    SELECT count(*) = 1
    FROM public.work_entry_audit
    WHERE work_entry_id IN (
      SELECT work_entry_id FROM hrms_004_work_entries
    )
  )
UNION ALL
SELECT
  'employee_shared_and_settings_scope',
  EXISTS (
    SELECT 1
    FROM public.activities
    WHERE id = (SELECT id FROM hrms_004_activity)
  )
  AND EXISTS (
    SELECT 1
    FROM public.holidays
    WHERE id = (SELECT id FROM hrms_004_holiday)
  )
  AND (
    SELECT count(*) = 1
    FROM public.employee_work_settings
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  );

DO $$
DECLARE
  actor_id UUID;
  outside_id UUID;
  outside_entry_id UUID;
  outside_project_id UUID;
  rows_changed INTEGER;
  profile_escalation_denied BOOLEAN := false;
  project_create_denied BOOLEAN := false;
  attendance_write_denied BOOLEAN := false;
  leave_approval_denied BOOLEAN := false;
  assignment_denied BOOLEAN := false;
  direct_entry_write_denied BOOLEAN := false;
  audit_write_denied BOOLEAN := false;
  settings_write_denied BOOLEAN := false;
BEGIN
  SELECT employee_id INTO actor_id
  FROM hrms_004_actors
  WHERE actor_name = 'employee';
  SELECT employee_id INTO outside_id
  FROM hrms_004_actors
  WHERE actor_name = 'outside';
  SELECT work_entry_id INTO outside_entry_id
  FROM hrms_004_work_entries
  WHERE entry_name = 'outside';
  SELECT project_id INTO outside_project_id
  FROM hrms_004_projects
  WHERE project_name = 'outside';

  BEGIN
    UPDATE public.employees
    SET role = 'admin'
    WHERE id = actor_id;
  EXCEPTION
    WHEN OTHERS THEN
      profile_escalation_denied := true;
  END;

  BEGIN
    INSERT INTO public.projects (code, name)
    VALUES ('HRMS004DENIED', 'HRMS-004 Denied Project');
  EXCEPTION
    WHEN OTHERS THEN
      project_create_denied := true;
  END;

  UPDATE public.attendance
  SET status = 'Late'
  WHERE employee_id = outside_id;
  GET DIAGNOSTICS rows_changed = ROW_COUNT;
  attendance_write_denied := rows_changed = 0;

  UPDATE public.leaves
  SET status = 'Approved'
  WHERE employee_id = actor_id;
  GET DIAGNOSTICS rows_changed = ROW_COUNT;
  leave_approval_denied := rows_changed = 0;

  BEGIN
    PERFORM public.assign_project_member(
      outside_project_id,
      actor_id
    );
  EXCEPTION
    WHEN OTHERS THEN
      assignment_denied := true;
  END;

  BEGIN
    INSERT INTO public.work_entries (
      employee_id,
      activity_id,
      task_description,
      started_at,
      ended_at
    )
    VALUES (
      actor_id,
      (SELECT id FROM hrms_004_activity),
      'Direct employee write must be denied.',
      TIMESTAMPTZ '2099-04-04 09:00:00+00',
      TIMESTAMPTZ '2099-04-04 10:00:00+00'
    );
  EXCEPTION
    WHEN OTHERS THEN
      direct_entry_write_denied := true;
  END;

  BEGIN
    UPDATE public.work_entry_audit
    SET change_reason = 'Tampered'
    WHERE work_entry_id = outside_entry_id;
  EXCEPTION
    WHEN OTHERS THEN
      audit_write_denied := true;
  END;

  BEGIN
    UPDATE public.employee_work_settings
    SET bos_required = false
    WHERE employee_id = actor_id;
  EXCEPTION
    WHEN OTHERS THEN
      settings_write_denied := true;
  END;

  INSERT INTO hrms_004_results (check_name, check_value)
  VALUES (
    'employee_writes_denied',
    profile_escalation_denied
      AND project_create_denied
      AND attendance_write_denied
      AND leave_approval_denied
      AND assignment_denied
      AND direct_entry_write_denied
      AND audit_write_denied
      AND settings_write_denied
  );
END
$$;

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_004_actors
WHERE actor_name = 'manager';

SET LOCAL ROLE authenticated;

INSERT INTO hrms_004_results (check_name, check_value)
SELECT
  'manager_identity',
  public.current_employee_role() = 'manager'
UNION ALL
SELECT
  'manager_team_scope',
  (
    SELECT count(*) = 2
    FROM public.employees
    WHERE id IN (SELECT employee_id FROM hrms_004_actors)
  )
  AND (
    SELECT count(*) = 2
    FROM public.attendance
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
  AND (
    SELECT count(*) = 2
    FROM public.daily_reports
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
  AND (
    SELECT count(*) = 1
    FROM public.projects
    WHERE id IN (SELECT project_id FROM hrms_004_projects)
  )
  AND (
    SELECT count(*) = 2
    FROM public.work_entries
    WHERE id IN (
      SELECT work_entry_id FROM hrms_004_work_entries
    )
  )
  AND (
    SELECT count(*) = 2
    FROM public.break_entries
    WHERE work_entry_id IN (
      SELECT work_entry_id FROM hrms_004_work_entries
    )
  )
  AND (
    SELECT count(*) = 2
    FROM public.work_entry_audit
    WHERE work_entry_id IN (
      SELECT work_entry_id FROM hrms_004_work_entries
    )
  )
UNION ALL
SELECT
  'manager_private_scope',
  (
    SELECT count(*) = 1
    FROM public.leaves
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
  AND (
    SELECT count(*) = 1
    FROM public.leave_balances
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
  AND (
    SELECT count(*) = 1
    FROM public.employee_work_settings
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  );

DO $$
DECLARE
  team_member_id UUID;
  outside_id UUID;
  outside_entry_id UUID;
  outside_project_id UUID;
  rows_changed INTEGER;
  member_attendance_write_denied BOOLEAN := false;
  project_create_denied BOOLEAN := false;
  outside_assignment_denied BOOLEAN := false;
  outside_correction_denied BOOLEAN := false;
  leave_approval_denied BOOLEAN := false;
  settings_write_denied BOOLEAN := false;
BEGIN
  SELECT employee_id INTO team_member_id
  FROM hrms_004_actors
  WHERE actor_name = 'employee';
  SELECT employee_id INTO outside_id
  FROM hrms_004_actors
  WHERE actor_name = 'outside';
  SELECT work_entry_id INTO outside_entry_id
  FROM hrms_004_work_entries
  WHERE entry_name = 'outside';
  SELECT project_id INTO outside_project_id
  FROM hrms_004_projects
  WHERE project_name = 'outside';

  UPDATE public.attendance
  SET status = 'Late'
  WHERE employee_id = team_member_id;
  GET DIAGNOSTICS rows_changed = ROW_COUNT;
  member_attendance_write_denied := rows_changed = 0;

  BEGIN
    INSERT INTO public.projects (code, name)
    VALUES ('HRMS004MGRDENY', 'HRMS-004 Manager Denied Project');
  EXCEPTION
    WHEN OTHERS THEN
      project_create_denied := true;
  END;

  BEGIN
    PERFORM public.assign_project_member(
      outside_project_id,
      team_member_id
    );
  EXCEPTION
    WHEN OTHERS THEN
      outside_assignment_denied := true;
  END;

  BEGIN
    PERFORM public.correct_work_entry(
      outside_entry_id,
      outside_project_id,
      NULL,
      'Manager out-of-scope correction must fail.',
      TIMESTAMPTZ '2099-04-01 11:00:00+00',
      TIMESTAMPTZ '2099-04-01 12:00:00+00',
      'Manager does not own the outside project.'
    );
  EXCEPTION
    WHEN OTHERS THEN
      outside_correction_denied := true;
  END;

  UPDATE public.leaves
  SET status = 'Approved'
  WHERE employee_id = outside_id;
  GET DIAGNOSTICS rows_changed = ROW_COUNT;
  leave_approval_denied := rows_changed = 0;

  BEGIN
    UPDATE public.employee_work_settings
    SET bos_required = false
    WHERE employee_id = team_member_id;
  EXCEPTION
    WHEN OTHERS THEN
      settings_write_denied := true;
  END;

  INSERT INTO hrms_004_results (check_name, check_value)
  VALUES (
    'manager_writes_denied',
    member_attendance_write_denied
      AND project_create_denied
      AND outside_assignment_denied
      AND outside_correction_denied
      AND leave_approval_denied
      AND settings_write_denied
  );
END
$$;

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_004_actors
WHERE actor_name = 'admin';

SET LOCAL ROLE authenticated;

INSERT INTO hrms_004_results (check_name, check_value)
SELECT
  'admin_identity',
  public.current_employee_role() = 'admin'
UNION ALL
SELECT
  'admin_organisation_read_scope',
  (
    SELECT count(*) = 5
    FROM public.employees
    WHERE id IN (SELECT employee_id FROM hrms_004_actors)
  )
  AND (
    SELECT count(*) = 5
    FROM public.attendance
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
  AND (
    SELECT count(*) = 5
    FROM public.daily_reports
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
  AND (
    SELECT count(*) = 2
    FROM public.projects
    WHERE id IN (SELECT project_id FROM hrms_004_projects)
  )
  AND (
    SELECT count(*) = 3
    FROM public.work_entries
    WHERE id IN (
      SELECT work_entry_id FROM hrms_004_work_entries
    )
  )
  AND (
    SELECT count(*) = 3
    FROM public.break_entries
    WHERE work_entry_id IN (
      SELECT work_entry_id FROM hrms_004_work_entries
    )
  )
  AND (
    SELECT count(*) = 3
    FROM public.work_entry_audit
    WHERE work_entry_id IN (
      SELECT work_entry_id FROM hrms_004_work_entries
    )
  )
UNION ALL
SELECT
  'admin_private_leave_and_settings_scope',
  (
    SELECT count(*) = 1
    FROM public.leaves
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
  AND (
    SELECT count(*) = 1
    FROM public.leave_balances
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
  AND (
    SELECT count(*) = 1
    FROM public.employee_work_settings
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
UNION ALL
SELECT
  'admin_authorised_controls',
  public.has_organisation_access()
  AND public.can_correct_work_entry(
    (
      SELECT work_entry_id
      FROM hrms_004_work_entries
      WHERE entry_name = 'outside'
    )
  );

DO $$
DECLARE
  other_id UUID;
  outside_project_id UUID;
  rows_changed INTEGER;
  attendance_write_denied BOOLEAN := false;
  report_write_denied BOOLEAN := false;
  leave_approval_denied BOOLEAN := false;
  settings_control_denied BOOLEAN := false;
  project_delete_denied BOOLEAN := false;
  holiday_write_denied BOOLEAN := false;
  direct_entry_write_denied BOOLEAN := false;
BEGIN
  SELECT employee_id INTO other_id
  FROM hrms_004_actors
  WHERE actor_name = 'outside';
  SELECT project_id INTO outside_project_id
  FROM hrms_004_projects
  WHERE project_name = 'outside';

  UPDATE public.attendance
  SET status = 'Late'
  WHERE employee_id = other_id;
  GET DIAGNOSTICS rows_changed = ROW_COUNT;
  attendance_write_denied := rows_changed = 0;

  UPDATE public.daily_reports
  SET bos_report = 'Admin must not edit another employee report.'
  WHERE employee_id = other_id;
  GET DIAGNOSTICS rows_changed = ROW_COUNT;
  report_write_denied := rows_changed = 0;

  UPDATE public.leaves
  SET status = 'Approved'
  WHERE employee_id = other_id;
  GET DIAGNOSTICS rows_changed = ROW_COUNT;
  leave_approval_denied := rows_changed = 0;

  BEGIN
    PERFORM public.set_daily_report_requirements(
      other_id,
      false,
      false
    );
  EXCEPTION
    WHEN OTHERS THEN
      settings_control_denied := true;
  END;

  DELETE FROM public.projects
  WHERE id = outside_project_id;
  GET DIAGNOSTICS rows_changed = ROW_COUNT;
  project_delete_denied := rows_changed = 0;

  BEGIN
    INSERT INTO public.holidays (name, date)
    VALUES ('HRMS-004 Admin Denied Holiday', DATE '2099-04-05');
  EXCEPTION
    WHEN OTHERS THEN
      holiday_write_denied := true;
  END;

  BEGIN
    INSERT INTO public.work_entries (
      employee_id,
      activity_id,
      task_description,
      started_at,
      ended_at
    )
    VALUES (
      other_id,
      (SELECT id FROM hrms_004_activity),
      'Direct admin write must be denied.',
      TIMESTAMPTZ '2099-04-05 09:00:00+00',
      TIMESTAMPTZ '2099-04-05 10:00:00+00'
    );
  EXCEPTION
    WHEN OTHERS THEN
      direct_entry_write_denied := true;
  END;

  INSERT INTO hrms_004_results (check_name, check_value)
  VALUES (
    'admin_writes_denied',
    attendance_write_denied
      AND report_write_denied
      AND leave_approval_denied
      AND settings_control_denied
      AND project_delete_denied
      AND holiday_write_denied
      AND direct_entry_write_denied
  );
END
$$;

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_004_actors
WHERE actor_name = 'superadmin';

SET LOCAL ROLE authenticated;

INSERT INTO hrms_004_results (check_name, check_value)
SELECT
  'superadmin_identity',
  public.current_employee_role() = 'superadmin'
UNION ALL
SELECT
  'superadmin_organisation_scope',
  (
    SELECT count(*) = 5
    FROM public.employees
    WHERE id IN (SELECT employee_id FROM hrms_004_actors)
  )
  AND (
    SELECT count(*) = 5
    FROM public.attendance
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
  AND (
    SELECT count(*) = 5
    FROM public.daily_reports
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
  AND (
    SELECT count(*) = 5
    FROM public.leaves
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
  AND (
    SELECT count(*) = 5
    FROM public.leave_balances
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  )
  AND (
    SELECT count(*) = 2
    FROM public.projects
    WHERE id IN (SELECT project_id FROM hrms_004_projects)
  )
  AND (
    SELECT count(*) = 3
    FROM public.work_entries
    WHERE id IN (
      SELECT work_entry_id FROM hrms_004_work_entries
    )
  )
  AND (
    SELECT count(*) = 3
    FROM public.break_entries
    WHERE work_entry_id IN (
      SELECT work_entry_id FROM hrms_004_work_entries
    )
  )
  AND (
    SELECT count(*) = 3
    FROM public.work_entry_audit
    WHERE work_entry_id IN (
      SELECT work_entry_id FROM hrms_004_work_entries
    )
  )
  AND (
    SELECT count(*) = 5
    FROM public.employee_work_settings
    WHERE employee_id IN (
      SELECT employee_id FROM hrms_004_actors
    )
  );

DO $$
DECLARE
  outside_id UUID;
  outside_entry_id UUID;
  outside_leave_id UUID;
  settings_changed BOOLEAN := false;
  leave_approved BOOLEAN := false;
  direct_entry_write_denied BOOLEAN := false;
  audit_write_denied BOOLEAN := false;
BEGIN
  SELECT employee_id INTO outside_id
  FROM hrms_004_actors
  WHERE actor_name = 'outside';
  SELECT work_entry_id INTO outside_entry_id
  FROM hrms_004_work_entries
  WHERE entry_name = 'outside';
  SELECT id INTO outside_leave_id
  FROM public.leaves
  WHERE employee_id = outside_id;

  PERFORM public.set_daily_report_requirements(
    outside_id,
    false,
    true
  );

  SELECT NOT bos_required AND eod_required
  INTO settings_changed
  FROM public.employee_work_settings
  WHERE employee_id = outside_id;

  PERFORM public.decide_leave_request(
    outside_leave_id,
    true,
    NULL
  );

  SELECT status = 'Approved'
  INTO leave_approved
  FROM public.leaves
  WHERE employee_id = outside_id;

  BEGIN
    INSERT INTO public.work_entries (
      employee_id,
      activity_id,
      task_description,
      started_at,
      ended_at
    )
    VALUES (
      outside_id,
      (SELECT id FROM hrms_004_activity),
      'Direct superadmin write must be denied.',
      TIMESTAMPTZ '2099-04-06 09:00:00+00',
      TIMESTAMPTZ '2099-04-06 10:00:00+00'
    );
  EXCEPTION
    WHEN OTHERS THEN
      direct_entry_write_denied := true;
  END;

  BEGIN
    DELETE FROM public.work_entry_audit
    WHERE work_entry_id = outside_entry_id;
  EXCEPTION
    WHEN OTHERS THEN
      audit_write_denied := true;
  END;

  INSERT INTO hrms_004_results (check_name, check_value)
  VALUES
    (
      'superadmin_authorised_controls',
      settings_changed
        AND leave_approved
        AND public.can_correct_work_entry(outside_entry_id)
    ),
    (
      'direct_session_and_audit_writes_denied',
      direct_entry_write_denied
        AND audit_write_denied
    );
END
$$;

RESET ROLE;

INSERT INTO hrms_004_results (check_name, check_value)
SELECT
  'all_tables_rls_enabled',
  count(*) = 15
  AND bool_and(c.relrowsecurity)
FROM pg_class c
JOIN pg_namespace n
  ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'employees',
    'attendance',
    'daily_reports',
    'leaves',
    'leave_balances',
    'holidays',
    'projects',
    'activities',
    'project_managers',
    'project_members',
    'work_entries',
    'break_entries',
    'work_entry_audit',
    'employee_work_settings',
    'daily_report_settings_audit'
  );

SELECT
  bool_and(check_value) AS all_checks_pass,
  jsonb_object_agg(
    check_name,
    check_value
    ORDER BY check_name
  ) AS checks
FROM hrms_004_results;

ROLLBACK;
