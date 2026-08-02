export const ROLES = Object.freeze({
  EMPLOYEE: 'employee',
  MANAGER: 'manager',
  ADMIN: 'admin',
  SUPERADMIN: 'superadmin',
});

// Temporary read compatibility for pre-phase-1 records. New records must use
// only the four canonical roles above.
const LEGACY_ROLE_ALIASES = Object.freeze({
  pm: ROLES.MANAGER,
  head: ROLES.ADMIN,
});

export const PERMISSIONS = Object.freeze({
  ACCESS_PORTAL: 'access_portal',
  VIEW_LIVE_STATUS: 'view_live_status',
  VIEW_MANAGEMENT_LIVE_RAIL: 'view_management_live_rail',
  VIEW_PEOPLE: 'view_people',
  MANAGE_PEOPLE: 'manage_people',
  ACCESS_ADMIN_SETTINGS: 'access_admin_settings',
  UPDATE_OWN_PROFILE: 'update_own_profile',
  TRACK_OWN_WORK: 'track_own_work',
  VIEW_ATTENDANCE: 'view_attendance',
  VIEW_OWN_TIMESHEET: 'view_own_timesheet',
  APPLY_OWN_LEAVE: 'apply_own_leave',
  VIEW_ASSIGNED_PROJECTS: 'view_assigned_projects',
  VIEW_ASSIGNED_TEAM_TIMESHEETS: 'view_assigned_team_timesheets',
  MANAGE_OWNED_PROJECT_TEAM: 'manage_owned_project_team',
  CORRECT_SCOPED_TIME_ENTRIES: 'correct_scoped_time_entries',
  VIEW_ORGANISATION_TIMESHEETS: 'view_organisation_timesheets',
  MANAGE_PROJECTS: 'manage_projects',
  MANAGE_ACTIVITIES: 'manage_activities',
  VIEW_WORK_DISTRIBUTION: 'view_work_distribution',
  APPROVE_LEAVE: 'approve_leave',
  MANAGE_BOS_EOD_EXCEPTIONS: 'manage_bos_eod_exceptions',
});

const EMPLOYEE_PERMISSIONS = [
  PERMISSIONS.ACCESS_PORTAL,
  PERMISSIONS.VIEW_LIVE_STATUS,
  PERMISSIONS.UPDATE_OWN_PROFILE,
  PERMISSIONS.TRACK_OWN_WORK,
  PERMISSIONS.VIEW_ATTENDANCE,
  PERMISSIONS.VIEW_OWN_TIMESHEET,
  PERMISSIONS.APPLY_OWN_LEAVE,
  PERMISSIONS.VIEW_ASSIGNED_PROJECTS,
];

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.EMPLOYEE]: new Set(EMPLOYEE_PERMISSIONS),
  [ROLES.MANAGER]: new Set([
    ...EMPLOYEE_PERMISSIONS,
    PERMISSIONS.VIEW_PEOPLE,
    PERMISSIONS.VIEW_MANAGEMENT_LIVE_RAIL,
    PERMISSIONS.VIEW_WORK_DISTRIBUTION,
    PERMISSIONS.VIEW_ASSIGNED_TEAM_TIMESHEETS,
    PERMISSIONS.MANAGE_OWNED_PROJECT_TEAM,
    PERMISSIONS.CORRECT_SCOPED_TIME_ENTRIES,
  ]),
  [ROLES.ADMIN]: new Set([
    ...EMPLOYEE_PERMISSIONS,
    PERMISSIONS.VIEW_PEOPLE,
    PERMISSIONS.MANAGE_PEOPLE,
    PERMISSIONS.ACCESS_ADMIN_SETTINGS,
    PERMISSIONS.VIEW_ASSIGNED_TEAM_TIMESHEETS,
    PERMISSIONS.MANAGE_OWNED_PROJECT_TEAM,
    PERMISSIONS.CORRECT_SCOPED_TIME_ENTRIES,
    PERMISSIONS.VIEW_ORGANISATION_TIMESHEETS,
    PERMISSIONS.MANAGE_PROJECTS,
    PERMISSIONS.MANAGE_ACTIVITIES,
    PERMISSIONS.VIEW_WORK_DISTRIBUTION,
    PERMISSIONS.VIEW_MANAGEMENT_LIVE_RAIL,
  ]),
  [ROLES.SUPERADMIN]: new Set(Object.values(PERMISSIONS)),
});

export const normalizeRole = (role) => LEGACY_ROLE_ALIASES[role] || role;

export const getRole = (user) => normalizeRole(user?.role);

export const hasPermission = (user, permission) => {
  const permissions = ROLE_PERMISSIONS[getRole(user)];
  return permissions?.has(permission) || false;
};

export const getTimesheetScope = (user) => {
  const role = getRole(user);
  if (role === ROLES.SUPERADMIN || role === ROLES.ADMIN) return 'organisation';
  if (role === ROLES.MANAGER) return 'assigned_projects';
  if (role === ROLES.EMPLOYEE) return 'own';
  return 'none';
};

export const canManageProjectTeam = (user, project) => {
  const role = getRole(user);
  if (role === ROLES.SUPERADMIN || role === ROLES.ADMIN) return true;
  return role === ROLES.MANAGER && project?.manager_id === user?.id;
};

/**
 * Legacy department helpers remain for current leave/attendance screens.
 * Project-team scope replaces department scope as those screens are migrated.
 */
export const getManagedDepartments = (user) => {
  if (!user?.managed_department) return [];
  return user.managed_department.split(',').map((department) => department.trim()).filter(Boolean);
};

export const isDepartmentManagedBy = (employeeDepartment, user) => {
  const role = getRole(user);
  if (role === ROLES.SUPERADMIN || role === ROLES.ADMIN) return true;
  return getManagedDepartments(user).includes(employeeDepartment);
};

export const isEmployeeManagedBy = (employee, user) => {
  if (!user || !employee) return false;

  const role = getRole(user);
  if (role === ROLES.SUPERADMIN || role === ROLES.ADMIN) return true;
  if (role !== ROLES.MANAGER) return false;

  return employee.reports_to === user.id
    || getManagedDepartments(user).includes(employee.department);
};
