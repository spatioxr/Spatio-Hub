import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import DailyReportSettings from '../components/DailyReportSettings';
import { AuthContext } from '../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../utils/rbac';

const SETTING_AREAS = [
  {
    key: 'people',
    icon: 'ri-team-line',
    title: 'People',
    description: 'Employee profiles, roles, departments and employment status.',
    detail: 'Available now',
    href: '/people',
  },
  {
    key: 'projects',
    icon: 'ri-briefcase-4-line',
    title: 'Projects',
    description: 'Project definitions, managers and team assignments.',
    detail: 'Manage projects',
    href: '/projects',
  },
  {
    key: 'activities',
    icon: 'ri-list-check-3',
    title: 'Activities',
    description: 'The approved catalogue for internal, non-project work.',
    detail: 'Activity administration is planned next',
  },
];

const AdminSettings = () => {
  const { user } = useContext(AuthContext);
  const canManageExceptions = hasPermission(
    user,
    PERMISSIONS.MANAGE_BOS_EOD_EXCEPTIONS,
  );

  return (
    <Layout
      title="Admin Settings"
      eyebrow="Administration"
      heading="Admin Settings"
      description="Keep organisation setup separate from everyday work and leave flows."
    >
      <div className="admin-settings-intro">
        <i className="ri-shield-check-line" aria-hidden="true" />
        <div>
          <strong>Role-aware administration</strong>
          <span>
            Admins manage standard Phase 1 setup. Privileged roles, BOS/EOD exceptions
            and organisation-wide controls remain superadmin-only.
          </span>
        </div>
      </div>

      <section aria-labelledby="admin-settings-areas">
        <div className="admin-settings-section-heading">
          <div>
            <span className="page-eyebrow">Configuration</span>
            <h2 id="admin-settings-areas">Administration areas</h2>
          </div>
          <span className="badge primary">Phase 1 only</span>
        </div>

        <div className="admin-settings-grid">
          {SETTING_AREAS.map((area) => {
            const content = (
              <>
                <span className="admin-settings-card-icon"><i className={area.icon} /></span>
                <div className="admin-settings-card-copy">
                  <h3>{area.title}</h3>
                  <p>{area.description}</p>
                  <span>{area.detail}</span>
                </div>
                <i className={area.href ? 'ri-arrow-right-line' : 'ri-lock-line'} aria-hidden="true" />
              </>
            );

            return area.href ? (
              <Link className="admin-settings-card admin-settings-card--active" to={area.href} key={area.key}>
                {content}
              </Link>
            ) : (
              <div className="admin-settings-card admin-settings-card--planned" key={area.key}>
                {content}
              </div>
            );
          })}

          {canManageExceptions ? (
            <a className="admin-settings-card admin-settings-card--active" href="#bos-eod-settings">
              <span className="admin-settings-card-icon"><i className="ri-sun-line" /></span>
              <div className="admin-settings-card-copy">
                <h3>BOS/EOD exceptions</h3>
                <p>Choose whether daily reports are mandatory for an employee.</p>
                <span>Superadmin control</span>
              </div>
              <i className="ri-arrow-down-line" aria-hidden="true" />
            </a>
          ) : (
            <div className="admin-settings-card admin-settings-card--locked">
              <span className="admin-settings-card-icon"><i className="ri-sun-line" /></span>
              <div className="admin-settings-card-copy">
                <h3>BOS/EOD exceptions</h3>
                <p>Choose whether daily reports are mandatory for an employee.</p>
                <span>Superadmin only</span>
              </div>
              <i className="ri-lock-line" aria-hidden="true" />
            </div>
          )}
        </div>
      </section>

      {canManageExceptions && (
        <section id="bos-eod-settings" className="admin-settings-detail" aria-labelledby="bos-eod-title">
          <div className="admin-settings-section-heading">
            <div>
              <span className="page-eyebrow">Superadmin</span>
              <h2 id="bos-eod-title">Daily report exceptions</h2>
              <p>Mandatory remains the default. Effective changes retain their audit history.</p>
            </div>
          </div>
          <DailyReportSettings />
        </section>
      )}

      <div className="admin-settings-scope-note">
        <i className="ri-information-line" aria-hidden="true" />
        Payroll, scheduling, GPS, invoicing and Phase 2 configuration are intentionally excluded.
      </div>
    </Layout>
  );
};

export default AdminSettings;
