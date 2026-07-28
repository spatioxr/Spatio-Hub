import React, { useContext } from 'react';
import { NavLink } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import logoDark from '../assets/logo-dark.png';

const Sidebar = () => {
  const { user } = useContext(AuthContext);
  
  const menuItems = [
    { path: '/', name: 'Dashboard', icon: 'ri-dashboard-line', roles: ['superadmin', 'head', 'admin', 'manager', 'employee'] },
    { path: '/attendance', name: 'Work Tracking', icon: 'ri-calendar-check-line', roles: ['superadmin', 'head', 'admin', 'manager', 'employee'] },
    { path: '/leave', name: 'Leave', icon: 'ri-flight-takeoff-line', roles: ['superadmin', 'head', 'admin', 'manager', 'employee'] },
  ];

  const filteredMenu = menuItems.filter(item => item.roles.includes(user?.role));

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
