import React, { useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthContext, AuthProvider } from './context/AuthContext';
import { LeaveProvider } from './context/LeaveContext';
import { WorkSessionProvider } from './context/WorkSessionContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import TrackWork from './pages/TrackWork';
import Attendance from './pages/Attendance';
import Leave from './pages/Leave';
import Policies from './pages/Policies';
import People from './pages/People';
import Projects from './pages/Projects';
import Activities from './pages/Activities';
import AdminSettings from './pages/AdminSettings';
import WorkSetup from './pages/WorkSetup';
import WorkdayCheckIns from './pages/WorkdayCheckIns';
import Timesheets from './pages/Timesheets';
import WorkDistribution from './pages/WorkDistribution';
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
    {({ isPasswordRecovery, user }) => (
      (isPasswordRecovery || user?.must_change_password)
        && window.location.pathname !== '/reset-password'
        ? <Navigate to="/reset-password" replace />
        : (
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route
              path="/track-work"
              element={(
                <PermissionRoute permission={PERMISSIONS.TRACK_OWN_WORK}>
                  <TrackWork />
                </PermissionRoute>
              )}
            />
            <Route
              path="/attendance"
              element={(
                <PermissionRoute permission={PERMISSIONS.VIEW_ATTENDANCE}>
                  <Attendance />
                </PermissionRoute>
              )}
            />
            <Route
              path="/timesheets"
              element={(
                <PermissionRoute permission={PERMISSIONS.VIEW_OWN_TIMESHEET}>
                  <Timesheets />
                </PermissionRoute>
              )}
            />
            <Route path="/leave" element={<ProtectedRoute><Leave /></ProtectedRoute>} />
            <Route path="/policies" element={<ProtectedRoute><Policies /></ProtectedRoute>} />
            <Route
              path="/people"
              element={(
                <PermissionRoute permission={PERMISSIONS.VIEW_PEOPLE}>
                  <People />
                </PermissionRoute>
              )}
            />
            <Route
              path="/analytics"
              element={(
                <PermissionRoute permission={PERMISSIONS.VIEW_WORK_DISTRIBUTION}>
                  <WorkDistribution />
                </PermissionRoute>
              )}
            />
            <Route
              path="/projects"
              element={(
                <PermissionRoute permission={PERMISSIONS.MANAGE_OWNED_PROJECT_TEAM}>
                  <Projects mode="manage" />
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
              path="/admin-settings/users"
              element={(
                <PermissionRoute permission={PERMISSIONS.ACCESS_ADMIN_SETTINGS}>
                  <People mode="access" />
                </PermissionRoute>
              )}
            />
            <Route
              path="/admin-settings/work-setup"
              element={(
                <PermissionRoute permission={PERMISSIONS.ACCESS_ADMIN_SETTINGS}>
                  <WorkSetup />
                </PermissionRoute>
              )}
            />
            <Route
              path="/admin-settings/work-setup/projects"
              element={(
                <PermissionRoute permission={PERMISSIONS.MANAGE_PROJECTS}>
                  <Projects mode="setup" />
                </PermissionRoute>
              )}
            />
            <Route
              path="/admin-settings/work-setup/activities"
              element={(
                <PermissionRoute permission={PERMISSIONS.MANAGE_ACTIVITIES}>
                  <Activities />
                </PermissionRoute>
              )}
            />
            <Route
              path="/admin-settings/workday-check-ins"
              element={(
                <PermissionRoute permission={PERMISSIONS.MANAGE_BOS_EOD_EXCEPTIONS}>
                  <WorkdayCheckIns />
                </PermissionRoute>
              )}
            />
            <Route path="/activities" element={<Navigate to="/admin-settings/work-setup/activities" replace />} />
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
