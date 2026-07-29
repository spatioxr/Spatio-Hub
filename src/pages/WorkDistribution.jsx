import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AppState from '../components/AppState';
import Layout from '../components/Layout';
import { supabase } from '../utils/supabaseClient';

const REPORT_TIMEZONE_OFFSET = '+05:30';
const MAX_RANGE_DAYS = 31;

const dateKey = (value) => {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (value, days) => {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
};

const rangeLength = (startDate, endDate) => {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  return Math.round((end - start) / 86400000) + 1;
};

const formatDuration = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
};

const formatRange = (startDate, endDate) => {
  const formatter = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${formatter.format(new Date(`${startDate}T00:00:00`))} – ${formatter.format(new Date(`${endDate}T00:00:00`))}`;
};

const aggregateEntries = (entries, keyForEntry, labelForEntry) => {
  const groups = new Map();

  entries.forEach((entry) => {
    const key = keyForEntry(entry);
    if (!key) return;
    const current = groups.get(key) || {
      key,
      label: labelForEntry(entry) || 'Not assigned',
      seconds: 0,
    };
    current.seconds += Number(entry.worked_seconds) || 0;
    groups.set(key, current);
  });

  return [...groups.values()].sort((left, right) => (
    right.seconds - left.seconds || left.label.localeCompare(right.label)
  ));
};

const DistributionChart = ({ title, description, data, emptyMessage, accent }) => {
  const largestValue = data[0]?.seconds || 0;

  return (
    <section className="card analytics-chart-card">
      <div className="analytics-chart-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span>{data.length} {data.length === 1 ? 'group' : 'groups'}</span>
      </div>

      {data.length === 0 ? (
        <div className="analytics-chart-empty">
          <i className="ri-bar-chart-horizontal-line" aria-hidden="true" />
          <span>{emptyMessage}</span>
        </div>
      ) : (
        <div className="analytics-bars">
          {data.map((item) => {
            const width = largestValue > 0 ? (item.seconds / largestValue) * 100 : 0;
            return (
              <div
                className="analytics-bar-row"
                key={item.key}
                aria-label={`${item.label}: ${formatDuration(item.seconds)}`}
              >
                <div className="analytics-bar-label">
                  <span title={item.label}>{item.label}</span>
                  <strong>{formatDuration(item.seconds)}</strong>
                </div>
                <div className="analytics-bar-track" aria-hidden="true">
                  <span
                    className={`analytics-bar-fill analytics-bar-fill--${accent}`}
                    style={{ width: `${Math.max(width, 2)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

const WorkDistribution = () => {
  const today = dateKey(new Date());
  const initialStart = addDays(today, -6);
  const [draftRange, setDraftRange] = useState({ start: initialStart, end: today });
  const [appliedRange, setAppliedRange] = useState({ start: initialStart, end: today });
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rangeError, setRangeError] = useState('');

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError('');

    const { data, error: fetchError } = await supabase.rpc('scoped_timesheet_entries', {
      requested_start_at: `${appliedRange.start}T00:00:00${REPORT_TIMEZONE_OFFSET}`,
      requested_end_at: `${addDays(appliedRange.end, 1)}T00:00:00${REPORT_TIMEZONE_OFFSET}`,
      requested_scope: 'organisation',
      requested_employee_id: null,
    });

    if (fetchError) {
      setEntries([]);
      setError(fetchError.message || 'Unable to load organisation analytics.');
    } else {
      setEntries(data || []);
    }
    setLoading(false);
  }, [appliedRange]);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  const summary = useMemo(() => {
    const workedSeconds = entries.reduce(
      (total, entry) => total + (Number(entry.worked_seconds) || 0),
      0,
    );
    const breakSeconds = entries.reduce(
      (total, entry) => total + (Number(entry.break_seconds) || 0),
      0,
    );
    return {
      workedSeconds,
      breakSeconds,
      sessions: entries.length,
      employees: new Set(entries.map((entry) => entry.employee_id)).size,
    };
  }, [entries]);

  const distributions = useMemo(() => ({
    projects: aggregateEntries(
      entries.filter((entry) => entry.context_type === 'project'),
      (entry) => entry.context_id || entry.context_label,
      (entry) => entry.context_label,
    ),
    activities: aggregateEntries(
      entries.filter((entry) => entry.context_type === 'activity'),
      (entry) => entry.context_id || entry.context_label,
      (entry) => entry.context_label,
    ),
    departments: aggregateEntries(
      entries,
      (entry) => entry.employee_department || 'not-assigned',
      (entry) => entry.employee_department || 'Not assigned',
    ),
    employees: aggregateEntries(
      entries,
      (entry) => entry.employee_id,
      (entry) => entry.employee_name || entry.employee_code || 'Unknown employee',
    ),
  }), [entries]);

  const applyRange = (event) => {
    event.preventDefault();
    const days = rangeLength(draftRange.start, draftRange.end);

    if (!draftRange.start || !draftRange.end || !Number.isFinite(days) || days < 1) {
      setRangeError('Choose an end date on or after the start date.');
      return;
    }
    if (days > MAX_RANGE_DAYS) {
      setRangeError(`Choose a date range of ${MAX_RANGE_DAYS} days or fewer.`);
      return;
    }

    setRangeError('');
    setAppliedRange({ ...draftRange });
  };

  return (
    <Layout
      title="Analytics"
      eyebrow="Organisation reporting"
      heading="Work distribution"
      description="Understand where team time is going across projects, internal activities, departments, and people."
    >
      <form className="card analytics-range-panel" onSubmit={applyRange}>
        <div className="analytics-range-copy">
          <span className="page-eyebrow">Reporting period</span>
          <h2>{formatRange(appliedRange.start, appliedRange.end)}</h2>
          <p>Up to 31 days at a time · Asia/Kolkata reporting day</p>
        </div>
        <div className="analytics-range-fields">
          <label className="people-field">
            <span>Start date</span>
            <input
              type="date"
              value={draftRange.start}
              max={draftRange.end}
              onChange={(event) => setDraftRange((current) => ({
                ...current,
                start: event.target.value,
              }))}
            />
          </label>
          <label className="people-field">
            <span>End date</span>
            <input
              type="date"
              value={draftRange.end}
              min={draftRange.start}
              max={today}
              onChange={(event) => setDraftRange((current) => ({
                ...current,
                end: event.target.value,
              }))}
            />
          </label>
          <button type="submit" className="btn" disabled={loading}>
            {loading ? 'Loading…' : 'Apply range'}
          </button>
        </div>
        {rangeError && (
          <p className="analytics-range-error" role="alert">
            <i className="ri-error-warning-line" />
            {rangeError}
          </p>
        )}
      </form>

      {error ? (
        <AppState
          type="error"
          title="Analytics could not be loaded"
          message={error}
          action={<button type="button" className="btn btn-outline" onClick={fetchEntries}>Try again</button>}
        />
      ) : loading ? (
        <AppState
          type="loading"
          title="Building the organisation view"
          message="Adding worked time and breaks across the selected period."
        />
      ) : (
        <>
          <section className="analytics-kpi-grid" aria-label="Reporting period totals">
            <article className="card analytics-kpi">
              <span className="analytics-kpi-icon analytics-kpi-icon--primary"><i className="ri-time-line" /></span>
              <div><span>Worked time</span><strong>{formatDuration(summary.workedSeconds)}</strong></div>
            </article>
            <article className="card analytics-kpi">
              <span className="analytics-kpi-icon analytics-kpi-icon--amber"><i className="ri-cup-line" /></span>
              <div><span>Break time</span><strong>{formatDuration(summary.breakSeconds)}</strong></div>
            </article>
            <article className="card analytics-kpi">
              <span className="analytics-kpi-icon analytics-kpi-icon--blue"><i className="ri-calendar-check-line" /></span>
              <div><span>Work sessions</span><strong>{summary.sessions}</strong></div>
            </article>
            <article className="card analytics-kpi">
              <span className="analytics-kpi-icon analytics-kpi-icon--violet"><i className="ri-team-line" /></span>
              <div><span>Active employees</span><strong>{summary.employees}</strong></div>
            </article>
          </section>

          {entries.length === 0 ? (
            <AppState
              type="empty"
              title="No tracked work in this period"
              message="Choose another date range once employees have completed work sessions."
            />
          ) : (
            <div className="analytics-chart-grid">
              <DistributionChart
                title="Projects"
                description="Client and delivery work"
                data={distributions.projects}
                emptyMessage="No project time was tracked in this period."
                accent="green"
              />
              <DistributionChart
                title="Internal activities"
                description="Approved non-project work"
                data={distributions.activities}
                emptyMessage="No internal activity time was tracked in this period."
                accent="amber"
              />
              <DistributionChart
                title="Departments"
                description="Worked time by organisation unit"
                data={distributions.departments}
                emptyMessage="No department time is available."
                accent="blue"
              />
              <DistributionChart
                title="Employees"
                description="Individual contribution in the period"
                data={distributions.employees}
                emptyMessage="No employee time is available."
                accent="violet"
              />
            </div>
          )}
        </>
      )}
    </Layout>
  );
};

export default WorkDistribution;
