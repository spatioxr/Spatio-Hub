import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateLeaveDays, canReviewLeave, filterLeaveHistory, previewBalanceAdjustment } from './leave.js';

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

test('admins, superadmins and designated Leave Admins can review organisation leave', () => {
  assert.equal(canReviewLeave({ role: 'employee', status: 'Active' }), false);
  assert.equal(canReviewLeave({ role: 'employee', status: 'Active', is_leave_admin: true }), true);
  assert.equal(canReviewLeave({ role: 'manager', status: 'Active' }), false);
  assert.equal(canReviewLeave({ role: 'admin', status: 'Active' }), true);
  assert.equal(canReviewLeave({ role: 'head', status: 'Active' }), true);
  assert.equal(canReviewLeave({ role: 'superadmin', status: 'Active' }), true);
  assert.equal(canReviewLeave({ role: 'employee', status: 'Released', is_leave_admin: true }), false);
});


test('balance preview supports half-day additions and prevents overdrafts and invalid input', () => {
  assert.deepEqual(previewBalanceAdjustment('4', '0.5', 'add'), { current: 4, delta: 0.5, remaining: 4.5, valid: true });
  assert.deepEqual(previewBalanceAdjustment(4, 4, 'remove'), { current: 4, delta: -4, remaining: 0, valid: true });
  assert.equal(previewBalanceAdjustment(4, 4.5, 'remove').valid, false);
  for (const amount of ['', 0, -1, 0.25, 'NaN', Infinity]) assert.equal(previewBalanceAdjustment(4, amount, 'add'), null);
  assert.equal(previewBalanceAdjustment(undefined, 1, 'add'), null);
  assert.equal(previewBalanceAdjustment(4, 1, 'unknown'), null);
});

test('leave history filters overlap inclusively, combine filters and retain statuses', () => {
  const requests = [
    { id: 1, employee_name: 'Asha', employee_code: 'E01', employee_department: 'Design', status: 'Approved', from_date: '2026-09-01', to_date: '2026-09-05', days: 5 },
    { id: 2, employee_name: 'Asha', employee_code: 'E01', status: 'Pending', from_date: '2026-09-10', to_date: '2026-09-10', days: 0.5 },
    { id: 3, employee_name: 'Ben', employee_code: 'E02', status: 'Rejected', from_date: '2026-08-31', to_date: '2026-08-31', days: 1 },
  ];
  assert.deepEqual(filterLeaveHistory(requests, { search: ' e01 ', status: 'Approved', from: '2026-09-05', to: '2026-09-06' }), [requests[0]]);
  assert.deepEqual(filterLeaveHistory(requests, { search: 'DESIGN' }), [requests[0]]);
  assert.deepEqual(filterLeaveHistory(requests, { from: '2026-09-06' }), [requests[1]]);
  assert.deepEqual(filterLeaveHistory(requests, { to: '2026-08-31' }), [requests[2]]);
  assert.deepEqual(filterLeaveHistory(requests, { from: '2026-09-06', to: '2026-09-01' }), []);
  assert.deepEqual(filterLeaveHistory(requests, {}), requests);
});
