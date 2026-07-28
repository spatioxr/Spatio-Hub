import React, { useContext } from 'react';
import { Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const Layout = ({ children, title }) => {
  const { user, loading } = useContext(AuthContext);
  
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="app-container">
      <Sidebar />
      <div className="main-content">
        <TopBar title={title} />
        <div className="content-area">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Layout;
