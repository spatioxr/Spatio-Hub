import React, { useContext, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import PageHeader from './PageHeader';
import LiveStatusBoard from './LiveStatusBoard';
import OrganisationDowntimeBanner from './OrganisationDowntimeBanner';
import { hasPermission, PERMISSIONS } from '../utils/rbac';

const Layout = ({
  children,
  title,
  heading = title,
  eyebrow,
  description,
  actions,
  showTimer = true,
}) => {
  const { user, loading } = useContext(AuthContext);
  const [liveStatusOpen, setLiveStatusOpen] = useState(false);
  
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  const showManagementRail = hasPermission(user, PERMISSIONS.VIEW_MANAGEMENT_LIVE_RAIL);

  return (
    <div className={`app-container${showManagementRail ? ' app-container--with-live-rail' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Sidebar />
      <div className="main-content">
        <TopBar
          title={title}
          showTimer={showTimer}
          showLiveStatusToggle={showManagementRail}
          liveStatusOpen={liveStatusOpen}
          onLiveStatusToggle={() => setLiveStatusOpen((current) => !current)}
        />
        <OrganisationDowntimeBanner />
        <main className="content-area" id="main-content" tabIndex="-1">
          <div className="content-inner">
            <PageHeader
              eyebrow={eyebrow}
              title={heading}
              description={description}
              actions={actions}
            />
            {children}
          </div>
        </main>
      </div>
      {showManagementRail && (
        <>
          <button
            type="button"
            className={`live-status-rail-backdrop${liveStatusOpen ? ' open' : ''}`}
            aria-label="Close who’s in/out"
            onClick={() => setLiveStatusOpen(false)}
          />
          <aside
            className={`live-status-rail${liveStatusOpen ? ' open' : ''}`}
            id="management-live-status"
            aria-label="Company live work status"
          >
            <LiveStatusBoard variant="rail" onClose={() => setLiveStatusOpen(false)} />
          </aside>
        </>
      )}
    </div>
  );
};

export default Layout;
