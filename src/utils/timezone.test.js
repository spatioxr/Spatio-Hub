import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addAppDays,
  appDateKey,
  appDateTimeInputToIso,
  appDayRange,
  formatAppDate,
  formatAppClock,
  toAppDateTimeInput,
} from './timezone.js';

test('Asia/Kolkata owns the calendar boundary around UTC midnight shifts', () => {
  assert.equal(appDateKey('2026-07-29T18:29:59Z'), '2026-07-29');
  assert.equal(appDateKey('2026-07-29T18:30:00Z'), '2026-07-30');
});

test('calendar arithmetic is independent of the browser and DST transitions', () => {
  assert.equal(addAppDays('2026-03-07', 1), '2026-03-08');
  assert.equal(addAppDays('2026-11-01', 1), '2026-11-02');
  assert.deepEqual(appDayRange('2026-07-30', '2026-07-30'), {
    start: '2026-07-29T18:30:00.000Z',
    end: '2026-07-30T18:30:00.000Z',
  });
});

test('clocks use explicit 12-hour AM/PM display in Asia/Kolkata', () => {
  assert.equal(formatAppClock('2026-07-29T18:30:00Z'), '12:00 AM');
  assert.equal(formatAppClock('2026-07-30T06:30:00Z'), '12:00 PM');
});

test('manual entry values round-trip between IST inputs and safe UTC timestamps', () => {
  const timestamp = appDateTimeInputToIso('2026-07-30T09:15');
  assert.equal(timestamp, '2026-07-30T03:45:00.000Z');
  assert.equal(toAppDateTimeInput(timestamp), '2026-07-30T09:15');
});

test('date-only holidays retain their intended India calendar date', () => {
  assert.equal(formatAppDate('2026-01-26'), '26 Jan 2026');
  assert.equal(
    formatAppDate('2026-01-26', {
      weekday: 'long',
      day: undefined,
      month: undefined,
      year: undefined,
    }),
    'Monday',
  );
});
