import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canManageProjectTeam,
  getTimesheetScope,
  hasPermission,
  PERMISSIONS,
} from './rbac.js';

test('launch navigation and actions match the complete four-role matrix', () => {
  const expected = {
    employee: {
      timesheetScope: 'own',
      people: false,
      projects: false,
      adminSettings: false,
      organisationReports: false,
      approveLeave: false,
    },
    manager: {
      timesheetScope: 'assigned_projects',
      people: true,
      projects: true,
      adminSettings: false,
      organisationReports: false,
      approveLeave: false,
    },
    admin: {
      timesheetScope: 'organisation',
      people: true,
      projects: true,
      adminSettings: true,
      organisationReports: true,
      approveLeave: false,
    },
    superadmin: {
      timesheetScope: 'organisation',
      people: true,
      projects: true,
      adminSettings: true,
      organisationReports: true,
      approveLeave: true,
    },
  };

  for (const [role, access] of Object.entries(expected)) {
    const user = { id: `${role}-1`, role };

    for (const permission of [
      PERMISSIONS.ACCESS_PORTAL,
      PERMISSIONS.TRACK_OWN_WORK,
      PERMISSIONS.VIEW_OWN_TIMESHEET,
      PERMISSIONS.APPLY_OWN_LEAVE,
    ]) {
      assert.equal(hasPermission(user, permission), true, `${role}: ${permission}`);
    }

    assert.equal(getTimesheetScope(user), access.timesheetScope, `${role}: timesheet scope`);
    assert.equal(hasPermission(user, PERMISSIONS.VIEW_PEOPLE), access.people, `${role}: People`);
    assert.equal(
      hasPermission(user, PERMISSIONS.MANAGE_OWNED_PROJECT_TEAM),
      access.projects,
      `${role}: Projects`,
    );
    assert.equal(
      hasPermission(user, PERMISSIONS.ACCESS_ADMIN_SETTINGS),
      access.adminSettings,
      `${role}: Admin Settings`,
    );
    assert.equal(
      hasPermission(user, PERMISSIONS.VIEW_ORGANISATION_REPORTS),
      access.organisationReports,
      `${role}: Analytics`,
    );
    assert.equal(
      hasPermission(user, PERMISSIONS.APPROVE_LEAVE),
      access.approveLeave,
      `${role}: leave review`,
    );
  }
});

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
