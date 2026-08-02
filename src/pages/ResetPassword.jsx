import React, { useContext, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { AuthContext } from '../context/AuthContext';
import {
  isStrongPassword,
  PASSWORD_REQUIREMENT_MESSAGE,
} from '../utils/passwordPolicy';

const PasswordForm = ({
  email,
  forced,
  requiresCurrentPassword,
  currentPassword,
  newPassword,
  confirmPassword,
  loading,
  onCurrentPasswordChange,
  onNewPasswordChange,
  onConfirmPasswordChange,
  onCancel,
  onSubmit,
}) => (
  <div className="card password-change-card">
    <div className="password-change-heading">
      <span className="password-change-icon" aria-hidden="true">
        <i className={forced ? 'ri-key-2-line' : 'ri-lock-password-line'} />
      </span>
      <div>
        <span className="page-eyebrow">{forced ? 'First login' : 'Account security'}</span>
        <h2>{forced ? 'Create your password' : 'Change Password'}</h2>
        <p>
          {forced
            ? 'Replace the temporary password before continuing to the portal.'
            : <>Updating password for <strong>{email}</strong></>}
        </p>
      </div>
    </div>

    {forced && (
      <div className="password-change-required" role="status">
        <i className="ri-shield-keyhole-line" aria-hidden="true" />
        Work tracking and employee data remain unavailable until this step is complete.
      </div>
    )}

    <form onSubmit={onSubmit}>
      {requiresCurrentPassword && (
        <label className="salary-field">
          <span className="salary-field-label">
            {forced ? 'Temporary password' : 'Current Password'} <span className="salary-required">*</span>
          </span>
          <input
            className="salary-input"
            type="password"
            autoComplete="current-password"
            placeholder={forced ? 'Enter the temporary password' : 'Enter current password'}
            value={currentPassword}
            onChange={onCurrentPasswordChange}
            required
          />
        </label>
      )}

      <label className="salary-field">
        <span className="salary-field-label">
          New Password <span className="salary-required">*</span>
        </span>
        <input
          className="salary-input"
          type="password"
          autoComplete="new-password"
          placeholder="12+ characters"
          value={newPassword}
          onChange={onNewPasswordChange}
          required
        />
      </label>

      <label className="salary-field">
        <span className="salary-field-label">
          Confirm New Password <span className="salary-required">*</span>
        </span>
        <input
          className="salary-input"
          type="password"
          autoComplete="new-password"
          placeholder="Re-enter new password"
          value={confirmPassword}
          onChange={onConfirmPasswordChange}
          required
        />
      </label>

      <div className={`password-strength ${isStrongPassword(newPassword) ? 'password-strength--valid' : ''}`}>
        <i className={isStrongPassword(newPassword) ? 'ri-shield-check-line' : 'ri-shield-line'} aria-hidden="true" />
        {PASSWORD_REQUIREMENT_MESSAGE}
      </div>

      <div className="salary-modal-actions password-change-actions">
        {!forced && (
          <button type="button" className="salary-cancel-btn" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
        )}
        <button type="submit" className="salary-submit-btn" disabled={loading}>
          {loading ? 'Updating…' : forced ? 'Set password and continue' : 'Update Password'}
        </button>
      </div>
    </form>
  </div>
);

const ResetPassword = () => {
  const {
    user,
    loading: authLoading,
    updatePassword,
    replaceTemporaryPassword,
    isPasswordRecovery,
  } = useContext(AuthContext);
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ message: '', type: '' });

  const forced = Boolean(user?.must_change_password);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    window.setTimeout(() => setToast({ message: '', type: '' }), 5000);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!isStrongPassword(newPassword)) {
      showToast(PASSWORD_REQUIREMENT_MESSAGE, 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match.', 'error');
      return;
    }
    if (newPassword === currentPassword) {
      showToast('Choose a password different from the current password.', 'error');
      return;
    }

    setLoading(true);
    const result = forced
      ? await replaceTemporaryPassword({ currentPassword, newPassword })
      : await updatePassword({ currentPassword, newPassword });
    setLoading(false);

    if (!result.success) {
      showToast(result.message, 'error');
      return;
    }

    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    showToast(forced ? 'Password created. Opening your dashboard…' : 'Password updated successfully.');
    window.setTimeout(() => navigate('/'), 1200);
  };

  if (authLoading) {
    return (
      <div className="login-container password-change-shell">
        <div className="text-muted font-bold">Checking your session…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login-container password-change-shell">
        <div className="card password-help-card">
          <span className="password-change-icon" aria-hidden="true">
            <i className="ri-customer-service-2-line" />
          </span>
          <h2>Password help</h2>
          <p>Self-service recovery is temporarily unavailable.</p>
          <div className="password-change-required">
            Contact the HRMS Superadmin to reset your password. A new temporary password will be issued and must be replaced after sign-in.
          </div>
          <Link to="/login" className="password-help-link">
            <i className="ri-arrow-left-line" aria-hidden="true" /> Back to Login
          </Link>
        </div>
      </div>
    );
  }

  const form = (
    <PasswordForm
      email={user.email}
      forced={forced || isPasswordRecovery}
      requiresCurrentPassword={forced || !isPasswordRecovery}
      currentPassword={currentPassword}
      newPassword={newPassword}
      confirmPassword={confirmPassword}
      loading={loading}
      onCurrentPasswordChange={(event) => setCurrentPassword(event.target.value)}
      onNewPasswordChange={(event) => setNewPassword(event.target.value)}
      onConfirmPasswordChange={(event) => setConfirmPassword(event.target.value)}
      onCancel={() => navigate(-1)}
      onSubmit={handleSubmit}
    />
  );

  return (
    <>
      {forced ? (
        <div className="login-container password-change-shell">{form}</div>
      ) : (
        <Layout title="Change Password">
          <div className="password-change-page">{form}</div>
        </Layout>
      )}

      {toast.message && (
        <div className={`password-change-toast password-change-toast--${toast.type || 'success'}`} role="status">
          <i className={toast.type === 'error' ? 'ri-error-warning-fill' : 'ri-checkbox-circle-fill'} aria-hidden="true" />
          {toast.message}
        </div>
      )}
    </>
  );
};

export default ResetPassword;
