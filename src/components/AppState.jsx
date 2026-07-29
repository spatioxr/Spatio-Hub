import React from 'react';

const STATE_ICONS = {
  loading: 'ri-loader-4-line',
  empty: 'ri-inbox-2-line',
  error: 'ri-error-warning-line',
  success: 'ri-checkbox-circle-line',
};

const AppState = ({ type = 'empty', title, message, action, compact = false }) => (
  <div
    className={`app-state app-state--${type}${compact ? ' app-state--compact' : ''}`}
    role={type === 'error' ? 'alert' : type === 'loading' ? 'status' : undefined}
    aria-live={type === 'loading' ? 'polite' : undefined}
  >
    <span className="app-state-icon" aria-hidden="true">
      <i className={STATE_ICONS[type] || STATE_ICONS.empty} />
    </span>
    <div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
    </div>
    {action && <div className="app-state-action">{action}</div>}
  </div>
);

export default AppState;
