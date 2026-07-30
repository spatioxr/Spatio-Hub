import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateLeaveDays, canReviewLeave } from './leave.js';

test('whole-day leave counts both calendar endpoints', () => {
  assert.equal(calculateLeaveDays('2026-07-30', '2026-07-30'), 1);
  assert.equal(calculateLeaveDays('2026-07-30', '2026-08-01'), 3);
});

test('half-day leave remains exact and requires one calendar date', () => {
  assert.equal(calculateLeaveDays('2026-07-30', '2026-07-30', true), 0.5);
  assert.equal(calculateLeaveDays('2026-07-30', '2026-07-31', true), 0);
});

test('invalid date order has no positive duration', () => {
  assert.equal(calculateLeaveDays('2026-07-31', '2026-07-30'), 0);
});

test('only superadmins can review organisation leave', () => {
  assert.equal(canReviewLeave({ role: 'employee' }), false);
  assert.equal(canReviewLeave({ role: 'manager' }), false);
  assert.equal(canReviewLeave({ role: 'admin' }), false);
  assert.equal(canReviewLeave({ role: 'head' }), false);
  assert.equal(canReviewLeave({ role: 'superadmin' }), true);
});
