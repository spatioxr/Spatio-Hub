import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateLeaveDays, canReviewLeave } from './leave.js';

test('whole-day leave counts working days and excludes weekends', () => {
  assert.equal(calculateLeaveDays('2026-07-30', '2026-07-30'), 1);
  assert.equal(calculateLeaveDays('2026-07-30', '2026-08-01'), 2);
  assert.equal(calculateLeaveDays('2026-08-01', '2026-08-02'), 0);
});

test('company holidays are excluded from leave duration', () => {
  assert.equal(
    calculateLeaveDays('2026-07-30', '2026-08-03', false, [{ date: '2026-07-31' }]),
    2,
  );
});

test('half-day leave remains exact and requires one working date', () => {
  assert.equal(calculateLeaveDays('2026-07-30', '2026-07-30', true), 0.5);
  assert.equal(calculateLeaveDays('2026-07-30', '2026-07-31', true), 0);
  assert.equal(calculateLeaveDays('2026-08-01', '2026-08-01', true), 0);
});

test('invalid date order has no positive duration', () => {
  assert.equal(calculateLeaveDays('2026-07-31', '2026-07-30'), 0);
});

test('superadmins and designated Leave Admins can review organisation leave', () => {
  assert.equal(canReviewLeave({ role: 'employee', status: 'Active' }), false);
  assert.equal(canReviewLeave({ role: 'employee', status: 'Active', is_leave_admin: true }), true);
  assert.equal(canReviewLeave({ role: 'manager', status: 'Active' }), false);
  assert.equal(canReviewLeave({ role: 'admin', status: 'Active' }), false);
  assert.equal(canReviewLeave({ role: 'head', status: 'Active' }), false);
  assert.equal(canReviewLeave({ role: 'superadmin', status: 'Active' }), true);
  assert.equal(canReviewLeave({ role: 'employee', status: 'Released', is_leave_admin: true }), false);
});
