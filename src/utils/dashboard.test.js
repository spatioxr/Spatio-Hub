import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceCompletionRate,
  leaveBalanceSeries,
  workdayPresentation,
} from './dashboard.js';

test('dashboard attendance completion is bounded and handles empty months', () => {
  assert.equal(attendanceCompletionRate({ workingDays: 0, completedDays: 0 }), 0);
  assert.equal(attendanceCompletionRate({ workingDays: 10, completedDays: 8 }), 80);
  assert.equal(attendanceCompletionRate({ workingDays: 2, completedDays: 4 }), 100);
});

test('dashboard leave bars reflect live used, remaining and pending balances', () => {
  const series = leaveBalanceSeries({
    'Sick Leave': { used: 3, remaining: 7, pending: 1 },
    'Casual Leave': { used: 0, remaining: 4, pending: 0 },
  });

  assert.deepEqual(series[0], {
    type: 'Sick Leave',
    icon: 'ri-heart-pulse-line',
    used: 3,
    remaining: 7,
    pending: 1,
    usedPercent: 30,
  });
  assert.equal(series[1].usedPercent, 0);
  assert.equal(series[2].remaining, 0);
});

test('dashboard workday messaging follows the live timer lifecycle', () => {
  assert.equal(workdayPresentation('working', false, 'XR101').title, 'Working now');
  assert.equal(workdayPresentation('break', true, 'XR101').title, 'Taking a break');
  assert.equal(workdayPresentation('out', true, '').title, 'Workday complete');
  assert.equal(workdayPresentation('out', false, '').title, 'Ready when you are');
});
