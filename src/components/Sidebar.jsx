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
    { path: '/leave', name: 'Leave', icon: 'ri-flight-takeoff-line', permission: PERMISSIONS.APPLY_OWN_LEAVE },
  ];

  const filteredMenu = menuItems.filter((item) => hasPermission(user, item.permission));

  return (
    <div className="sidebar">
      <div className="sidebar-logo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: '1rem 1.5rem' }}>
        <img src={logoDark} alt="Spatio Logo" style={{ height: '42px', objectFit: 'contain' }} />
      </div>
      <div className="sidebar-menu">
        {filteredMenu.map(item => (
          <NavLink 
            to={item.path} 
            className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}
            key={item.path}
          >
            <i className={item.icon}></i>
            {item.name}
          </NavLink>
        ))}
      </div>

    </div>
  );
};

export default Sidebar;
