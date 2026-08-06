import React, { useContext } from 'react';
import { NavLink } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import logoDark from '../assets/logo-dark.png';
import { hasPermission, PERMISSIONS } from '../utils/rbac';

const COMMON_ITEMS = [
  { path: '/', name: 'Dashboard', icon: 'ri-dashboard-line', permission: PERMISSIONS.ACCESS_PORTAL, end: true },
  { path: '/track-work', name: 'Track Work', icon: 'ri-play-circle-line', permission: PERMISSIONS.TRACK_OWN_WORK },
  { path: '/timesheets', name: 'Timesheets', icon: 'ri-time-line', permission: PERMISSIONS.VIEW_OWN_TIMESHEET },
  { path: '/attendance', name: 'Attendance', icon: 'ri-calendar-check-line', permission: PERMISSIONS.VIEW_ATTENDANCE },
  { path: '/leave', name: 'Leave', icon: 'ri-flight-takeoff-line', permission: PERMISSIONS.APPLY_OWN_LEAVE },
];

const MANAGE_ITEMS = [
  { path: '/people', name: 'People', icon: 'ri-team-line', permission: PERMISSIONS.VIEW_PEOPLE },
  { path: '/projects', name: 'Projects', icon: 'ri-briefcase-4-line', permission: PERMISSIONS.MANAGE_OWNED_PROJECT_TEAM },
  { path: '/analytics', name: 'Analytics', icon: 'ri-bar-chart-box-line', permission: PERMISSIONS.VIEW_WORK_DISTRIBUTION },
];

const SETTINGS_ITEMS = [
  { path: '/admin-settings/users', name: 'Users & Access', icon: 'ri-admin-line', permission: PERMISSIONS.ACCESS_ADMIN_SETTINGS },
  { path: '/admin-settings/work-setup', name: 'Work Setup', icon: 'ri-tools-line', permission: PERMISSIONS.ACCESS_ADMIN_SETTINGS },
  { path: '/admin-settings/workday-check-ins', name: 'Workday Check-ins', icon: 'ri-sun-line', permission: PERMISSIONS.MANAGE_BOS_EOD_EXCEPTIONS },
];

const NavigationLink = ({ item }) => (
  <NavLink
    to={item.path}
    end={item.end}
    className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
  >
    <i className={item.icon} aria-hidden="true" />
    <span>{item.name}</span>
  </NavLink>
);

const NavigationGroup = ({ label, items, separated = false }) => {
  if (items.length === 0) return null;

  return (
    <div className={`sidebar-group${separated ? ' sidebar-group--separated' : ''}`}>
      {label && (
        <div className="sidebar-group-heading" aria-label={`${label} navigation, expanded`}>
          <span>{label}</span>
          <i className="ri-arrow-up-s-line" aria-hidden="true" />
        </div>
      )}
      <div className="sidebar-group-links">
        {items.map((item) => <NavigationLink item={item} key={item.path} />)}
      </div>
    </div>
  );
};

const Sidebar = () => {
  const { user } = useContext(AuthContext);
  const permitted = (items) => items.filter((item) => hasPermission(user, item.permission));

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="sidebar-logo">
        <img src={logoDark} alt="Spatio" />
      </div>
      <nav className="sidebar-menu">
        <NavigationGroup items={permitted(COMMON_ITEMS)} />
        <NavigationGroup label="Manage" items={permitted(MANAGE_ITEMS)} separated />
        <NavigationGroup label="Settings" items={permitted(SETTINGS_ITEMS)} separated />
      </nav>
    </aside>
  );
};

export default Sidebar;
