import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import {
  appDateKey,
  formatAppClock,
  formatAppDate,
} from '../utils/timezone';

const STATUS_TABS = ['In', 'Break', 'Out'];

const initialsFor = (name) => name
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part[0])
  .join('')
  .slice(0, 2)
  .toUpperCase();

const formatStatusStart = (value) => {
  if (!value) return 'No work recorded';

  const sameDay = appDateKey(value) === appDateKey();
  const time = formatAppClock(value);

  if (sameDay) return `Since ${time}`;
  return `Since ${formatAppDate(value, {
    day: 'numeric',
    month: 'short',
    year: undefined,
  })}, ${time}`;
};

const LiveStatusBoard = ({ refreshKey }) => {
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
    <section className="card live-status-board" aria-labelledby="live-status-title">
      <div className="live-status-header">
        <div>
          <div className="live-status-title-row">
            <h3 id="live-status-title">Who&apos;s in today</h3>
            <span className="live-status-indicator">
              <span aria-hidden="true" />
              Live
            </span>
          </div>
          <p>Company work status refreshes automatically.</p>
        </div>

        <label className="live-status-search">
          <i className="ri-search-line" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search live status"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search people or context"
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
            {visibleRows.map((row) => (
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
                </div>

                <div className="live-status-since">
                  <span className={`live-status-pill ${row.work_status.toLowerCase()}`}>
                    {row.work_status}
                  </span>
                  <time dateTime={row.status_started_at || undefined}>
                    {formatStatusStart(row.status_started_at)}
                  </time>
                </div>

                {row.is_stale && (
                  <div className="live-status-stale" title="Open for more than 24 hours">
                    <i className="ri-alarm-warning-line" aria-hidden="true" />
                    Stale open entry
                  </div>
                )}
              </article>
            ))}
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
