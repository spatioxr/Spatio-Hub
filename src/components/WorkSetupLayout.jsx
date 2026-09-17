import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Layout from './Layout';
import '../pages/WorkSetup.css';

export default function WorkSetupLayout({ children, actions }) {
  const { pathname } = useLocation();
  return <Layout title="Work Setup" eyebrow="Settings" heading="Work Setup"
    description="Manage work choices and the hours used for costing." actions={actions}>
    <nav className="work-setup-tabs" aria-label="Work Setup sections">
      <NavLink to="/admin-settings/work-setup/projects" className={({ isActive }) => isActive || pathname === '/admin-settings/work-setup' ? 'active' : undefined} aria-current={pathname === '/admin-settings/work-setup' ? 'page' : undefined}>Projects</NavLink>
      <NavLink to="/admin-settings/work-setup/activities">Internal activities</NavLink>
      <NavLink to="/admin-settings/work-setup/costing">Costing</NavLink>
    </nav>
    <div className="work-setup-content">{children}</div>
  </Layout>;
}
