import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkDistributionCsv } from './workDistributionCsv.js';

test('analytics CSV exports organisation downtime separately from worked totals', () => {
  const csv = buildWorkDistributionCsv([], {
    sessions: 0,
    employees: 0,
    breakSeconds: 0,
    workedSeconds: 0,
    downtimeSeconds: 5400,
  }, [{
    title: 'Power cut',
    category: 'power_cut',
    event_status: 'completed',
    started_at: '2026-08-16T04:30:00.000Z',
    ended_at: '2026-08-16T06:00:00.000Z',
    recorded_seconds: 5400,
    notes: 'Office supply interruption',
  }]);

  assert.match(csv, /ORGANISATION DOWNTIME/);
  assert.match(csv, /Power cut/);
  assert.match(csv, /DOWNTIME TOTAL/);
  assert.match(csv, /1h 30m/);
});
