import React, { useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthContext, AuthProvider } from './context/AuthContext';
import { LeaveProvider } from './context/LeaveContext';
import { WorkSessionProvider } from './context/WorkSessionContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Attendance from './pages/Attendance';
import Leave from './pages/Leave';
import People from './pages/People';
import Projects from './pages/Projects';
import Activities from './pages/Activities';
import AdminSettings from './pages/AdminSettings';
import Timesheets from './pages/Timesheets';
import ResetPassword from './pages/ResetPassword';
import { hasPermission, PERMISSIONS } from './utils/rbac';

const SessionLoader = () => (
  <div className="login-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Restoring your session…</div>
  </div>
);

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useContext(AuthContext);

  if (loading) return <SessionLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasPermission(user, PERMISSIONS.ACCESS_PORTAL)) return <Navigate to="/login" replace />;
  return children;
};

const PermissionRoute = ({ permission, children }) => {
  const { user, loading } = useContext(AuthContext);

  if (loading) return <SessionLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasPermission(user, permission)) return <Navigate to="/" replace />;
  return children;
};

const AppRoutes = () => (
  <AuthContext.Consumer>
    {({ isPasswordRecovery }) => (
      isPasswordRecovery && window.location.pathname !== '/reset-password'
        ? <Navigate to="/reset-password" replace />
        : (
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/attendance" element={<ProtectedRoute><Attendance /></ProtectedRoute>} />
            <Route
              path="/timesheets"
              element={(
                <PermissionRoute permission={PERMISSIONS.VIEW_OWN_TIMESHEET}>
                  <Timesheets />
                </PermissionRoute>
              )}
            />
            <Route path="/leave" element={<ProtectedRoute><Leave /></ProtectedRoute>} />
            <Route
              path="/people"
              element={(
                <PermissionRoute permission={PERMISSIONS.VIEW_PEOPLE}>
                  <People />
                </PermissionRoute>
              )}
            />
            <Route
              path="/projects"
              element={(
                <PermissionRoute permission={PERMISSIONS.MANAGE_OWNED_PROJECT_TEAM}>
                  <Projects />
                </PermissionRoute>
              )}
            />
            <Route
              path="/admin-settings"
              element={(
                <PermissionRoute permission={PERMISSIONS.ACCESS_ADMIN_SETTINGS}>
                  <AdminSettings />
                </PermissionRoute>
              )}
            />
            <Route
              path="/activities"
              element={(
                <PermissionRoute permission={PERMISSIONS.MANAGE_ACTIVITIES}>
                  <Activities />
                </PermissionRoute>
              )}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )
    )}
  </AuthContext.Consumer>
);

const App = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <WorkSessionProvider>
          <LeaveProvider>
            <AppRoutes />
          </LeaveProvider>
        </WorkSessionProvider>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
