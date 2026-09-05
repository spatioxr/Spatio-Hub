import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDailyReviews, reportSubmissionStatus, buildDayTimeline, missingReportSummary } from './dailyReviews.js';

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

test('timeline orders actual submissions alongside work and breaks, with plan first on a tie', () => {
  const entries = [{ work_entry_id: 'work', started_at: '2026-09-05T03:30:00Z', worked_seconds: 28800,
    breaks: [{ id: 'pause', started_at: '2026-09-05T07:00:00Z', duration_seconds: 1800 }] }];
  const reports = [{ employee_id: 'a', report_date: '2026-09-05', bos_report: 'Plan',
    bos_submitted_at: entries[0].started_at, eod_report: 'Done', eod_submitted_at: '2026-09-05T12:30:00Z' }];
  const events = buildDayTimeline(entries, reports);
  assert.deepEqual(events.map((event) => event.type), ['bos', 'session', 'break', 'eod']);
  assert.equal(events[1].entry, entries[0]);
  assert.equal(entries[0].worked_seconds, 28800);
  assert.equal(events[2].pause.duration_seconds, 1800);
});

test('pending and exempt reports are status text, never fabricated timestamped events', () => {
  const reports = [{ employee_id: 'a', bos_required: true, eod_required: false }];
  assert.deepEqual(buildDayTimeline([], reports), []);
  assert.equal(missingReportSummary(reports), 'Start-of-day plan: pending · End-of-day summary: currently exempt');
  assert.equal(missingReportSummary([]), '');
});

test('reports without sessions remain visible, and missing timestamps are not invented', () => {
  const report = { employee_id: 'a', report_date: '2026-09-05', bos_report: 'Imported plan',
    eod_report: 'Done', eod_submitted_at: '2026-09-05T12:00:00Z' };
  const events = buildDayTimeline([], [report]);
  assert.deepEqual(events.map((event) => event.type), ['eod', 'bos']);
  assert.equal(events[1].at, undefined);
});

test('reopened workday omits cleared EOD; late submissions use actual submission time', () => {
  const entry = { work_entry_id: 'work', started_at: '2026-09-05T03:30:00Z' };
  const report = { employee_id: 'a', report_date: '2026-09-05', bos_report: 'Plan', bos_submitted_at: '2026-09-05T03:31:00Z', eod_report: null };
  assert.deepEqual(buildDayTimeline([entry], [report]).map((event) => event.type), ['session', 'bos']);
});
