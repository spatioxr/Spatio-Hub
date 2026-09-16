import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPermission, PERMISSIONS } from './rbac.js';
import {
  observerAttendanceLabel,
  summarizeObserverWork,
  validObserverRange,
} from './observer.js';

test('Observers receive only portal and reporting access, even with forged staff capabilities', () => {
  const observer = {
    role: 'observer',
    status: 'Active',
    is_leave_admin: true,
    is_downtime_manager: true,
  };
  for (const permission of Object.values(PERMISSIONS)) {
    assert.equal(
      hasPermission(observer, permission),
      [PERMISSIONS.ACCESS_PORTAL, PERMISSIONS.VIEW_OBSERVER_HUB].includes(
        permission,
      ),
      permission,
    );
    assert.equal(
      hasPermission({ ...observer, status: 'Released' }, permission),
      false,
    );
  }
  for (const role of ['employee', 'manager', 'admin']) {
    assert.equal(
      hasPermission(
        { role, status: 'Active' },
        PERMISSIONS.MANAGE_EXTERNAL_ACCESS,
      ),
      false,
    );
  }
  assert.equal(
    hasPermission(
      { role: 'superadmin', status: 'Active' },
      PERMISSIONS.MANAGE_EXTERNAL_ACCESS,
    ),
    true,
  );
});

test('Observer range accepts at most 31 inclusive calendar days', () => {
  assert.equal(validObserverRange('2026-09-01', '2026-10-01'), true);
  assert.equal(validObserverRange('2026-09-01', '2026-10-02'), false);
  assert.equal(validObserverRange('2026-09-02', '2026-09-01'), false);
  assert.equal(validObserverRange('', '2026-09-01'), false);
});

test('Work summaries exclude unresolved timers and keep same-name contexts separate', () => {
  const groups = summarizeObserverWork([
    {
      context_type: 'project',
      project_id: 'p1',
      context_name: 'Design',
      worked_seconds: 3600,
    },
    {
      context_type: 'project',
      project_id: 'p1',
      context_name: 'Design',
      worked_seconds: 100000,
      stale: true,
    },
    { context_type: 'activity', context_name: 'Design', worked_seconds: 1800 },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].seconds, 3600);
  assert.equal(groups[0].unresolved, 1);
  assert.equal(groups[1].seconds, 1800);
});

test('Attendance distinguishes no record, recorded absence, leave and partial-day work', () => {
  const day = { date: '2026-09-16' };
  assert.equal(observerAttendanceLabel(day), 'No record');
  assert.equal(
    observerAttendanceLabel({ ...day, status: 'Absent' }),
    'Recorded absent',
  );
  assert.equal(
    observerAttendanceLabel({ ...day, approved_leave: true }),
    'Approved leave',
  );
  assert.equal(
    observerAttendanceLabel({
      ...day,
      approved_leave: true,
      check_in: '09:00:00',
    }),
    'Recorded work · approved leave',
  );
  assert.equal(observerAttendanceLabel(day, [{ date: day.date }]), 'Holiday');
  assert.equal(observerAttendanceLabel({ date: '2026-09-19' }), 'Weekend');
});
