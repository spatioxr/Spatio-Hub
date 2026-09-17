import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveCostingBaseline, latestCostingBaselines } from './costingSettings.js';

test('costing defaults only when no change is effective for the selected month', () => {
  const history = [{ id: 1, effective_month: '2026-10-01', monthly_hours: 160 }];
  assert.equal(effectiveCostingBaseline(history, '2026-09').monthly_hours, 176);
  assert.equal(effectiveCostingBaseline(history, '2026-10').monthly_hours, 160);
  assert.equal(effectiveCostingBaseline(history, '2027-01').monthly_hours, 160);
});
test('latest revision wins without future settings replacing the current baseline', () => {
  const history = [
    { id: 9, effective_month: '2026-08-01', monthly_hours: 160 },
    { id: 10, effective_month: '2026-08-01', monthly_hours: 168 },
    { id: 11, effective_month: '2026-12-01', monthly_hours: 180 },
    { id: 2, effective_month: '2026-04-01', monthly_hours: 150 },
  ];
  assert.equal(effectiveCostingBaseline(history, '2026-09').monthly_hours, 168);
  assert.equal(effectiveCostingBaseline(history, '2026-05').monthly_hours, 150);
  assert.equal(effectiveCostingBaseline(history, '2026-12').monthly_hours, 180);
  assert.deepEqual(latestCostingBaselines(history).map((row) => row.id), [11, 10, 2]);
  assert.equal(history[0].id, 9);
});
test('many future scheduled changes cannot hide the current saved value', () => {
  const history = Array.from({ length: 25 }, (_, i) => ({ id: i + 2, effective_month: `${2030 + i}-01-01`, monthly_hours: 180 }));
  history.push({ id: 1, effective_month: '2025-01-01', monthly_hours: 144 });
  assert.equal(effectiveCostingBaseline(history, '2026-09').monthly_hours, 144);
});
