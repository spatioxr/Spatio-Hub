import test from 'node:test';
import assert from 'node:assert/strict';
import {
  downtimeCategoryLabel,
  formatDowntimeDuration,
  sumDowntimeSeconds,
  validateDowntimeRange,
} from './downtime.js';

test('downtime totals remain separate and ignore invalid negative values', () => {
  assert.equal(sumDowntimeSeconds([
    { recorded_seconds: 3600 },
    { recorded_seconds: '1800' },
    { recorded_seconds: -900 },
  ]), 5400);
  assert.equal(formatDowntimeDuration(5400), '1h 30m');
});

test('downtime categories have safe display labels', () => {
  assert.equal(downtimeCategoryLabel('power_cut'), 'Power cut');
  assert.equal(downtimeCategoryLabel('unexpected'), 'Other');
});

test('downtime ranges require a positive completed interval', () => {
  assert.equal(validateDowntimeRange('2026-08-16T10:00:00Z', '2026-08-16T11:00:00Z'), '');
  assert.match(
    validateDowntimeRange('2026-08-16T11:00:00Z', '2026-08-16T10:00:00Z'),
    /after the start/i,
  );
  assert.match(validateDowntimeRange('invalid', 'also-invalid'), /valid start/i);
});
