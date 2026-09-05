import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { hasPermission, PERMISSIONS } from '../utils/rbac';
import {
  appDateKey,
  formatAppClock,
  formatAppDate,
} from '../utils/timezone';
import { liveStatusTimeDetails } from '../utils/liveStatus';
import AdminWorkControlModal from './AdminWorkControlModal';
import {
  AVATAR_SIGNED_URL_TTL_SECONDS,
  cacheableAvatarUrl,
  createSignedAvatarUrls,
} from '../utils/avatars';

const STATUS_TABS = ['In', 'Break', 'Out'];

const initialsFor = (name) => name
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part[0])
  .join('')
  .slice(0, 2)
  .toUpperCase();

const formatLiveTime = (value, label) => {
  const sameDay = appDateKey(value) === appDateKey();
  const time = formatAppClock(value);

  if (sameDay) return `${label} ${time}`;
  return `${label} ${formatAppDate(value, {
    day: 'numeric',
    month: 'short',
    year: undefined,
  })}, ${time}`;
};

const LiveStatusBoard = ({
  active = true,
  refreshKey,
  variant = 'board',
  onClose,
}) => {
  const { user } = useContext(AuthContext);
  const [rows, setRows] = useState([]);
  const [activeTab, setActiveTab] = useState('In');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [avatarUrls, setAvatarUrls] = useState({});
  const avatarUrlsRef = useRef({});
  const avatarUrlsExpireAtRef = useRef(0);
  const refreshInFlightRef = useRef(null);
  const canManageLiveWork = hasPermission(user, PERMISSIONS.MANAGE_LIVE_WORK);

  const refreshAvatarUrls = useCallback(async (paths) => {
    const uniquePaths = [...new Set((paths || []).filter(Boolean))];
    if (!uniquePaths.length) return;

    const cacheIsFresh = Date.now() < avatarUrlsExpireAtRef.current;
    if (cacheIsFresh && uniquePaths.every((path) => avatarUrlsRef.current[path])) return;

    try {
      const signedUrls = await createSignedAvatarUrls(supabase, uniquePaths);
      avatarUrlsRef.current = signedUrls;
      avatarUrlsExpireAtRef.current = Date.now()
        + ((AVATAR_SIGNED_URL_TTL_SECONDS - 5 * 60) * 1000);
      setAvatarUrls(signedUrls);
    } catch (avatarError) {
      console.warn('Unable to load live-status profile pictures:', avatarError.message);
    }
  }, []);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    const request = (async () => {
      if (!quiet) setLoading(true);
      const { data, error: boardError } = await supabase.rpc('live_work_status');

      if (boardError) {
        setError('Live status is temporarily unavailable.');
        setLoading(false);
        return;
      }

      setRows(data || []);
      void refreshAvatarUrls((data || []).map((row) => row.avatar_path));
      setUpdatedAt(new Date());
      setError('');
      setLoading(false);
    })();

    refreshInFlightRef.current = request;
    try {
      return await request;
    } finally {
      refreshInFlightRef.current = null;
    }
  }, [refreshAvatarUrls]);

  useEffect(() => {
    if (!active || document.visibilityState !== 'visible') {
      setLoading(false);
      return;
    }
    void refresh();
  }, [active, refresh, refreshKey]);

  useEffect(() => {
    if (!active) return undefined;

    const handleFocus = () => {
      if (document.visibilityState === 'visible') void refresh({ quiet: true });
    };
    const pollId = window.setInterval(
      handleFocus,
      60000,
    );
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      window.clearInterval(pollId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [active, refresh]);

  const counts = useMemo(
    () => Object.fromEntries(
      STATUS_TABS.map((status) => [
        status,
        rows.filter((row) => row.work_status === status).length,
      ]),
    ),
    [rows],
  );

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (row.work_status !== activeTab) return false;
      if (!query) return true;

      return [
        row.employee_name,
        row.employee_code,
        row.context_label,
      ].some((value) => value?.toLowerCase().includes(query));
    });
  }, [activeTab, rows, search]);

  return (
    <section className={`card live-status-board live-status-board--${variant}`} aria-labelledby={`live-status-title-${variant}`}>
      <div className="live-status-header">
        <div>
          <div className="live-status-title-row">
            <h3 id={`live-status-title-${variant}`}>
              {variant === 'rail' ? 'Who’s in/out' : 'Who’s in today'}
            </h3>
            <span className="live-status-indicator">
              <span aria-hidden="true" />
              Live
            </span>
          </div>
          <p>
            {variant === 'rail'
              ? `${rows.length} ${rows.length === 1 ? 'member' : 'members'} · company status`
              : 'Company work status refreshes automatically.'}
          </p>
        </div>

        {variant === 'rail' && (
          <button type="button" className="live-status-rail-close" onClick={onClose} aria-label="Close who’s in/out">
            <i className="ri-close-line" aria-hidden="true" />
          </button>
        )}

        <label className="live-status-search">
          <i className="ri-search-line" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search live status"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={variant === 'rail' ? 'Search members…' : 'Search people or context'}
          />
        </label>
      </div>

      <div className="live-status-tabs" role="tablist" aria-label="Work status">
        {STATUS_TABS.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={activeTab === status}
            className={activeTab === status ? 'active' : ''}
            onClick={() => setActiveTab(status)}
          >
            {status}
            <span>{counts[status] || 0}</span>
          </button>
        ))}
      </div>

      <div className="live-status-content" role="tabpanel">
        {loading ? (
          <div className="live-status-empty">Loading company status…</div>
        ) : error ? (
          <div className="live-status-error" role="alert">
            <i className="ri-error-warning-line" aria-hidden="true" />
            <span>{error}</span>
            <button type="button" onClick={() => refresh()}>Try again</button>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="live-status-empty">
            {search ? 'No matching people in this status.' : `No one is ${activeTab.toLowerCase()} right now.`}
          </div>
        ) : (
          <div className="live-status-list">
            {visibleRows.map((row) => {
              const attendanceAvailable = (
                Object.prototype.hasOwnProperty.call(row, 'checked_in_at')
                || Object.prototype.hasOwnProperty.call(row, 'first_check_in_at')
              );
              const timeDetails = liveStatusTimeDetails({
                attendanceAvailable,
                breakStartedAt: row.break_started_at,
                checkedInAt: row.checked_in_at ?? row.first_check_in_at,
                checkedOutAt: row.checked_out_at,
                workStatus: row.work_status,
              });
              const avatarUrl = (
                avatarUrls[row.avatar_path] || cacheableAvatarUrl(row.avatar_url)
              );

              return (
                <article
                  className={`live-status-row ${row.is_stale ? 'stale' : ''}${canManageLiveWork ? ' actionable' : ''}`}
                  key={row.employee_id}
                  role={canManageLiveWork ? 'button' : undefined}
                  tabIndex={canManageLiveWork ? 0 : undefined}
                  aria-label={canManageLiveWork ? `Manage live work for ${row.employee_name}, currently ${row.work_status}` : undefined}
                  onClick={canManageLiveWork ? () => setSelectedEmployee(row) : undefined}
                  onKeyDown={canManageLiveWork ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedEmployee(row);
                    }
                  } : undefined}
                >
                  <div className="live-status-person">
                    <div className="live-status-avatar">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="" />
                      ) : initialsFor(row.employee_name)}
                      <span className={`status-dot ${row.work_status.toLowerCase()}`} />
                    </div>
                    <div>
                      <h4>{row.employee_name}</h4>
                      <p>{row.employee_code}</p>
                    </div>
                  </div>

                  <div className="live-status-context">
                    <span>Current context</span>
                    <strong>
                      {row.context_label
                        || (row.work_status === 'Out'
                          ? 'Not working'
                          : 'Restricted by access')}
                    </strong>
                    <div className="live-status-time-summary">
                      {timeDetails.map((detail) => (
                        detail.value ? (
                          <time key={detail.label} dateTime={detail.value}>
                            {formatLiveTime(detail.value, detail.label)}
                          </time>
                        ) : (
                          <span key={detail.label}>{detail.label}</span>
                        )
                      ))}
                    </div>
                  </div>

                  <div className="live-status-state">
                    <span className={`live-status-pill ${row.work_status.toLowerCase()}`}>
                      {row.work_status}
                    </span>
                    {row.work_mode === 'wfh' && (
                      <span className="live-status-wfh" title="Working from home">
                        <i className="ri-home-4-line" aria-hidden="true" />
                        WFH
                      </span>
                    )}
                  </div>

                  {row.is_stale && (
                    <div className="live-status-stale" title="Open for more than 24 hours">
                      <i className="ri-alarm-warning-line" aria-hidden="true" />
                      Stale open entry
                    </div>
                  )}
                  {canManageLiveWork && (
                    <span className="live-status-manage-hint" aria-hidden="true">
                      <i className="ri-settings-3-line" />
                      Manage
                    </span>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="live-status-footer" aria-live="polite">
        {updatedAt
          ? `Updated ${formatAppClock(updatedAt)}`
          : 'Waiting for first update'}
      </div>
      {selectedEmployee && (
        <AdminWorkControlModal
          employee={selectedEmployee}
          onClose={() => setSelectedEmployee(null)}
          onChanged={() => refresh({ quiet: true })}
        />
      )}
    </section>
  );
};

export default LiveStatusBoard;
