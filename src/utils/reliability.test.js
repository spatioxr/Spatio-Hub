import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const coreFlowFiles = [
  new URL('../pages/Attendance.jsx', import.meta.url),
  new URL('../pages/Timesheets.jsx', import.meta.url),
  new URL('../pages/Projects.jsx', import.meta.url),
  new URL('../pages/Leave.jsx', import.meta.url),
  new URL('../context/LeaveContext.jsx', import.meta.url),
];

const sourceFor = (fileUrl) => readFileSync(fileUrl, 'utf8');

test('core phase-1 flows do not depend on forced page reloads', () => {
  coreFlowFiles.forEach((fileUrl) => {
    assert.doesNotMatch(sourceFor(fileUrl), /\b(?:window\.)?location\.reload\s*\(/);
  });
});

test('core phase-1 flows expose actionable error feedback', () => {
  const combinedSource = coreFlowFiles.map(sourceFor).join('\n');

  assert.match(combinedSource, /role=["']alert["']/);
  assert.match(combinedSource, />\s*Try again\s*</);
  assert.match(combinedSource, /refresh(?:Attendance|Leave|Projects|Timesheets)/);
});

test('attendance is read-only and live work actions use controlled functions', () => {
  const attendanceSource = sourceFor(coreFlowFiles[0]);
  const workSessionSource = sourceFor(new URL('../context/WorkSessionContext.jsx', import.meta.url));

  assert.doesNotMatch(attendanceSource, /\.from\(['"](?:attendance|daily_reports)['"]\)\s*\.\s*(?:insert|update|upsert|delete)\s*\(/s);

  ['start_work_day', 'switch_work_session', 'start_work_break', 'resume_work_session', 'end_work_day']
    .forEach((functionName) => {
      assert.match(workSessionSource, new RegExp(`supabase\\.rpc\\('${functionName}'`));
    });
});

test('every attendance date opens a scoped full-day work timeline', () => {
  const attendanceSource = sourceFor(coreFlowFiles[0]);

  assert.match(attendanceSource, /supabase\.rpc\('scoped_timesheet_entries'/);
  assert.match(attendanceSource, /onClick=\{\(\) => openDayDetail\(row, date, state\)\}/);
  assert.match(attendanceSource, /Full-day timeline/);
  assert.match(attendanceSource, /entry\.task_description/);
  assert.match(attendanceSource, /entry\.breaks/);
  assert.doesNotMatch(attendanceSource, /disabled=\{!hasDetail\}/);
});

test('timer restoration does not depend on task-description settings', () => {
  const workSessionSource = sourceFor(new URL('../context/WorkSessionContext.jsx', import.meta.url));

  assert.doesNotMatch(workSessionSource, /\.select\(['"]task_description_required['"]\)/);
  assert.match(workSessionSource, /Unable to load workday check-in requirements; using defaults/);
  assert.match(workSessionSource, /supabase\.rpc\('current_work_session'\)/);
});

test('a same-day return is presented as an explicit workday reopen', () => {
  const timerSource = sourceFor(new URL('../components/WorkTimerControl.jsx', import.meta.url));
  const startModalSource = sourceFor(new URL('../components/WorkStartModal.jsx', import.meta.url));
  const endModalSource = sourceFor(new URL('../components/WorkEndDayModal.jsx', import.meta.url));

  assert.match(timerSource, /isReopening = isOut && dayState\.hasWorkToday/);
  assert.match(timerSource, /Reopen day/);
  assert.match(startModalSource, /clear the earlier EOD/);
  assert.match(startModalSource, /original check-in and start-of-day plan will be preserved/);
  assert.match(endModalSource, /you can reopen today and end it again later/);
});

test('authentication tolerates the database-first rollout boundary', () => {
  const authSource = sourceFor(new URL('../context/AuthContext.jsx', import.meta.url));

  assert.match(authSource, /isMissingLeaveAdminColumn/);
  assert.match(authSource, /LEGACY_EMPLOYEE_PROFILE_FIELDS/);
  assert.match(authSource, /is_leave_admin: false/);
});

test('dashboard reconciles shared governed data and exposes live profile facts', () => {
  const dashboardSource = sourceFor(new URL('../pages/Dashboard.jsx', import.meta.url));
  const liveStatusSource = sourceFor(new URL('../components/LiveStatusBoard.jsx', import.meta.url));
  const migrationSource = sourceFor(new URL('../../supabase/migrations/20260815000600_dashboard_visual_sync.sql', import.meta.url));

  assert.match(dashboardSource, /refreshLeaveData\(false, false\)/);
  assert.match(dashboardSource, /window\.setInterval\(handleFocus, 60000\)/);
  assert.match(dashboardSource, /visibilitychange/);
  assert.match(dashboardSource, /supabase\.rpc\('current_reporting_manager'\)/);
  assert.doesNotMatch(dashboardSource, /setHolidays/);
  assert.match(liveStatusSource, /row\.avatar_url/);
  assert.match(migrationSource, /employee\.avatar_url/);
  assert.match(migrationSource, /SECURITY DEFINER/);
});
