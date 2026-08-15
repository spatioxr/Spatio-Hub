import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldShowStatusSince,
  statusSinceLabel,
} from './liveStatus.js';

test('an initial work session shows only the daily check-in time', () => {
  assert.equal(shouldShowStatusSince({
    firstCheckInAt: '2026-08-15T03:30:00Z',
    statusStartedAt: '2026-08-15T03:30:00Z',
    workStatus: 'In',
  }), false);
});

test('a switched context keeps check-in separate from current context time', () => {
  assert.equal(shouldShowStatusSince({
    firstCheckInAt: '2026-08-15T03:30:00Z',
    statusStartedAt: '2026-08-15T07:00:00Z',
    workStatus: 'In',
  }), true);
  assert.equal(statusSinceLabel('In'), 'Context since');
});

test('break and out states identify when the current state started', () => {
  assert.equal(shouldShowStatusSince({
    firstCheckInAt: '2026-08-15T03:30:00Z',
    statusStartedAt: '2026-08-15T08:00:00Z',
    workStatus: 'Break',
  }), true);
  assert.equal(statusSinceLabel('Break'), 'Break since');
  assert.equal(statusSinceLabel('Out'), 'Out since');
});

test('an employee with no recorded state does not show a since time', () => {
  assert.equal(shouldShowStatusSince({
    firstCheckInAt: null,
    statusStartedAt: null,
    workStatus: 'Out',
  }), false);
});
