import React, { useState, useContext } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import logoDark from '../assets/logo-dark.png';

const Login = () => {
  const { login, user, loading: authLoading, authError } = useContext(AuthContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Remember only the email address. Supabase manages the persisted session.
  React.useEffect(() => {
    const savedEmail = localStorage.getItem('spatio_remember_email');
    localStorage.removeItem('spatio_remember_password');
    localStorage.removeItem('hrms_user');

    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  if (authLoading) {
    return (
      <div className="login-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Restoring your session…</div>
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result.success) {
      if (rememberMe) {
        localStorage.setItem('spatio_remember_email', email);
      } else {
        localStorage.removeItem('spatio_remember_email');
      }
      navigate('/');
    } else {
      setError(result.message);
    }
  };


  return (
    <div className="login-container">
      {/* Left side: branding/photo pane */}
      <div className="login-left">
        <div className="login-left-content">
          <h1>Welcome to Spatio</h1>
          <p>Your comprehensive employee portal for attendance, leave management, and more</p>
        </div>
      </div>

      {/* Right side: Login pane */}
      <div className="login-right">
        <div className="login-form-container">
          {/* Logo */}
          <div className="login-logo-container" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <img src={logoDark} alt="Spatio Logo" style={{ height: '48px', objectFit: 'contain' }} />
          </div>

          {/* Heading */}
          <div className="login-header">
            <h2>Hi, there!</h2>
            <p>Welcome to Spatio Portal</p>
          </div>

          {/* Error */}
          {(error || authError) && (
            <div style={{
              background: '#FFF0F0', border: '1px solid #FFCDD2', borderRadius: 12,
              padding: '0.75rem 1rem', color: '#C62828', fontSize: '0.875rem',
              marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem'
            }}>
              <i className="ri-error-warning-line" /> {error || authError}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin}>
            <div className="login-input-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                placeholder="mail@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="login-input-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                placeholder="........"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {/* Actions */}
            <div className="login-actions">
              <label className="login-remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                Remember me
              </label>
              <Link to="/reset-password" className="login-forgot">
                Forgot Password?
              </Link>
            </div>

            {/* Sign in button */}
            <button type="submit" className="btn-signin" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>


        </div>
      </div>
    </div>
  );
};

export default Login;
