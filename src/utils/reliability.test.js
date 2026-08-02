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

test('attendance is read-only and live work actions use controlled functions', () => {
  const attendanceSource = sourceFor(coreFlowFiles[0]);
  const workSessionSource = sourceFor(new URL('../context/WorkSessionContext.jsx', import.meta.url));

  assert.doesNotMatch(attendanceSource, /\.from\(['"](?:attendance|daily_reports)['"]\)\s*\.\s*(?:insert|update|upsert|delete)\s*\(/s);

  ['start_work_day', 'switch_work_session', 'start_work_break', 'resume_work_session', 'end_work_day']
    .forEach((functionName) => {
      assert.match(workSessionSource, new RegExp(`supabase\\.rpc\\('${functionName}'`));
    });
});
