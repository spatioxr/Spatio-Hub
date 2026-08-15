export const ATTENDANCE_DAY_STATES = Object.freeze({
  NOT_APPLICABLE: 'not_applicable',
  FUTURE: 'future',
  HOLIDAY: 'holiday',
  WEEKEND: 'weekend',
  LEAVE: 'leave',
  HALF_LEAVE_WORKED: 'half_leave_worked',
  WORKING: 'working',
  COMPLETED: 'completed',
  NO_RECORD: 'no_record',
});

export const resolveAttendanceDayState = (row, today) => {
  if (!row) return ATTENDANCE_DAY_STATES.NO_RECORD;
  if (row.is_employment_day === false) return ATTENDANCE_DAY_STATES.NOT_APPLICABLE;
  if (row.holiday_id) return ATTENDANCE_DAY_STATES.HOLIDAY;
  if (row.is_weekend) return ATTENDANCE_DAY_STATES.WEEKEND;
  if (Number(row.leave_fraction) === 0.5 && Number(row.worked_seconds) > 0) {
    return ATTENDANCE_DAY_STATES.HALF_LEAVE_WORKED;
  }
  if (Number(row.leave_fraction) > 0) return ATTENDANCE_DAY_STATES.LEAVE;
  if (row.attendance_date > today) return ATTENDANCE_DAY_STATES.FUTURE;
  if (row.has_open_session) return ATTENDANCE_DAY_STATES.WORKING;
  if (row.checked_out_at || Number(row.worked_seconds) > 0) {
    return ATTENDANCE_DAY_STATES.COMPLETED;
  }
  return ATTENDANCE_DAY_STATES.NO_RECORD;
};

export const summarizeAttendanceMonth = (rows, today) => rows.reduce((summary, row) => {
  const state = resolveAttendanceDayState(row, today);
  if (row.is_working_day && row.attendance_date <= today) summary.workingDays += 1;
  if (state === ATTENDANCE_DAY_STATES.COMPLETED) summary.completedDays += 1;
  if (state === ATTENDANCE_DAY_STATES.WORKING) summary.activeDays += 1;
  if ([ATTENDANCE_DAY_STATES.LEAVE, ATTENDANCE_DAY_STATES.HALF_LEAVE_WORKED].includes(state)) {
    summary.leaveDays += Number(row.leave_fraction || 0);
  }
  if (state === ATTENDANCE_DAY_STATES.HOLIDAY) summary.holidays += 1;
  if (state === ATTENDANCE_DAY_STATES.NO_RECORD && row.is_working_day && row.attendance_date < today) {
    summary.noRecordDays += 1;
  }
  if (row.is_late === true) summary.lateDays += 1;
  return summary;
}, {
  workingDays: 0,
  completedDays: 0,
  activeDays: 0,
  leaveDays: 0,
  holidays: 0,
  noRecordDays: 0,
  lateDays: 0,
});
