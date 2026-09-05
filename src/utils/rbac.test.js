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
      workDistribution: false,
      managementLiveRail: false,
      approveLeave: false,
    },
    manager: {
      timesheetScope: 'assigned_projects',
      people: true,
      projects: true,
      adminSettings: false,
      workDistribution: true,
      managementLiveRail: true,
      approveLeave: false,
    },
    admin: {
      timesheetScope: 'organisation',
      people: true,
      projects: true,
      adminSettings: true,
      workDistribution: true,
      managementLiveRail: true,
      approveLeave: true,
    },
    superadmin: {
      timesheetScope: 'organisation',
      people: true,
      projects: true,
      adminSettings: true,
      workDistribution: true,
      managementLiveRail: true,
      approveLeave: true,
    },
  };

  for (const [role, access] of Object.entries(expected)) {
    const user = { id: `${role}-1`, role, status: 'Active' };

    for (const permission of [
      PERMISSIONS.ACCESS_PORTAL,
      PERMISSIONS.TRACK_OWN_WORK,
      PERMISSIONS.VIEW_ATTENDANCE,
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
      hasPermission(user, PERMISSIONS.VIEW_WORK_DISTRIBUTION),
      access.workDistribution,
      `${role}: Analytics`,
    );
    assert.equal(
      hasPermission(user, PERMISSIONS.VIEW_MANAGEMENT_LIVE_RAIL),
      access.managementLiveRail,
      `${role}: management live rail`,
    );
    assert.equal(
      hasPermission(user, PERMISSIONS.APPROVE_LEAVE),
      access.approveLeave,
      `${role}: leave review`,
    );
  }
});

test('employees cannot edit time entries or approve leave', () => {
  const employee = { id: 'employee-1', role: 'employee', status: 'Active' };

  assert.equal(hasPermission(employee, PERMISSIONS.CORRECT_SCOPED_TIME_ENTRIES), false);
  assert.equal(hasPermission(employee, PERMISSIONS.APPROVE_LEAVE), false);
  assert.equal(getTimesheetScope(employee), 'own');
});

test('managers can correct only their assigned scope and owned project teams', () => {
  const manager = { id: 'manager-1', role: 'manager', status: 'Active' };

  assert.equal(hasPermission(manager, PERMISSIONS.CORRECT_SCOPED_TIME_ENTRIES), true);
  assert.equal(getTimesheetScope(manager), 'assigned_projects');
  assert.equal(canManageProjectTeam(manager, { manager_id: 'manager-1' }), true);
  assert.equal(canManageProjectTeam(manager, { manager_id: 'manager-2' }), false);
});

test('superadmins receive privileged exception and leave permissions by default', () => {
  for (const role of ['employee', 'manager', 'admin']) {
    assert.equal(
      hasPermission({ role, status: 'Active' }, PERMISSIONS.MANAGE_BOS_EOD_EXCEPTIONS),
      false,
    );
    assert.equal(hasPermission({ role, status: 'Active' }, PERMISSIONS.APPROVE_LEAVE), role === 'admin');
  }

  assert.equal(
    hasPermission({ role: 'superadmin', status: 'Active' }, PERMISSIONS.MANAGE_BOS_EOD_EXCEPTIONS),
    true,
  );
  assert.equal(
    hasPermission({ role: 'superadmin', status: 'Active' }, PERMISSIONS.APPROVE_LEAVE),
    true,
  );
});

test('Leave Admin is an explicit capability independent from an employee role', () => {
  const leaveAdmin = {
    id: 'leave-admin-1',
    role: 'employee',
    status: 'Active',
    is_leave_admin: true,
  };

  assert.equal(hasPermission(leaveAdmin, PERMISSIONS.APPROVE_LEAVE), true);
  assert.equal(hasPermission(leaveAdmin, PERMISSIONS.MANAGE_PEOPLE), false);
  assert.equal(hasPermission(leaveAdmin, PERMISSIONS.ACCESS_ADMIN_SETTINGS), false);
  assert.equal(hasPermission(leaveAdmin, PERMISSIONS.MANAGE_BOS_EOD_EXCEPTIONS), false);
});

test('Downtime Manager is an explicit capability independent from an employee role', () => {
  const downtimeManager = {
    id: 'downtime-manager-1',
    role: 'manager',
    status: 'Active',
    is_downtime_manager: true,
  };

  assert.equal(
    hasPermission(downtimeManager, PERMISSIONS.MANAGE_ORGANISATION_DOWNTIME),
    true,
  );
  assert.equal(hasPermission(downtimeManager, PERMISSIONS.ACCESS_ADMIN_SETTINGS), false);
  assert.equal(
    hasPermission(
      { role: 'admin', status: 'Active' },
      PERMISSIONS.MANAGE_ORGANISATION_DOWNTIME,
    ),
    true,
  );
  assert.equal(
    hasPermission(
      { role: 'superadmin', status: 'Active' },
      PERMISSIONS.MANAGE_ORGANISATION_DOWNTIME,
    ),
    true,
  );
});

test('unknown roles fail closed', () => {
  assert.equal(hasPermission({ role: 'unknown', status: 'Active' }, PERMISSIONS.ACCESS_PORTAL), false);
  assert.equal(getTimesheetScope({ role: 'unknown', status: 'Active' }), 'none');
});

test('archived profiles fail closed even when they retain a privileged role', () => {
  const archivedAdmin = { id: 'admin-archived', role: 'admin', status: 'Released' };

  assert.equal(hasPermission(archivedAdmin, PERMISSIONS.ACCESS_PORTAL), false);
  assert.equal(hasPermission(archivedAdmin, PERMISSIONS.MANAGE_PEOPLE), false);
  assert.equal(getTimesheetScope(archivedAdmin), 'none');
  assert.equal(canManageProjectTeam(archivedAdmin, { manager_id: archivedAdmin.id }), false);
});
