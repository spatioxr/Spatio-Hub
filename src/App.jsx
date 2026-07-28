import React, { useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthContext, AuthProvider } from './context/AuthContext';
import { LeaveProvider } from './context/LeaveContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Attendance from './pages/Attendance';
import Leave from './pages/Leave';
import ResetPassword from './pages/ResetPassword';

const SessionLoader = () => (
  <div className="login-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Restoring your session…</div>
  </div>
);

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useContext(AuthContext);

  if (loading) return <SessionLoader />;
  if (!user) return <Navigate to="/login" replace />;
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
            <Route path="/leave" element={<ProtectedRoute><Leave /></ProtectedRoute>} />
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
        <LeaveProvider>
          <AppRoutes />
        </LeaveProvider>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
