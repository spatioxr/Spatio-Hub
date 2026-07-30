import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canManageProjectTeam,
  getTimesheetScope,
  hasPermission,
  PERMISSIONS,
} from './rbac.js';

test('employees cannot edit time entries or approve leave', () => {
  const employee = { id: 'employee-1', role: 'employee' };

  assert.equal(hasPermission(employee, PERMISSIONS.CORRECT_SCOPED_TIME_ENTRIES), false);
  assert.equal(hasPermission(employee, PERMISSIONS.APPROVE_LEAVE), false);
  assert.equal(getTimesheetScope(employee), 'own');
});

test('managers can correct only their assigned scope and owned project teams', () => {
  const manager = { id: 'manager-1', role: 'manager' };

  assert.equal(hasPermission(manager, PERMISSIONS.CORRECT_SCOPED_TIME_ENTRIES), true);
  assert.equal(getTimesheetScope(manager), 'assigned_projects');
  assert.equal(canManageProjectTeam(manager, { manager_id: 'manager-1' }), true);
  assert.equal(canManageProjectTeam(manager, { manager_id: 'manager-2' }), false);
});

test('only superadmins receive privileged exception and leave permissions', () => {
  for (const role of ['employee', 'manager', 'admin']) {
    assert.equal(
      hasPermission({ role }, PERMISSIONS.MANAGE_BOS_EOD_EXCEPTIONS),
      false,
    );
    assert.equal(hasPermission({ role }, PERMISSIONS.APPROVE_LEAVE), false);
  }

  assert.equal(
    hasPermission({ role: 'superadmin' }, PERMISSIONS.MANAGE_BOS_EOD_EXCEPTIONS),
    true,
  );
  assert.equal(
    hasPermission({ role: 'superadmin' }, PERMISSIONS.APPROVE_LEAVE),
    true,
  );
});

test('unknown roles fail closed', () => {
  assert.equal(hasPermission({ role: 'unknown' }, PERMISSIONS.ACCESS_PORTAL), false);
  assert.equal(getTimesheetScope({ role: 'unknown' }), 'none');
});
