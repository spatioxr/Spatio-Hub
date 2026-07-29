-- HRMS-028 rollback-only activity-administration verification.
-- Expected result: all_checks_pass and every value in checks are true.

BEGIN;

CREATE TEMP TABLE hrms_028_bootstrap_actor AS
SELECT id AS employee_id, auth_id
FROM public.employees
WHERE role = 'superadmin'
  AND status = 'Active'
LIMIT 1;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_028_bootstrap_actor actor;

CREATE TEMP TABLE hrms_028_actor AS
WITH inserted_auth AS (
  INSERT INTO auth.users (id, email)
  VALUES (
    gen_random_uuid(),
    'hrms028-actor@verification.invalid'
  )
  RETURNING id, email
),
inserted AS (
  INSERT INTO public.employees (
    emp_code,
    auth_id,
    name,
    email,
    department,
    role,
    status
  )
  SELECT
    'HRMS028ACTOR',
    auth_user.id,
    'HRMS-028 Verification Actor',
    auth_user.email,
    'Verification',
    'superadmin',
    'Active'
  FROM inserted_auth auth_user
  RETURNING id AS employee_id, auth_id
)
SELECT * FROM inserted;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', actor.auth_id::text,
    'role', 'authenticated'
  )::text,
  true
)
FROM hrms_028_actor actor;

CREATE TEMP TABLE hrms_028_results (
  superadmin_create_allowed BOOLEAN NOT NULL DEFAULT false,
  admin_create_allowed BOOLEAN NOT NULL DEFAULT false,
  admin_edit_allowed BOOLEAN NOT NULL DEFAULT false,
  admin_archive_allowed BOOLEAN NOT NULL DEFAULT false,
  superadmin_restore_allowed BOOLEAN NOT NULL DEFAULT false,
  manager_overview_denied BOOLEAN NOT NULL DEFAULT false,
  manager_create_denied BOOLEAN NOT NULL DEFAULT false,
  manager_edit_denied BOOLEAN NOT NULL DEFAULT false,
  manager_archive_denied BOOLEAN NOT NULL DEFAULT false,
  employee_overview_denied BOOLEAN NOT NULL DEFAULT false,
  employee_create_denied BOOLEAN NOT NULL DEFAULT false,
  employee_edit_denied BOOLEAN NOT NULL DEFAULT false,
  employee_archive_denied BOOLEAN NOT NULL DEFAULT false,
  active_activities_selectable BOOLEAN NOT NULL DEFAULT false,
  archived_activity_reportable BOOLEAN NOT NULL DEFAULT false,
  historical_name_change_denied BOOLEAN NOT NULL DEFAULT false,
  historical_description_edit_allowed BOOLEAN NOT NULL DEFAULT false,
  direct_authenticated_writes_denied BOOLEAN NOT NULL DEFAULT false,
  administration_rpcs_exist BOOLEAN NOT NULL DEFAULT false,
  seeded_catalogue_complete BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO hrms_028_results DEFAULT VALUES;

CREATE TEMP TABLE hrms_028_superadmin_activity AS
SELECT activity.*
FROM public.create_activity(
  '  HRMS-028 Superadmin Activity  ',
  'Created by the rollback-only HRMS-028 verification.'
) AS activity;

UPDATE hrms_028_results
SET superadmin_create_allowed = (
  SELECT name = 'HRMS-028 Superadmin Activity'
  FROM hrms_028_superadmin_activity
);

ALTER TABLE public.employees DISABLE TRIGGER guard_employee_self_update;
UPDATE public.employees
SET role = 'admin'
WHERE id = (SELECT employee_id FROM hrms_028_actor);
ALTER TABLE public.employees ENABLE TRIGGER guard_employee_self_update;

CREATE TEMP TABLE hrms_028_admin_activity AS
SELECT activity.*
FROM public.create_activity(
  'HRMS-028 Admin Activity',
  'Created by an Admin through the controlled RPC.'
) AS activity;

CREATE TEMP TABLE hrms_028_admin_edited AS
SELECT updated.*
FROM hrms_028_admin_activity activity
CROSS JOIN LATERAL public.update_activity_definition(
  activity.id,
  'HRMS-028 Admin Activity Edited',
  'Edited by an Admin through the controlled RPC.'
) AS updated;

CREATE TEMP TABLE hrms_028_admin_archived AS
SELECT archived.*
FROM hrms_028_admin_activity activity
CROSS JOIN LATERAL public.set_activity_archived(
  activity.id,
  true
) AS archived;

UPDATE hrms_028_results
SET admin_create_allowed = EXISTS (
      SELECT 1 FROM hrms_028_admin_activity
    ),
    admin_edit_allowed = (
      SELECT name = 'HRMS-028 Admin Activity Edited'
        AND description = 'Edited by an Admin through the controlled RPC.'
      FROM hrms_028_admin_edited
    ),
    admin_archive_allowed = (
      SELECT archived_at IS NOT NULL
      FROM hrms_028_admin_archived
    );

ALTER TABLE public.employees DISABLE TRIGGER guard_employee_self_update;
UPDATE public.employees
SET role = 'superadmin'
WHERE id = (SELECT employee_id FROM hrms_028_actor);
ALTER TABLE public.employees ENABLE TRIGGER guard_employee_self_update;

CREATE TEMP TABLE hrms_028_superadmin_restored AS
SELECT restored.*
FROM hrms_028_admin_activity activity
CROSS JOIN LATERAL public.set_activity_archived(
  activity.id,
  false
) AS restored;

UPDATE hrms_028_results
SET superadmin_restore_allowed = (
  SELECT archived_at IS NULL
  FROM hrms_028_superadmin_restored
);

INSERT INTO public.work_entries (
  employee_id,
  activity_id,
  task_description,
  started_at,
  ended_at
)
SELECT
  actor.employee_id,
  activity.id,
  'Verify archived activity history remains reportable.',
  '1900-02-01 09:00:00+00'::timestamptz,
  '1900-02-01 10:00:00+00'::timestamptz
FROM hrms_028_actor actor
CROSS JOIN hrms_028_superadmin_activity activity;

SELECT public.set_activity_archived(activity.id, true)
FROM hrms_028_superadmin_activity activity;

DO $$
DECLARE
  historical_activity_id UUID;
BEGIN
  SELECT id INTO historical_activity_id
  FROM hrms_028_superadmin_activity;

  BEGIN
    PERFORM public.update_activity_definition(
      historical_activity_id,
      'HRMS-028 Changed Historical Name',
      'This operation must fail before changing either field.'
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_028_results
    SET historical_name_change_denied = true;
  END;

  PERFORM public.update_activity_definition(
    historical_activity_id,
    'HRMS-028 Superadmin Activity',
    'Description remains editable after historical use.'
  );

  UPDATE hrms_028_results
  SET historical_description_edit_allowed = EXISTS (
    SELECT 1
    FROM public.activities activity
    WHERE activity.id = historical_activity_id
      AND activity.description =
        'Description remains editable after historical use.'
  );
END
$$;

ALTER TABLE public.employees DISABLE TRIGGER guard_employee_self_update;
UPDATE public.employees
SET role = 'manager'
WHERE id = (SELECT employee_id FROM hrms_028_actor);
ALTER TABLE public.employees ENABLE TRIGGER guard_employee_self_update;

DO $$
DECLARE
  target_activity_id UUID;
BEGIN
  SELECT id INTO target_activity_id FROM hrms_028_admin_activity;

  BEGIN
    PERFORM public.activity_administration_overview();
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_028_results SET manager_overview_denied = true;
  END;

  BEGIN
    PERFORM public.create_activity(
      'HRMS-028 Manager Denied',
      'Manager creation must fail.'
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_028_results SET manager_create_denied = true;
  END;

  BEGIN
    PERFORM public.update_activity_definition(
      target_activity_id,
      'HRMS-028 Manager Edit Denied',
      'Manager editing must fail.'
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_028_results SET manager_edit_denied = true;
  END;

  BEGIN
    PERFORM public.set_activity_archived(target_activity_id, true);
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_028_results SET manager_archive_denied = true;
  END;
END
$$;

ALTER TABLE public.employees DISABLE TRIGGER guard_employee_self_update;
UPDATE public.employees
SET role = 'employee'
WHERE id = (SELECT employee_id FROM hrms_028_actor);
ALTER TABLE public.employees ENABLE TRIGGER guard_employee_self_update;

DO $$
DECLARE
  target_activity_id UUID;
BEGIN
  SELECT id INTO target_activity_id FROM hrms_028_admin_activity;

  BEGIN
    PERFORM public.activity_administration_overview();
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_028_results SET employee_overview_denied = true;
  END;

  BEGIN
    PERFORM public.create_activity(
      'HRMS-028 Employee Denied',
      'Employee creation must fail.'
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_028_results SET employee_create_denied = true;
  END;

  BEGIN
    PERFORM public.update_activity_definition(
      target_activity_id,
      'HRMS-028 Employee Edit Denied',
      'Employee editing must fail.'
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_028_results SET employee_edit_denied = true;
  END;

  BEGIN
    PERFORM public.set_activity_archived(target_activity_id, true);
  EXCEPTION WHEN OTHERS THEN
    UPDATE hrms_028_results SET employee_archive_denied = true;
  END;
END
$$;

UPDATE hrms_028_results
SET active_activities_selectable = (
      SELECT count(*) >= 6
      FROM public.activities activity
      WHERE activity.archived_at IS NULL
    ),
    archived_activity_reportable = EXISTS (
      SELECT 1
      FROM public.work_entries entry
      JOIN public.activities activity
        ON activity.id = entry.activity_id
      JOIN hrms_028_superadmin_activity historical
        ON historical.id = activity.id
      WHERE activity.archived_at IS NOT NULL
        AND activity.name = 'HRMS-028 Superadmin Activity'
    ),
    direct_authenticated_writes_denied =
      NOT has_table_privilege(
        'authenticated',
        'public.activities',
        'INSERT'
      )
      AND NOT has_table_privilege(
        'authenticated',
        'public.activities',
        'UPDATE'
      )
      AND NOT has_table_privilege(
        'authenticated',
        'public.activities',
        'DELETE'
      ),
    administration_rpcs_exist =
      to_regprocedure(
        'public.activity_administration_overview()'
      ) IS NOT NULL
      AND to_regprocedure(
        'public.update_activity_definition(uuid,text,text)'
      ) IS NOT NULL
      AND to_regprocedure(
        'public.create_activity(text,text)'
      ) IS NOT NULL
      AND to_regprocedure(
        'public.set_activity_archived(uuid,boolean)'
      ) IS NOT NULL,
    seeded_catalogue_complete = (
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
    );

SELECT
  (
    SELECT bool_and(check_value::boolean)
    FROM hrms_028_results result
    CROSS JOIN LATERAL jsonb_each_text(to_jsonb(result)) check_item(
      check_name,
      check_value
    )
  ) AS all_checks_pass,
  to_jsonb(result) AS checks
FROM hrms_028_results result;

ROLLBACK;
