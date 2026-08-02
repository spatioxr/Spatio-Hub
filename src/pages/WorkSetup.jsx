import React from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';

const WorkSetup = () => (
  <Layout
    title="Work Setup"
    eyebrow="Settings"
    heading="Work Setup"
    description="Define the projects and internal activities employees can select when tracking work."
  >
    <div className="admin-settings-grid">
      <Link className="admin-settings-card admin-settings-card--active" to="/admin-settings/work-setup/projects">
        <span className="admin-settings-card-icon"><i className="ri-briefcase-4-line" /></span>
        <div className="admin-settings-card-copy">
          <h3>Project setup</h3>
          <p>Create, archive and maintain project definitions and accountable managers.</p>
          <span>Configure projects</span>
        </div>
        <i className="ri-arrow-right-line" aria-hidden="true" />
      </Link>
      <Link className="admin-settings-card admin-settings-card--active" to="/admin-settings/work-setup/activities">
        <span className="admin-settings-card-icon"><i className="ri-list-check-3" /></span>
        <div className="admin-settings-card-copy">
          <h3>Internal activities</h3>
          <p>Maintain the approved catalogue for internal, non-project work.</p>
          <span>Configure activities</span>
        </div>
        <i className="ri-arrow-right-line" aria-hidden="true" />
      </Link>
    </div>
  </Layout>
);

export default WorkSetup;
