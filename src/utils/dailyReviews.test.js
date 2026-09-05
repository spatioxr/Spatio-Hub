import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDailyReviews, reportSubmissionStatus } from './dailyReviews.js';

test('submitted report takes precedence over current exemption settings', () => {
  assert.equal(reportSubmissionStatus({ bos_report: 'Plan', bos_required: false }, 'bos'), 'Submitted');
});
test('cleared EOD after reopening becomes pending and never reuses a timestamp', () => {
  assert.equal(reportSubmissionStatus({ eod_report: null, eod_submitted_at: null, eod_required: true }, 'eod'), 'Pending');
});
test('missing reports distinguish current exemptions from pending submissions', () => {
  assert.equal(reportSubmissionStatus({ bos_report: null, bos_required: false }, 'bos'), 'Currently exempt');
  assert.equal(reportSubmissionStatus({ bos_report: ' ', bos_required: true }, 'bos'), 'Pending');
});
test('period review preserves report-only days, and person/department/day selection narrows records', () => {
  const rows = [
    { employee_id: 'a', employee_department: 'Design', report_date: '2026-09-01', bos_report: 'Plan' },
    { employee_id: 'a', employee_department: 'Design', report_date: '2026-09-02', eod_report: 'Done' },
    { employee_id: 'b', employee_department: 'Engineering', report_date: '2026-09-01' },
  ];
  assert.equal(filterDailyReviews(rows, { employeeId: 'a' }).length, 2);
  assert.deepEqual(filterDailyReviews(rows, { employeeId: 'all', department: 'Design', date: '2026-09-02' }), [rows[1]]);
  assert.deepEqual(filterDailyReviews(rows, { employeeId: 'b', department: 'Design' }), []);
  assert.deepEqual(filterDailyReviews(rows, { date: '2026-09-03' }), []);
});
