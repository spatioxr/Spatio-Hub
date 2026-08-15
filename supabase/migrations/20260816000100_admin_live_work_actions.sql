-- Feedback tracker SI32: allow admins to operate the live timer for an active
-- employee from Who's in/out. Every action is server-authorised and audited.

BEGIN;

CREATE TABLE public.admin_work_action_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  acted_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('start', 'reopen', 'switch', 'break', 'resume', 'end_day')),
  work_entry_id UUID REFERENCES public.work_entries(id) ON DELETE RESTRICT,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  acted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX admin_work_action_audit_employee_time_idx
  ON public.admin_work_action_audit (employee_id, acted_at DESC);

ALTER TABLE public.admin_work_action_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_work_action_audit FROM anon;
GRANT SELECT ON TABLE public.admin_work_action_audit TO authenticated;

CREATE POLICY admin_work_action_audit_select_admin
  ON public.admin_work_action_audit FOR SELECT TO authenticated
  USING (public.has_organisation_access());

REVOKE INSERT, UPDATE, DELETE ON TABLE public.admin_work_action_audit
  FROM authenticated;

CREATE OR REPLACE FUNCTION public.prevent_admin_work_action_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Admin work action audit history is immutable';
END;
$$;

CREATE TRIGGER admin_work_action_audit_prevent_mutation
  BEFORE UPDATE OR DELETE ON public.admin_work_action_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_admin_work_action_audit_mutation();

CREATE OR REPLACE FUNCTION public.can_admin_manage_live_work(target_employee_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.current_employee_role() IN ('admin', 'superadmin')
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = target_employee_id
        AND employee.status = 'Active'
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_employee_work_state(target_employee_id UUID)
RETURNS TABLE (
  employee_id UUID,
  employee_name TEXT,
  work_status TEXT,
  work_entry_id UUID,
  project_id UUID,
  activity_id UUID,
  task_description TEXT,
  context_label TEXT,
  started_at TIMESTAMPTZ,
  break_entry_id UUID,
  break_started_at TIMESTAMPTZ,
  report_date DATE,
  bos_required BOOLEAN,
  eod_required BOOLEAN,
  bos_submitted BOOLEAN,
  eod_submitted BOOLEAN,
  has_work_today BOOLEAN,
  work_mode TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET TimeZone = 'Asia/Kolkata'
AS $$
DECLARE
  work_date DATE := current_date;
BEGIN
  IF NOT public.can_admin_manage_live_work(target_employee_id) THEN
    RAISE EXCEPTION 'Only admins can manage another employee''s live work status';
  END IF;

  RETURN QUERY
  SELECT
    employee.id,
    employee.name,
    CASE
      WHEN open_entry.id IS NULL THEN 'Out'
      WHEN active_break.id IS NOT NULL THEN 'Break'
      ELSE 'In'
    END,
    open_entry.id,
    open_entry.project_id,
    open_entry.activity_id,
    open_entry.task_description,
    CASE
      WHEN open_entry.project_id IS NOT NULL THEN concat_ws(' · ', project.code, project.name)
      WHEN open_entry.activity_id IS NOT NULL THEN activity.name
      ELSE NULL
    END,
    open_entry.started_at,
    active_break.id,
    active_break.started_at,
    work_date,
    COALESCE(settings.bos_required, true),
    COALESCE(settings.eod_required, true),
    report.bos_submitted_at IS NOT NULL,
    report.eod_submitted_at IS NOT NULL,
    EXISTS (
      SELECT 1 FROM public.work_entries entry
      WHERE entry.employee_id = employee.id
        AND entry.started_at >= public.app_day_start(work_date)
        AND entry.started_at < public.app_day_start(work_date + 1)
    ),
    attendance.work_mode
  FROM public.employees employee
  LEFT JOIN LATERAL (
    SELECT entry.*
    FROM public.work_entries entry
    WHERE entry.employee_id = employee.id AND entry.ended_at IS NULL
    ORDER BY entry.started_at DESC
    LIMIT 1
  ) open_entry ON true
  LEFT JOIN LATERAL (
    SELECT break_entry.*
    FROM public.break_entries break_entry
    WHERE break_entry.work_entry_id = open_entry.id AND break_entry.ended_at IS NULL
    ORDER BY break_entry.started_at DESC
    LIMIT 1
  ) active_break ON true
  LEFT JOIN public.projects project ON project.id = open_entry.project_id
  LEFT JOIN public.activities activity ON activity.id = open_entry.activity_id
  LEFT JOIN public.employee_work_settings settings ON settings.employee_id = employee.id
  LEFT JOIN public.daily_reports report
    ON report.employee_id = employee.id AND report.date = work_date
  LEFT JOIN public.attendance attendance
    ON attendance.employee_id = employee.id AND attendance.date = work_date
  WHERE employee.id = target_employee_id AND employee.status = 'Active';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_employee_work_contexts(target_employee_id UUID)
RETURNS TABLE (context_type TEXT, context_id UUID, context_code TEXT, context_name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_admin_manage_live_work(target_employee_id) THEN
    RAISE EXCEPTION 'Only admins can view another employee''s work choices';
  END IF;

  RETURN QUERY
  SELECT 'project'::TEXT, project.id, project.code, project.name
  FROM public.projects project
  WHERE project.archived_at IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.project_members member
        WHERE member.project_id = project.id AND member.employee_id = target_employee_id
      )
      OR EXISTS (
        SELECT 1 FROM public.project_managers manager
        WHERE manager.project_id = project.id AND manager.employee_id = target_employee_id
      )
      OR EXISTS (
        SELECT 1 FROM public.employees employee
        WHERE employee.id = target_employee_id
          AND employee.role IN ('admin', 'superadmin')
      )
    )
  UNION ALL
  SELECT 'activity'::TEXT, activity.id, NULL::TEXT, activity.name
  FROM public.activities activity
  WHERE activity.archived_at IS NULL
  ORDER BY 1, 4;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_start_work_day(
  target_employee_id UUID,
  target_project_id UUID,
  target_activity_id UUID,
  beginning_of_day_report TEXT,
  declared_work_mode TEXT
)
RETURNS public.work_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET TimeZone = 'Asia/Kolkata'
AS $$
DECLARE
  actor_employee_id UUID := public.current_employee_id();
  work_date DATE := current_date;
  require_bos BOOLEAN := true;
  bos_already_submitted BOOLEAN := false;
  eod_already_submitted BOOLEAN := false;
  worked_today BOOLEAN := false;
  normalised_work_mode TEXT := lower(btrim(declared_work_mode));
  created_session public.work_entries;
  existing_work_mode TEXT;
BEGIN
  IF NOT public.can_admin_manage_live_work(target_employee_id) THEN
    RAISE EXCEPTION 'Only admins can start work for another employee';
  END IF;
  IF (target_project_id IS NOT NULL) = (target_activity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Select exactly one project or internal activity';
  END IF;
  IF normalised_work_mode IS NULL OR normalised_work_mode NOT IN ('office', 'wfh') THEN
    RAISE EXCEPTION 'Choose Office or WFH before starting the workday';
  END IF;
  IF target_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.admin_employee_work_contexts(target_employee_id) context
    WHERE context.context_type = 'project' AND context.context_id = target_project_id
  ) THEN
    RAISE EXCEPTION 'The selected project is unavailable or not assigned';
  END IF;
  IF target_activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.activities activity
    WHERE activity.id = target_activity_id AND activity.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'The selected internal activity is unavailable';
  END IF;

  PERFORM 1 FROM public.employees employee
  WHERE employee.id = target_employee_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.work_entries entry WHERE entry.employee_id = target_employee_id AND entry.ended_at IS NULL) THEN
    RAISE EXCEPTION 'End or switch the current work session before starting another';
  END IF;

  SELECT COALESCE(settings.bos_required, true)
  INTO require_bos
  FROM (SELECT 1) seed
  LEFT JOIN public.employee_work_settings settings ON settings.employee_id = target_employee_id;

  SELECT report.bos_submitted_at IS NOT NULL, report.eod_submitted_at IS NOT NULL
  INTO bos_already_submitted, eod_already_submitted
  FROM public.daily_reports report
  WHERE report.employee_id = target_employee_id AND report.date = work_date;

  bos_already_submitted := COALESCE(bos_already_submitted, false);
  eod_already_submitted := COALESCE(eod_already_submitted, false);
  SELECT EXISTS (
    SELECT 1 FROM public.work_entries entry
    WHERE entry.employee_id = target_employee_id
      AND entry.started_at >= public.app_day_start(work_date)
      AND entry.started_at < public.app_day_start(work_date + 1)
  ) INTO worked_today;

  IF NOT worked_today AND NOT bos_already_submitted AND require_bos
    AND COALESCE(length(btrim(beginning_of_day_report)), 0) = 0 THEN
    RAISE EXCEPTION 'Beginning-of-day report is required before starting work';
  END IF;

  IF NOT worked_today AND NOT bos_already_submitted
    AND COALESCE(length(btrim(beginning_of_day_report)), 0) > 0 THEN
    INSERT INTO public.daily_reports (employee_id, date, bos_report)
    VALUES (target_employee_id, work_date, btrim(beginning_of_day_report))
    ON CONFLICT (employee_id, date) DO UPDATE SET bos_report = EXCLUDED.bos_report
    WHERE public.daily_reports.bos_submitted_at IS NULL;
  END IF;

  INSERT INTO public.work_entries (employee_id, project_id, activity_id, task_description, started_at)
  VALUES (target_employee_id, target_project_id, target_activity_id, '', clock_timestamp())
  RETURNING * INTO created_session;

  IF eod_already_submitted THEN
    UPDATE public.daily_reports SET eod_report = NULL
    WHERE employee_id = target_employee_id AND date = work_date AND eod_submitted_at IS NOT NULL;
  END IF;

  SELECT attendance.work_mode INTO existing_work_mode
  FROM public.attendance attendance
  WHERE attendance.employee_id = target_employee_id AND attendance.date = work_date;

  INSERT INTO public.attendance (employee_id, date, check_in, check_out, status, work_mode)
  VALUES (
    target_employee_id,
    work_date,
    public.app_clock_time(created_session.started_at),
    NULL,
    CASE WHEN public.app_clock_time(created_session.started_at) >= TIME '10:30' THEN 'Late' ELSE 'Present' END,
    COALESCE(existing_work_mode, normalised_work_mode)
  )
  ON CONFLICT (employee_id, date) DO UPDATE
  SET check_in = COALESCE(public.attendance.check_in, EXCLUDED.check_in),
      check_out = NULL,
      status = COALESCE(public.attendance.status, EXCLUDED.status),
      work_mode = COALESCE(public.attendance.work_mode, EXCLUDED.work_mode);

  INSERT INTO public.admin_work_action_audit (employee_id, acted_by, action, work_entry_id, details)
  VALUES (
    target_employee_id,
    actor_employee_id,
    CASE WHEN worked_today THEN 'reopen' ELSE 'start' END,
    created_session.id,
    jsonb_build_object('project_id', target_project_id, 'activity_id', target_activity_id, 'work_mode', COALESCE(existing_work_mode, normalised_work_mode))
  );
  RETURN created_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_switch_work_session(
  target_employee_id UUID,
  target_project_id UUID,
  target_activity_id UUID,
  session_task_description TEXT
)
RETURNS public.work_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_employee_id UUID := public.current_employee_id();
  current_session public.work_entries;
  created_session public.work_entries;
  switched_at TIMESTAMPTZ;
BEGIN
  IF NOT public.can_admin_manage_live_work(target_employee_id) THEN RAISE EXCEPTION 'Only admins can switch work for another employee'; END IF;
  IF (target_project_id IS NOT NULL) = (target_activity_id IS NOT NULL) THEN RAISE EXCEPTION 'Select exactly one project or internal activity'; END IF;
  IF COALESCE(length(btrim(session_task_description)), 0) = 0 THEN RAISE EXCEPTION 'Task description is required when switching work context'; END IF;
  IF target_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.admin_employee_work_contexts(target_employee_id) context
    WHERE context.context_type = 'project' AND context.context_id = target_project_id
  ) THEN RAISE EXCEPTION 'The selected project is unavailable or not assigned'; END IF;
  IF target_activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.activities activity WHERE activity.id = target_activity_id AND activity.archived_at IS NULL
  ) THEN RAISE EXCEPTION 'The selected internal activity is unavailable'; END IF;

  SELECT entry.* INTO current_session
  FROM public.work_entries entry
  WHERE entry.employee_id = target_employee_id AND entry.ended_at IS NULL
  ORDER BY entry.started_at DESC LIMIT 1 FOR UPDATE;
  IF current_session.id IS NULL THEN RAISE EXCEPTION 'Start work before switching context'; END IF;
  IF current_session.project_id IS NOT DISTINCT FROM target_project_id
    AND current_session.activity_id IS NOT DISTINCT FROM target_activity_id THEN
    RAISE EXCEPTION 'Choose a different project or internal activity';
  END IF;
  IF EXISTS (SELECT 1 FROM public.break_entries break_entry WHERE break_entry.work_entry_id = current_session.id AND break_entry.ended_at IS NULL) THEN
    RAISE EXCEPTION 'Resume from break before switching work context';
  END IF;

  switched_at := clock_timestamp();
  UPDATE public.work_entries SET ended_at = switched_at WHERE id = current_session.id AND ended_at IS NULL;
  INSERT INTO public.work_entries (employee_id, project_id, activity_id, task_description, started_at)
  VALUES (target_employee_id, target_project_id, target_activity_id, btrim(session_task_description), switched_at)
  RETURNING * INTO created_session;
  INSERT INTO public.admin_work_action_audit (employee_id, acted_by, action, work_entry_id, details)
  VALUES (target_employee_id, actor_employee_id, 'switch', created_session.id, jsonb_build_object('from_work_entry_id', current_session.id, 'project_id', target_project_id, 'activity_id', target_activity_id));
  RETURN created_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_start_work_break(target_employee_id UUID)
RETURNS public.break_entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor_employee_id UUID := public.current_employee_id();
  active_entry_id UUID;
  created_break public.break_entries;
BEGIN
  IF NOT public.can_admin_manage_live_work(target_employee_id) THEN RAISE EXCEPTION 'Only admins can start a break for another employee'; END IF;
  SELECT entry.id INTO active_entry_id FROM public.work_entries entry
  WHERE entry.employee_id = target_employee_id AND entry.ended_at IS NULL
  ORDER BY entry.started_at DESC LIMIT 1 FOR UPDATE;
  IF active_entry_id IS NULL THEN RAISE EXCEPTION 'Start work before starting a break'; END IF;
  IF EXISTS (SELECT 1 FROM public.break_entries break_entry WHERE break_entry.work_entry_id = active_entry_id AND break_entry.ended_at IS NULL) THEN
    RAISE EXCEPTION 'A break is already active';
  END IF;
  INSERT INTO public.break_entries (work_entry_id, started_at) VALUES (active_entry_id, clock_timestamp()) RETURNING * INTO created_break;
  INSERT INTO public.admin_work_action_audit (employee_id, acted_by, action, work_entry_id)
  VALUES (target_employee_id, actor_employee_id, 'break', active_entry_id);
  RETURN created_break;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_resume_work_session(target_employee_id UUID)
RETURNS public.break_entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor_employee_id UUID := public.current_employee_id();
  resumed_break public.break_entries;
  active_entry_id UUID;
BEGIN
  IF NOT public.can_admin_manage_live_work(target_employee_id) THEN RAISE EXCEPTION 'Only admins can resume work for another employee'; END IF;
  SELECT entry.id INTO active_entry_id
  FROM public.work_entries entry
  WHERE entry.employee_id = target_employee_id AND entry.ended_at IS NULL
  ORDER BY entry.started_at DESC LIMIT 1 FOR UPDATE;
  UPDATE public.break_entries break_entry SET ended_at = clock_timestamp()
  WHERE break_entry.work_entry_id = active_entry_id AND break_entry.ended_at IS NULL
  RETURNING break_entry.* INTO resumed_break;
  IF resumed_break.id IS NULL THEN RAISE EXCEPTION 'No active break to resume from'; END IF;
  INSERT INTO public.admin_work_action_audit (employee_id, acted_by, action, work_entry_id)
  VALUES (target_employee_id, actor_employee_id, 'resume', active_entry_id);
  RETURN resumed_break;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_end_work_day(
  target_employee_id UUID,
  target_work_entry_id UUID,
  end_of_day_report TEXT
)
RETURNS public.work_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET TimeZone = 'Asia/Kolkata'
AS $$
DECLARE
  actor_employee_id UUID := public.current_employee_id();
  work_date DATE := current_date;
  require_eod BOOLEAN := true;
  eod_already_submitted BOOLEAN := false;
  current_session public.work_entries;
  ended_session public.work_entries;
BEGIN
  IF NOT public.can_admin_manage_live_work(target_employee_id) THEN RAISE EXCEPTION 'Only admins can end work for another employee'; END IF;
  PERFORM 1 FROM public.employees employee WHERE employee.id = target_employee_id FOR UPDATE;
  SELECT entry.* INTO current_session FROM public.work_entries entry
  WHERE entry.id = target_work_entry_id AND entry.employee_id = target_employee_id AND entry.ended_at IS NULL FOR UPDATE;
  IF current_session.id IS NULL THEN RAISE EXCEPTION 'Open work session not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.break_entries break_entry WHERE break_entry.work_entry_id = current_session.id AND break_entry.ended_at IS NULL) THEN
    RAISE EXCEPTION 'Resume from break before ending the work day';
  END IF;
  SELECT COALESCE(settings.eod_required, true) INTO require_eod
  FROM (SELECT 1) seed LEFT JOIN public.employee_work_settings settings ON settings.employee_id = target_employee_id;
  SELECT report.eod_submitted_at IS NOT NULL INTO eod_already_submitted
  FROM public.daily_reports report WHERE report.employee_id = target_employee_id AND report.date = work_date;
  eod_already_submitted := COALESCE(eod_already_submitted, false);
  IF NOT eod_already_submitted AND require_eod AND COALESCE(length(btrim(end_of_day_report)), 0) = 0 THEN
    RAISE EXCEPTION 'End-of-day report is required before ending the work day';
  END IF;
  IF NOT eod_already_submitted AND COALESCE(length(btrim(end_of_day_report)), 0) > 0 THEN
    INSERT INTO public.daily_reports (employee_id, date, eod_report)
    VALUES (target_employee_id, work_date, btrim(end_of_day_report))
    ON CONFLICT (employee_id, date) DO UPDATE SET eod_report = EXCLUDED.eod_report
    WHERE public.daily_reports.eod_submitted_at IS NULL;
  END IF;
  UPDATE public.work_entries SET ended_at = clock_timestamp()
  WHERE id = current_session.id AND employee_id = target_employee_id AND ended_at IS NULL
  RETURNING * INTO ended_session;
  INSERT INTO public.attendance (employee_id, date, check_in, check_out, status, work_mode)
  VALUES (
    target_employee_id,
    work_date,
    public.app_clock_time(current_session.started_at),
    public.app_clock_time(ended_session.ended_at),
    CASE WHEN public.app_clock_time(current_session.started_at) >= TIME '10:30' THEN 'Late' ELSE 'Present' END,
    'office'
  )
  ON CONFLICT (employee_id, date) DO UPDATE
  SET check_out = EXCLUDED.check_out;
  INSERT INTO public.admin_work_action_audit (employee_id, acted_by, action, work_entry_id)
  VALUES (target_employee_id, actor_employee_id, 'end_day', ended_session.id);
  RETURN ended_session;
END;
$$;

REVOKE ALL ON FUNCTION public.can_admin_manage_live_work(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_admin_work_action_audit_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_employee_work_state(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_employee_work_contexts(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_start_work_day(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_switch_work_session(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_start_work_break(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_resume_work_session(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_end_work_day(UUID, UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_admin_manage_live_work(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_employee_work_state(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_employee_work_contexts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_start_work_day(UUID, UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_switch_work_session(UUID, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_start_work_break(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resume_work_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_end_work_day(UUID, UUID, TEXT) TO authenticated;

COMMIT;
