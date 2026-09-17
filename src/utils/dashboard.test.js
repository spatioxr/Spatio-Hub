import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceCompletionRate,
  dashboardLeaveAvailability,
  holidayCalendarMonth,
  shiftCalendarMonth,
  leaveBalanceSeries,
  workdayPresentation,
} from './dashboard.js';

test('holiday calendar starts on Monday and includes leap day and adjacent months', () => {
  const holidays = [
    { id: 'one', date: '2024-02-29', name: 'Leap day' },
    { id: 'two', date: '2024-02-29', name: 'Second holiday' },
  ];
  const days = holidayCalendarMonth('2024-02-01', holidays);
  assert.equal(days.length, 42);
  assert.equal(days[0].date, '2024-01-29');
  assert.equal(days[0].inMonth, false);
  assert.equal(days.filter((day) => day.inMonth).length, 29);
  assert.deepEqual(days.find((day) => day.date === '2024-02-29').holidays, holidays);
  assert.equal(holidayCalendarMonth('2026-06-01')[0].date, '2026-06-01');
  assert.equal(holidayCalendarMonth('2026-02-01')[0].date, '2026-01-26');
});

test('holiday month navigation crosses years without carrying the day of month', () => {
  assert.equal(shiftCalendarMonth('2026-12-01', 1), '2027-01-01');
  assert.equal(shiftCalendarMonth('2027-01-01', -1), '2026-12-01');
  assert.equal(shiftCalendarMonth('2026-01-31', 1), '2026-02-01');
});

test('availability separates ongoing leave from future approvals and excludes other statuses', () => {
  const request = (id, from, to, status = 'Approved') => ({ id, from_date: from, to_date: to, status });
  const requests = [
    request('later', '2027-01-05', '2027-01-06'),
    request('ends-today', '2026-12-29', '2026-12-31'),
    request('tomorrow', '2027-01-01', '2027-01-01'),
    request('starts-today', '2026-12-31', '2027-01-02'),
    request('past', '2026-12-28', '2026-12-30'),
    request('pending', '2027-01-01', '2027-01-01', 'Pending'),
    request('rejected', '2027-01-01', '2027-01-01', 'Rejected'),
    request('cancelled', '2027-01-01', '2027-01-01', 'Cancelled'),
    request('missing-date', null, null),
    request('reversed', '2027-01-06', '2027-01-01'),
  ];
  const original = structuredClone(requests);
  const result = dashboardLeaveAvailability(requests, '2026-12-31');
  assert.deepEqual(result.today.map(({ id }) => id), ['ends-today', 'starts-today']);
  assert.deepEqual(result.upcoming.map(({ id }) => id), ['tomorrow', 'later']);
  assert.deepEqual(requests, original);
});

test('availability retains half-day details and supports empty and legacy requests', () => {
  const halfDay = { id: 'half', from: '2026-09-18', to: '2026-09-18', status: 'Approved', is_half_day: true };
  assert.deepEqual(dashboardLeaveAvailability([halfDay], '2026-09-17'), { today: [], upcoming: [halfDay] });
  assert.deepEqual(dashboardLeaveAvailability([], '2026-09-17'), { today: [], upcoming: [] });
});

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
