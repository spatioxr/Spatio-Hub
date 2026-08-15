import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import {
  appDateKey,
  formatAppClock,
  formatAppDate,
} from '../utils/timezone';
import { liveStatusTimeDetails } from '../utils/liveStatus';

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

const LiveStatusBoard = ({ refreshKey, variant = 'board', onClose }) => {
  const [rows, setRows] = useState([]);
  const [activeTab, setActiveTab] = useState('In');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    const { data, error: boardError } = await supabase.rpc('live_work_status');

    if (boardError) {
      setError('Live status is temporarily unavailable.');
      setLoading(false);
      return;
    }

    setRows(data || []);
    setUpdatedAt(new Date());
    setError('');
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    const handleFocus = () => refresh({ quiet: true });
    const pollId = window.setInterval(
      () => refresh({ quiet: true }),
      15000,
    );
    window.addEventListener('focus', handleFocus);

    return () => {
      window.clearInterval(pollId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [refresh]);

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

              return (
                <article
                  className={`live-status-row ${row.is_stale ? 'stale' : ''}`}
                  key={row.employee_id}
                >
                  <div className="live-status-person">
                    <div className="live-status-avatar">
                      {initialsFor(row.employee_name)}
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
                  </div>

                  {row.is_stale && (
                    <div className="live-status-stale" title="Open for more than 24 hours">
                      <i className="ri-alarm-warning-line" aria-hidden="true" />
                      Stale open entry
                    </div>
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
    </section>
  );
};

export default LiveStatusBoard;
