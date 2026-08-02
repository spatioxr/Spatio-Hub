import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { AuthContext } from '../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../utils/rbac';

const AdminSettings = () => {
  const { user } = useContext(AuthContext);
  const canManageCheckIns = hasPermission(user, PERMISSIONS.MANAGE_BOS_EOD_EXCEPTIONS);

  const areas = [
    {
      key: 'users',
      icon: 'ri-admin-line',
      title: 'Users & Access',
      description: 'Profiles, employment status, reporting relationships and application roles.',
      detail: 'Manage access',
      href: '/admin-settings/users',
    },
    {
      key: 'work',
      icon: 'ri-tools-line',
      title: 'Work Setup',
      description: 'Project definitions and the approved internal activity catalogue.',
      detail: 'Configure work',
      href: '/admin-settings/work-setup',
    },
  ];

  if (canManageCheckIns) {
    areas.push({
      key: 'check-ins',
      icon: 'ri-sun-line',
      title: 'Workday Check-ins',
      description: 'Choose who must submit a start-of-day plan and end-of-day summary.',
      detail: 'Superadmin only',
      href: '/admin-settings/workday-check-ins',
    });
  }

  return (
    <Layout
      title="Settings"
      eyebrow="Administration"
      heading="Settings"
      description="Configure organisation access and work setup separately from daily management."
    >
      <div className="admin-settings-intro">
        <i className="ri-shield-check-line" aria-hidden="true" />
        <div>
          <strong>Role-aware settings</strong>
          <span>Administrative configuration stays separate from People, Projects and Analytics in Manage.</span>
        </div>
      </div>

      <section aria-labelledby="settings-areas-title">
        <div className="admin-settings-section-heading">
          <div>
            <span className="page-eyebrow">Phase 1</span>
            <h2 id="settings-areas-title">Settings areas</h2>
          </div>
        </div>
        <div className="admin-settings-grid">
          {areas.map((area) => (
            <Link className="admin-settings-card admin-settings-card--active" to={area.href} key={area.key}>
              <span className="admin-settings-card-icon"><i className={area.icon} /></span>
              <div className="admin-settings-card-copy">
                <h3>{area.title}</h3>
                <p>{area.description}</p>
                <span>{area.detail}</span>
              </div>
              <i className="ri-arrow-right-line" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      <div className="admin-settings-scope-note">
        <i className="ri-information-line" aria-hidden="true" />
        Payroll, scheduling, GPS, invoicing and Phase 2 configuration remain excluded.
      </div>
    </Layout>
  );
};

export default AdminSettings;
