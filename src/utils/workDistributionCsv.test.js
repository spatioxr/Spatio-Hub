import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkDistributionCsv, buildDailyEmployeeCsv,
  buildOrganisationDowntimeCsv, workDistributionCsvFilename,
} from './workDistributionCsv.js';

const entry = (overrides = {}) => ({
  employee_id: 'person-1', employee_code: 'SP001', employee_name: 'Sample Person',
  employee_department: 'Design', context_type: 'project', context_label: 'Project A',
  task_description: 'Review', started_at: '2026-09-15T18:00:00Z',
  ended_at: '2026-09-15T20:00:00Z', break_seconds: 1800, worked_seconds: 5400,
  ...overrides,
});
// Fixtures without embedded newlines: inspect exported fields, not implementation details.
const rows = (csv) => csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n')
  .map((row) => [...row.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((match) => match[1].replace(/""/g, '"')));

test('work export is a rectangular table with IST dates and numeric decimal hours', () => {
  const csv = buildWorkDistributionCsv([entry(), entry({ ended_at: null, context_type: 'activity', employee_department: null })]);
  const table = rows(csv);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.equal(table.length, 3);
  assert.ok(table.every((row) => row.length === 12));
  assert.deepEqual(table[1], [
    '2026-09-15', 'SP001', 'Sample Person', 'Design', 'Project', 'Project A', 'Review',
    '2026-09-15 23:30:00', '2026-09-16 01:30:00', 'Completed', '0.50', '1.50',
  ]);
  assert.equal(table[2][3], 'Not assigned');
  assert.equal(table[2][4], 'Activity');
  assert.equal(table[2][8], '');
  assert.equal(table[2][9], 'In progress');
  assert.ok(!csv.includes('TOTALS'));
});

test('daily summary uses employee identity and IST session start date, including overnight work', () => {
  const table = rows(buildDailyEmployeeCsv([
    entry(), entry({ worked_seconds: 1800, break_seconds: 0, ended_at: null }),
    entry({ employee_id: 'person-2', employee_code: 'SP002' }),
    entry({ started_at: '2026-09-15T18:30:00Z' }),
  ]));
  assert.equal(table.length, 4);
  assert.ok(table.every((row) => row.length === 8));
  assert.deepEqual(table[1], ['2026-09-15', 'SP001', 'Sample Person', 'Design', '2', '0.50', '2.00', 'In progress']);
  assert.equal(table[2][1], 'SP002');
  assert.equal(table[3][0], '2026-09-16');
});

test('daily totals round only after aggregating seconds', () => {
  const table = rows(buildDailyEmployeeCsv(Array.from({ length: 3 }, () => entry({ worked_seconds: 12, break_seconds: 12 }))));
  assert.equal(table[1][5], '0.01');
  assert.equal(table[1][6], '0.01');
});

test('downtime is a separate uniform table with readable categories and statuses', () => {
  const table = rows(buildOrganisationDowntimeCsv([{
    title: 'Power cut', category: 'power_cut', event_status: 'active',
    started_at: '2026-08-16T04:30:00Z', ended_at: null, recorded_seconds: 5400,
    notes: 'Office supply interruption',
  }, { title: 'Maintenance', category: 'maintenance', event_status: 'scheduled', recorded_seconds: 0 }]));
  assert.equal(table.length, 3);
  assert.ok(table.every((row) => row.length === 7));
  assert.deepEqual(table[1], ['Power cut', 'Power cut', 'Active now', '2026-08-16 10:00:00', '', '1.50', 'Office supply interruption']);
  assert.equal(table[2][2], 'Scheduled');
  assert.equal(table[2][5], '0.00');
});

test('CSV preserves quotes, commas, Unicode, and multiline tasks safely', () => {
  const csv = buildWorkDistributionCsv([entry({ task_description: 'Review, "design"\nNext: café' })]);
  assert.ok(csv.includes('"Review, ""design""\nNext: café"'));
  for (const value of ['=1+1', '+1', '-1', '@SUM(A1)', '  =1', '\t=1', '\r=1', '\n=1']) {
    assert.ok(buildWorkDistributionCsv([entry({ task_description: value })]).includes(`"'${value}"`));
    assert.ok(buildOrganisationDowntimeCsv([{ title: value }]).includes(`"'${value}"`));
  }
});

test('empty exports have headers only and distinct filenames identify type and date range', () => {
  for (const builder of [buildWorkDistributionCsv, buildDailyEmployeeCsv, buildOrganisationDowntimeCsv]) {
    assert.equal(rows(builder([])).length, 1);
  }
  const range = { start: '2026-09-01', end: '2026-09-16' };
  assert.equal(workDistributionCsvFilename(range), 'spatio-work-entries_2026-09-01_to_2026-09-16.csv');
  assert.equal(workDistributionCsvFilename(range, 'daily'), 'spatio-daily-employee-summary_2026-09-01_to_2026-09-16.csv');
  assert.equal(workDistributionCsvFilename(range, 'downtime'), 'spatio-organisation-downtime_2026-09-01_to_2026-09-16.csv');
  assert.throws(() => workDistributionCsvFilename(range, 'unknown'));
});
