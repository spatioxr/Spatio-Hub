import React, { useContext } from 'react';
import { NavLink } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import logoDark from '../assets/logo-dark.png';
import { hasPermission, PERMISSIONS } from '../utils/rbac';

const Sidebar = () => {
  const { user } = useContext(AuthContext);
  
  const menuItems = [
    { path: '/', name: 'Dashboard', icon: 'ri-dashboard-line', permission: PERMISSIONS.ACCESS_PORTAL },
    { path: '/attendance', name: 'Work Tracking', icon: 'ri-calendar-check-line', permission: PERMISSIONS.TRACK_OWN_WORK },
    { path: '/timesheets', name: 'Timesheets', icon: 'ri-time-line', permission: PERMISSIONS.VIEW_OWN_TIMESHEET },
    { path: '/people', name: 'People', icon: 'ri-team-line', permission: PERMISSIONS.VIEW_PEOPLE },
    { path: '/leave', name: 'Leave', icon: 'ri-flight-takeoff-line', permission: PERMISSIONS.APPLY_OWN_LEAVE },
    {
      path: '/admin-settings',
      name: 'Admin Settings',
      icon: 'ri-settings-3-line',
      permission: PERMISSIONS.ACCESS_ADMIN_SETTINGS,
      separated: true,
    },
  ];

  const filteredMenu = menuItems.filter((item) => hasPermission(user, item.permission));

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="sidebar-logo">
        <img src={logoDark} alt="Spatio" />
      </div>
      <nav className="sidebar-menu">
        {filteredMenu.map(item => (
          <NavLink 
            to={item.path} 
            className={({ isActive }) => (
              `sidebar-link${item.separated ? ' sidebar-link--separated' : ''}${isActive ? ' active' : ''}`
            )}
            key={item.path}
          >
            <i className={item.icon}></i>
            <span>{item.name}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};

export default Sidebar;
