import assert from 'node:assert/strict';
import test from 'node:test';
import { liveStatusTimeDetails } from './liveStatus.js';

const checkedInAt = '2026-08-15T03:42:00Z';

test('working status shows only the original daily check-in', () => {
  assert.deepEqual(liveStatusTimeDetails({
    attendanceAvailable: true,
    checkedInAt,
    workStatus: 'In',
  }), [
    { label: 'Checked in', value: checkedInAt },
  ]);
});

test('break status adds the active break time without a context-switch time', () => {
  const breakStartedAt = '2026-08-15T08:00:00Z';

  assert.deepEqual(liveStatusTimeDetails({
    attendanceAvailable: true,
    breakStartedAt,
    checkedInAt,
    workStatus: 'Break',
  }), [
    { label: 'Checked in', value: checkedInAt },
    { label: 'Break since', value: breakStartedAt },
  ]);
});

test('out status adds the daily check-out time', () => {
  const checkedOutAt = '2026-08-15T12:50:00Z';

  assert.deepEqual(liveStatusTimeDetails({
    attendanceAvailable: true,
    checkedInAt,
    checkedOutAt,
    workStatus: 'Out',
  }), [
    { label: 'Checked in', value: checkedInAt },
    { label: 'Checked out', value: checkedOutAt },
  ]);
});

test('no recorded attendance is distinct from an unavailable projection field', () => {
  assert.deepEqual(liveStatusTimeDetails({
    attendanceAvailable: true,
    checkedInAt: null,
    workStatus: 'Out',
  }), [
    { label: 'No activity today', value: null },
  ]);

  assert.deepEqual(liveStatusTimeDetails({
    attendanceAvailable: false,
    checkedInAt: null,
    workStatus: 'In',
  }), [
    { label: 'Attendance time unavailable', value: null },
  ]);
});
