-- HRMS-021/022 follow-up: scoped daily plans and summaries for Timesheets.
BEGIN;

CREATE FUNCTION public.scoped_daily_reviews(
  requested_start_date DATE,
  requested_end_date DATE,
  requested_scope TEXT,
  requested_employee_id UUID DEFAULT NULL
)
RETURNS TABLE (
  employee_id UUID, employee_name TEXT, employee_code TEXT,
  employee_department TEXT, report_date DATE,
  bos_report TEXT, eod_report TEXT,
  bos_submitted_at TIMESTAMPTZ, eod_submitted_at TIMESTAMPTZ,
  bos_required BOOLEAN, eod_required BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF requested_scope IS NULL OR requested_scope NOT IN ('personal', 'managed', 'organisation') THEN
    RAISE EXCEPTION 'Choose a valid timesheet scope';
  END IF;
  IF requested_start_date IS NULL OR requested_end_date IS NULL
    OR requested_end_date < requested_start_date
    OR requested_end_date - requested_start_date > 30 THEN
    RAISE EXCEPTION 'Choose a date range of at most 31 days';
  END IF;

  -- Reuse role validation and membership, and the daily_reports RLS predicate.
  -- Only recorded days are returned; do not infer absences on leave/weekends.
  RETURN QUERY
  SELECT member.employee_id, member.employee_name, member.employee_code,
    member.employee_department, days.day,
    report.bos_report, report.eod_report, report.bos_submitted_at, report.eod_submitted_at,
    COALESCE(settings.bos_required, true), COALESCE(settings.eod_required, true)
  FROM public.timesheet_scope_members(requested_scope) member
  CROSS JOIN LATERAL (
    SELECT report.date AS day FROM public.daily_reports report
      WHERE report.employee_id = member.employee_id
        AND report.date BETWEEN requested_start_date AND requested_end_date
    UNION
    SELECT attendance.date FROM public.attendance attendance
      WHERE attendance.employee_id = member.employee_id
        AND attendance.date BETWEEN requested_start_date AND requested_end_date
        AND attendance.check_in IS NOT NULL
    UNION
    SELECT (entry.started_at AT TIME ZONE 'Asia/Kolkata')::date
      FROM public.work_entries entry
      WHERE entry.employee_id = member.employee_id AND entry.voided_at IS NULL
        AND entry.started_at >= (requested_start_date::timestamp AT TIME ZONE 'Asia/Kolkata')
        AND entry.started_at < ((requested_end_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
  ) days
  LEFT JOIN public.daily_reports report
    ON report.employee_id = member.employee_id AND report.date = days.day
  LEFT JOIN public.employee_work_settings settings ON settings.employee_id = member.employee_id
  WHERE member.employee_status = 'Active'
    AND public.can_access_employee(member.employee_id)
    AND (requested_employee_id IS NULL OR member.employee_id = requested_employee_id)
  ORDER BY days.day DESC, member.employee_name, member.employee_id;
END;
$$;

REVOKE ALL ON FUNCTION public.scoped_daily_reviews(DATE, DATE, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scoped_daily_reviews(DATE, DATE, TEXT, UUID) TO authenticated;
COMMIT;
