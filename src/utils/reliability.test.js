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
  assert.match(combinedSource, />\s*Refresh data\s*</);
});

test('work-tracking writes check every Supabase result before refreshing', () => {
  const attendanceSource = sourceFor(coreFlowFiles[0]);

  [
    'existingAttendanceError',
    'attendanceUpdateError',
    'attendanceInsertError',
    'existingReportError',
    'reportUpdateError',
    'reportInsertError',
  ].forEach((errorName) => {
    assert.match(attendanceSource, new RegExp(`if \\(${errorName}\\) throw ${errorName}`));
  });

  assert.match(attendanceSource, /const refreshResult = await fetchData\(\)/);
});
