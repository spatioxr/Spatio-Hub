import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateLeaveDays } from './leave.js';

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
