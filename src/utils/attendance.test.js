import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATTENDANCE_DAY_STATES,
  resolveAttendanceDayState,
  summarizeAttendanceMonth,
} from './attendance.js';

const today = '2026-08-15';

test('attendance day states keep non-working and approved leave facts explicit', () => {
  assert.equal(
    resolveAttendanceDayState({ is_employment_day: false }, today),
    ATTENDANCE_DAY_STATES.NOT_APPLICABLE,
  );
  assert.equal(resolveAttendanceDayState({ holiday_id: 'holiday-1' }, today), ATTENDANCE_DAY_STATES.HOLIDAY);
  assert.equal(resolveAttendanceDayState({ is_weekend: true }, today), ATTENDANCE_DAY_STATES.WEEKEND);
  assert.equal(
    resolveAttendanceDayState({ leave_fraction: 1, attendance_date: '2026-08-13' }, today),
    ATTENDANCE_DAY_STATES.LEAVE,
  );
  assert.equal(
    resolveAttendanceDayState({ leave_fraction: 0.5, worked_seconds: 7200 }, today),
    ATTENDANCE_DAY_STATES.HALF_LEAVE_WORKED,
  );
});

test('attendance distinguishes active, completed, future and missing records', () => {
  assert.equal(
    resolveAttendanceDayState({ attendance_date: '2026-08-15', has_open_session: true }, today),
    ATTENDANCE_DAY_STATES.WORKING,
  );
  assert.equal(
    resolveAttendanceDayState({ attendance_date: '2026-08-14', worked_seconds: 3600 }, today),
    ATTENDANCE_DAY_STATES.COMPLETED,
  );
  assert.equal(
    resolveAttendanceDayState({ attendance_date: '2026-08-16' }, today),
    ATTENDANCE_DAY_STATES.FUTURE,
  );
  assert.equal(
    resolveAttendanceDayState({ attendance_date: '2026-08-14' }, today),
    ATTENDANCE_DAY_STATES.NO_RECORD,
  );
});

test('monthly summary only counts elapsed working days and factual exceptions', () => {
  const rows = [
    { attendance_date: '2026-08-10', is_working_day: true, worked_seconds: 3600, is_late: true },
    { attendance_date: '2026-08-11', is_working_day: true, leave_fraction: 1 },
    { attendance_date: '2026-08-12', is_working_day: true },
    { attendance_date: '2026-08-13', is_working_day: true, leave_fraction: 0.5, worked_seconds: 1800 },
    { attendance_date: '2026-08-16', is_working_day: false, holiday_id: 'holiday-1' },
    { attendance_date: '2026-08-17', is_working_day: true },
  ];

  assert.deepEqual(summarizeAttendanceMonth(rows, today), {
    workingDays: 4,
    completedDays: 1,
    activeDays: 0,
    leaveDays: 1.5,
    holidays: 1,
    noRecordDays: 1,
    lateDays: 1,
  });
});
