import React, { useState, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { AuthContext } from '../context/AuthContext';

const ResetPassword = () => {
  const { user, loading: authLoading, updatePassword, isPasswordRecovery } = useContext(AuthContext);
  const navigate = useNavigate();

  // Logged-in state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ message: '', type: '' });

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: '' }), 4000);
  };

  const handleLoggedInSubmit = async (e) => {
    e.preventDefault();

    if (newPassword.length < 6) {
      showToast('New password must be at least 6 characters.', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match.', 'error');
      return;
    }

    setLoading(true);
    const result = await updatePassword({ currentPassword, newPassword });
    setLoading(false);

    if (result.success) {
      showToast('Password updated successfully!', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => navigate('/'), 1500);
    } else {
      showToast('Error: ' + result.message, 'error');
    }
  };

  if (authLoading) {
    return (
      <div className="login-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Checking your session…</div>
      </div>
    );
  }

  // Email recovery remains disabled until launch-grade SMTP is configured.
  if (!user) {
    return (
      <div className="login-container">
        <div className="login-right" style={{ flex: 'none', margin: '0 auto', maxWidth: 600, width: '100%', padding: '2rem' }}>
          <div className="login-form-container" style={{ margin: '0 auto', background: 'white', padding: '3rem', borderRadius: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.08)' }}>
            <div className="login-header" style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: 'rgba(67, 24, 255, 0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 1.5rem',
                color: 'var(--primary)', fontSize: '2rem'
              }}>
                <i className="ri-customer-service-2-line"></i>
              </div>
              <h2>Password help</h2>
              <p>Self-service recovery is temporarily unavailable.</p>
            </div>

            <div style={{
              background: '#FFF8F0', border: '1px solid #FFCE2066', borderRadius: 12,
              padding: '1.25rem', color: '#6B4E00', lineHeight: 1.5,
            }}>
              Contact the HRMS super-admin to reset your password. This avoids claiming
              an email was sent while the production mail service is not configured.
            </div>
            <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
              <Link to="/login" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>
                <i className="ri-arrow-left-line"></i> Back to Login
              </Link>
            </div>
          </div>
        </div>
        
        {/* Toast */}
        {toast.message && (
          <div style={{
            position: 'fixed', top: '2rem', right: '50%', transform: 'translateX(50%)',
            background: toast.type === 'error' ? '#FFF0F0' : '#F0FFF8',
            border: `1px solid ${toast.type === 'error' ? '#FFCDD2' : '#00A88433'}`,
            color: toast.type === 'error' ? '#C62828' : '#00A884',
            padding: '1rem 2rem', borderRadius: 100,
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            fontWeight: 600, fontSize: '0.95rem',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)', zIndex: 9999,
          }}>
            <i className={toast.type === 'error' ? 'ri-error-warning-fill' : 'ri-checkbox-circle-fill'} />
            {toast.message}
          </div>
        )}
      </div>
    );
  }

  // If logged in, show "Change Password" UI
  return (
    <Layout title="Change Password">
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div className="card">
          {/* Header */}
          <div style={{ marginBottom: '1.75rem' }}>
            <div style={{
              width: 52, height: 52, borderRadius: 16,
              background: 'linear-gradient(135deg, #4318FF22, #4318FF11)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: '1rem'
            }}>
              <i className="ri-lock-password-line" style={{ fontSize: '1.5rem', color: 'var(--primary)' }} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)' }}>
              Change Password
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              Updating password for <strong>{user.email}</strong>
            </p>
          </div>

          <form onSubmit={handleLoggedInSubmit}>
            {!isPasswordRecovery && (
              <div className="salary-field">
                <label className="salary-field-label">
                  Current Password <span className="salary-required">*</span>
                </label>
                <input
                  className="salary-input"
                  type="password"
                  placeholder="Enter current password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="salary-field">
              <label className="salary-field-label">
                New Password <span className="salary-required">*</span>
              </label>
              <input
                className="salary-input"
                type="password"
                placeholder="Min 6 characters"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
              />
            </div>

            <div className="salary-field">
              <label className="salary-field-label">
                Confirm New Password <span className="salary-required">*</span>
              </label>
              <input
                className="salary-input"
                type="password"
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            {newPassword && (
              <div style={{
                padding: '0.6rem 0.9rem',
                borderRadius: 10,
                background: newPassword.length >= 8 ? '#F0FFF8' : '#FFF8F0',
                border: `1px solid ${newPassword.length >= 8 ? '#00A88433' : '#FFCE2033'}`,
                fontSize: '0.8rem',
                color: newPassword.length >= 8 ? '#00A884' : '#E57D3E',
                marginBottom: '1rem',
                display: 'flex', alignItems: 'center', gap: '0.4rem'
              }}>
                <i className={newPassword.length >= 8 ? 'ri-shield-check-line' : 'ri-shield-line'} />
                {newPassword.length >= 8 ? 'Strong password' : 'Use 8+ characters for a stronger password'}
              </div>
            )}

            <div className="salary-modal-actions" style={{ marginTop: '0.5rem' }}>
              <button
                type="button"
                className="salary-cancel-btn"
                onClick={() => navigate(-1)}
                disabled={loading}
              >
                Cancel
              </button>
              <button type="submit" className="salary-submit-btn" disabled={loading}>
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {toast.message && (
        <div style={{
          position: 'fixed', bottom: '2rem', right: '2rem',
          background: toast.type === 'error' ? '#FFF0F0' : '#F0FFF8',
          border: `1px solid ${toast.type === 'error' ? '#FFCDD2' : '#00A88433'}`,
          color: toast.type === 'error' ? '#C62828' : '#00A884',
          padding: '0.85rem 1.25rem', borderRadius: 14,
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          fontWeight: 600, fontSize: '0.9rem',
          boxShadow: '0 8px 32px rgba(0,0,0,0.08)', zIndex: 9999,
          animation: 'slideUp 0.3s ease'
        }}>
          <i className={toast.type === 'error' ? 'ri-error-warning-fill' : 'ri-checkbox-circle-fill'} />
          {toast.message}
        </div>
      )}
    </Layout>
  );
};

export default ResetPassword;
