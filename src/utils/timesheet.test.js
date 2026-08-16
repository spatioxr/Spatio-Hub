import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateKeysInRange,
  monthBounds,
  nextManualEntryRange,
  suggestedBreakRange,
  summarizeEmployeesForMonth,
  summarizeTimesheetDays,
} from './timesheet.js';

test('monthBounds returns exact inclusive month boundaries', () => {
  assert.deepEqual(monthBounds('2026-02-18'), {
    year: 2026,
    month: 2,
    start: '2026-02-01',
    end: '2026-02-28',
    days: 28,
  });
  assert.equal(monthBounds('2024-02-18').end, '2024-02-29');
});

test('dateKeysInRange includes both endpoints', () => {
  assert.deepEqual(dateKeysInRange('2026-08-30', '2026-09-02'), [
    '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
  ]);
});

test('summarizeTimesheetDays totals work and break seconds', () => {
  const summaries = summarizeTimesheetDays([
    { started_at: '2026-08-12T03:30:00Z', ended_at: '2026-08-12T07:30:00Z', worked_seconds: 12600, break_seconds: 1800 },
    { started_at: '2026-08-12T08:30:00Z', ended_at: null, worked_seconds: 900, break_seconds: 0 },
  ], ['2026-08-12', '2026-08-13']);
  assert.deepEqual(summaries['2026-08-12'], {
    workedSeconds: 13500,
    breakSeconds: 1800,
    sessionCount: 2,
    hasOpenSession: true,
  });
  assert.equal(summaries['2026-08-13'].sessionCount, 0);
});

test('summarizeEmployeesForMonth keeps zero-entry members and ranks worked time', () => {
  const members = [
    { employee_id: 'a', employee_name: 'Asha' },
    { employee_id: 'b', employee_name: 'Binu' },
  ];
  const summaries = summarizeEmployeesForMonth([
    { employee_id: 'b', started_at: '2026-08-04T03:30:00Z', ended_at: '2026-08-04T11:30:00Z', worked_seconds: 27000, break_seconds: 1800 },
  ], members);
  assert.equal(summaries[0].employee_id, 'b');
  assert.equal(summaries[0].activeDays, 1);
  assert.equal(summaries[1].workedSeconds, 0);
});

test('nextManualEntryRange follows the latest completed entry on the selected day', () => {
  assert.deepEqual(nextManualEntryRange('2026-08-12', [
    { ended_at: '2026-08-12T07:30:00Z' },
    { ended_at: '2026-08-12T10:00:00Z' },
  ]), {
    startedAt: '2026-08-12T15:30',
    endedAt: '2026-08-12T16:30',
  });
});

test('suggestedBreakRange creates a positive break inside the entry', () => {
  assert.deepEqual(suggestedBreakRange('2026-08-12T09:00', '2026-08-12T17:00'), {
    startedAt: '2026-08-12T12:45',
    endedAt: '2026-08-12T13:15',
  });
});
