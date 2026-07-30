import React, { useContext } from 'react';
import { Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import PageHeader from './PageHeader';

const Layout = ({ children, title, heading = title, eyebrow, description, actions }) => {
  const { user, loading } = useContext(AuthContext);
  
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="app-container">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Sidebar />
      <div className="main-content">
        <TopBar title={title} />
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
    </div>
  );
};

export default Layout;
