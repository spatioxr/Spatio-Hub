import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AppState from '../components/AppState';
import Layout from '../components/Layout';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { getRole, ROLES } from '../utils/rbac';
import {
  buildWorkDistributionCsv,
  workDistributionCsvFilename,
} from '../utils/workDistributionCsv';
import {
  addAppDays,
  appDateDistance,
  appDateKey,
  appDayRange,
  formatAppClock,
  formatAppDate,
  formatAppDateTime,
} from '../utils/timezone';
import {
  downtimeCategoryLabel,
  downtimeStatusLabel,
  sumDowntimeSeconds,
} from '../utils/downtime';

const MAX_RANGE_DAYS = 31;

const dateKey = appDateKey;
const addDays = addAppDays;

const rangeLength = (startDate, endDate) => appDateDistance(startDate, endDate) + 1;

const formatDuration = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
};

const formatRange = (startDate, endDate) => {
  return `${formatAppDate(startDate)} – ${formatAppDate(endDate)}`;
};

const formatEntryDate = formatAppDate;
const formatClock = formatAppClock;

const uniqueOptions = (entries, keyForEntry, labelForEntry) => (
  [...new Map(entries.map((entry) => [
    keyForEntry(entry),
    { value: keyForEntry(entry), label: labelForEntry(entry) },
  ])).values()]
    .filter((option) => option.value)
    .sort((left, right) => left.label.localeCompare(right.label))
);

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

const DistributionChart = ({
  title,
  description,
  data,
  emptyMessage,
  accent,
  dimension,
  activeKey,
  onSelect,
}) => {
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
              <button
                type="button"
                className={`analytics-bar-row${activeKey === item.key ? ' analytics-bar-row--active' : ''}`}
                key={item.key}
                aria-label={`${item.label}: ${formatDuration(item.seconds)}`}
                aria-pressed={activeKey === item.key}
                onClick={() => onSelect(dimension, item)}
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
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};

const WorkDistribution = () => {
  const { user } = useContext(AuthContext);
  const isManager = getRole(user) === ROLES.MANAGER;
  const analyticsScope = isManager ? 'managed' : 'organisation';
  const today = dateKey();
  const initialStart = addDays(today, -6);
  const [draftRange, setDraftRange] = useState({ start: initialStart, end: today });
  const [appliedRange, setAppliedRange] = useState({ start: initialStart, end: today });
  const [entries, setEntries] = useState([]);
  const [downtimeEvents, setDowntimeEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rangeError, setRangeError] = useState('');
  const [filters, setFilters] = useState({
    project: 'all',
    activity: 'all',
    department: 'all',
    employee: 'all',
  });
  const entriesRef = useRef(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError('');

    const range = appDayRange(appliedRange.start, appliedRange.end);
    const [entryResult, downtimeResult] = await Promise.all([
      supabase.rpc('scoped_timesheet_entries', {
        requested_start_at: range.start,
        requested_end_at: range.end,
        requested_scope: analyticsScope,
        requested_employee_id: null,
      }),
      supabase.rpc('organisation_downtime_for_period', {
        requested_start_at: range.start,
        requested_end_at: range.end,
      }),
    ]);
    const fetchError = entryResult.error || downtimeResult.error;

    if (fetchError) {
      setEntries([]);
      setDowntimeEvents([]);
      setError(fetchError.message || 'Unable to load work-distribution analytics.');
    } else {
      setEntries(entryResult.data || []);
      setDowntimeEvents(downtimeResult.data || []);
    }
    setLoading(false);
  }, [analyticsScope, appliedRange]);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  const filterOptions = useMemo(() => ({
    projects: uniqueOptions(
      entries.filter((entry) => entry.context_type === 'project'),
      (entry) => entry.context_id,
      (entry) => entry.context_label,
    ),
    activities: uniqueOptions(
      entries.filter((entry) => entry.context_type === 'activity'),
      (entry) => entry.context_id,
      (entry) => entry.context_label,
    ),
    departments: uniqueOptions(
      entries,
      (entry) => entry.employee_department || 'not-assigned',
      (entry) => entry.employee_department || 'Not assigned',
    ),
    employees: uniqueOptions(
      entries,
      (entry) => entry.employee_id,
      (entry) => (
        `${entry.employee_name || 'Unknown employee'}${entry.employee_code ? ` (${entry.employee_code})` : ''}`
      ),
    ),
  }), [entries]);

  const filteredEntries = useMemo(() => entries.filter((entry) => {
    const employeeMatches = filters.employee === 'all'
      || entry.employee_id === filters.employee;
    const departmentMatches = filters.department === 'all'
      || (entry.employee_department || 'not-assigned') === filters.department;
    const projectFilterActive = filters.project !== 'all';
    const activityFilterActive = filters.activity !== 'all';
    const contextMatches = !projectFilterActive && !activityFilterActive
      ? true
      : (
        (projectFilterActive
          && entry.context_type === 'project'
          && entry.context_id === filters.project)
        || (activityFilterActive
          && entry.context_type === 'activity'
          && entry.context_id === filters.activity)
      );

    return employeeMatches && departmentMatches && contextMatches;
  }), [entries, filters]);

  const activeFilters = useMemo(() => {
    const labels = {
      project: 'Project',
      activity: 'Activity',
      department: 'Department',
      employee: 'Employee',
    };
    const options = {
      project: filterOptions.projects,
      activity: filterOptions.activities,
      department: filterOptions.departments,
      employee: filterOptions.employees,
    };

    return Object.entries(filters)
      .filter(([, value]) => value !== 'all')
      .map(([key, value]) => ({
        key,
        label: labels[key],
        value: options[key].find((option) => option.value === value)?.label || 'Selected',
      }));
  }, [filterOptions, filters]);

  const summary = useMemo(() => {
    const workedSeconds = filteredEntries.reduce(
      (total, entry) => total + (Number(entry.worked_seconds) || 0),
      0,
    );
    const breakSeconds = filteredEntries.reduce(
      (total, entry) => total + (Number(entry.break_seconds) || 0),
      0,
    );
    return {
      workedSeconds,
      breakSeconds,
      sessions: filteredEntries.length,
      employees: new Set(filteredEntries.map((entry) => entry.employee_id)).size,
      downtimeSeconds: sumDowntimeSeconds(downtimeEvents),
    };
  }, [downtimeEvents, filteredEntries]);

  const distributions = useMemo(() => ({
    projects: aggregateEntries(
      filteredEntries.filter((entry) => entry.context_type === 'project'),
      (entry) => entry.context_id || entry.context_label,
      (entry) => entry.context_label,
    ),
    activities: aggregateEntries(
      filteredEntries.filter((entry) => entry.context_type === 'activity'),
      (entry) => entry.context_id || entry.context_label,
      (entry) => entry.context_label,
    ),
    departments: aggregateEntries(
      filteredEntries,
      (entry) => entry.employee_department || 'not-assigned',
      (entry) => entry.employee_department || 'Not assigned',
    ),
    employees: aggregateEntries(
      filteredEntries,
      (entry) => entry.employee_id,
      (entry) => entry.employee_name || entry.employee_code || 'Unknown employee',
    ),
  }), [filteredEntries]);

  const visibleEntries = useMemo(() => (
    [...filteredEntries].sort((left, right) => (
      new Date(right.started_at) - new Date(left.started_at)
    ))
  ), [filteredEntries]);

  const clearFilters = () => setFilters({
    project: 'all',
    activity: 'all',
    department: 'all',
    employee: 'all',
  });

  const changeFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const removeFilter = (key) => {
    setFilters((current) => ({ ...current, [key]: 'all' }));
  };

  const drillIntoEntries = (dimension, item) => {
    setFilters((current) => {
      const nextValue = current[dimension] === item.key ? 'all' : item.key;
      if (dimension === 'project') {
        return { ...current, project: nextValue, activity: 'all' };
      }
      if (dimension === 'activity') {
        return { ...current, activity: nextValue, project: 'all' };
      }
      return { ...current, [dimension]: nextValue };
    });
    window.requestAnimationFrame(() => {
      entriesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const exportCsv = () => {
    if (visibleEntries.length === 0 && downtimeEvents.length === 0) return;

    const csv = buildWorkDistributionCsv(visibleEntries, summary, downtimeEvents);
    const downloadUrl = URL.createObjectURL(new Blob([csv], {
      type: 'text/csv;charset=utf-8',
    }));
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = workDistributionCsvFilename(appliedRange);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  };

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
    clearFilters();
    setAppliedRange({ ...draftRange });
  };

  return (
    <Layout
      title="Analytics"
      eyebrow={isManager ? 'Managed projects' : 'Organisation reporting'}
      heading="Work distribution"
      description={isManager
        ? 'Understand where time is going across projects and people assigned to projects you manage.'
        : 'Understand where team time is going across projects, internal activities, departments, and people.'}
      actions={(
        <button
          type="button"
          className="btn btn-outline analytics-export-button"
          onClick={exportCsv}
          disabled={loading || Boolean(error) || (visibleEntries.length === 0 && downtimeEvents.length === 0)}
          title={visibleEntries.length > 0 || downtimeEvents.length > 0
            ? `Export ${visibleEntries.length} filtered work ${visibleEntries.length === 1 ? 'entry' : 'entries'} and ${downtimeEvents.length} downtime ${downtimeEvents.length === 1 ? 'event' : 'events'}`
            : 'No work or downtime is available to export'}
        >
          <i className="ri-download-2-line" />
          Export CSV
        </button>
      )}
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
          title={`Building the ${isManager ? 'managed-project' : 'organisation'} view`}
          message="Adding worked time and breaks across the selected permitted period."
        />
      ) : (
        <>
          <section className="card analytics-filter-panel" aria-label="Analytics filters">
            <div className="analytics-filter-heading">
              <div>
                <span className="page-eyebrow">Filters</span>
                <h2>Interpret this period</h2>
                <p>Projects and activities combine; department and employee narrow the same result.</p>
              </div>
              {activeFilters.length > 0 && (
                <button type="button" className="timesheet-clear-filters" onClick={clearFilters}>
                  <i className="ri-filter-off-line" />
                  Clear all
                </button>
              )}
            </div>

            <div className="analytics-filter-grid">
              <label className="timesheet-filter-field">
                <span>Project</span>
                <select
                  value={filters.project}
                  onChange={(event) => changeFilter('project', event.target.value)}
                >
                  <option value="all">All projects</option>
                  {filterOptions.projects.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="timesheet-filter-field">
                <span>Activity</span>
                <select
                  value={filters.activity}
                  onChange={(event) => changeFilter('activity', event.target.value)}
                >
                  <option value="all">All activities</option>
                  {filterOptions.activities.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="timesheet-filter-field">
                <span>Department</span>
                <select
                  value={filters.department}
                  onChange={(event) => changeFilter('department', event.target.value)}
                >
                  <option value="all">All departments</option>
                  {filterOptions.departments.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="timesheet-filter-field">
                <span>Employee</span>
                <select
                  value={filters.employee}
                  onChange={(event) => changeFilter('employee', event.target.value)}
                >
                  <option value="all">All employees</option>
                  {filterOptions.employees.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {activeFilters.length > 0 && (
              <div className="analytics-active-filters" aria-label="Active analytics filters">
                <span>{activeFilters.length} active</span>
                {activeFilters.map((filter) => (
                  <button
                    type="button"
                    className="analytics-filter-chip"
                    key={filter.key}
                    onClick={() => removeFilter(filter.key)}
                    aria-label={`Remove ${filter.label} filter`}
                  >
                    <small>{filter.label}</small>
                    <span>{filter.value}</span>
                    <i className="ri-close-line" />
                  </button>
                ))}
              </div>
            )}
          </section>

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
            <article className="card analytics-kpi">
              <span className="analytics-kpi-icon analytics-kpi-icon--danger"><i className="ri-alarm-warning-line" /></span>
              <div><span>Organisation downtime</span><strong>{formatDuration(summary.downtimeSeconds)}</strong></div>
            </article>
          </section>

          {downtimeEvents.length > 0 && (
            <section className="card analytics-downtime-panel" aria-labelledby="analytics-downtime-title">
              <div>
                <span className="page-eyebrow">Separate company measure</span>
                <h2 id="analytics-downtime-title">Downtime in this reporting period</h2>
                <p>These events are not multiplied by employee count and do not change worked or break time.</p>
              </div>
              <ol>
                {downtimeEvents.map((event) => (
                  <li key={event.downtime_event_id}>
                    <div>
                      <strong>{event.title}</strong>
                      <span>{downtimeCategoryLabel(event.category)} · {downtimeStatusLabel(event.event_status)}</span>
                    </div>
                    <span>{formatAppDateTime(event.started_at)}{event.ended_at ? ` – ${formatAppDateTime(event.ended_at)}` : ''}</span>
                    <b>{formatDuration(event.recorded_seconds)}</b>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {entries.length === 0 ? (
            <AppState
              type="empty"
              title="No tracked work in this period"
              message="Choose another date range once employees have completed work sessions."
            />
          ) : filteredEntries.length === 0 ? (
            <AppState
              type="empty"
              title="No entries match these filters"
              message="Remove one or more filters to restore matching work sessions."
              action={<button type="button" className="btn btn-outline" onClick={clearFilters}>Clear filters</button>}
            />
          ) : (
            <>
              <div className="analytics-chart-grid">
                <DistributionChart
                  title="Projects"
                  description="Client and delivery work · select a bar to drill down"
                  data={distributions.projects}
                  emptyMessage="No project time matches this view."
                  accent="green"
                  dimension="project"
                  activeKey={filters.project}
                  onSelect={drillIntoEntries}
                />
                <DistributionChart
                  title="Internal activities"
                  description="Approved non-project work · select a bar to drill down"
                  data={distributions.activities}
                  emptyMessage="No internal activity time matches this view."
                  accent="amber"
                  dimension="activity"
                  activeKey={filters.activity}
                  onSelect={drillIntoEntries}
                />
                <DistributionChart
                  title="Departments"
                  description="Worked time by organisation unit · select a bar to drill down"
                  data={distributions.departments}
                  emptyMessage="No department time matches this view."
                  accent="blue"
                  dimension="department"
                  activeKey={filters.department}
                  onSelect={drillIntoEntries}
                />
                <DistributionChart
                  title="Employees"
                  description="Individual contribution · select a bar to drill down"
                  data={distributions.employees}
                  emptyMessage="No employee time matches this view."
                  accent="violet"
                  dimension="employee"
                  activeKey={filters.employee}
                  onSelect={drillIntoEntries}
                />
              </div>

              <section className="card analytics-entry-panel" ref={entriesRef}>
                <div className="analytics-entry-heading">
                  <div>
                    <span className="page-eyebrow">Drill-down</span>
                    <h2>Supporting entries</h2>
                    <p>
                      {activeFilters.length > 0
                        ? 'Only work sessions matching the combined active filters are shown.'
                        : 'All work sessions behind the current reporting period.'}
                    </p>
                  </div>
                  <span>{visibleEntries.length} {visibleEntries.length === 1 ? 'entry' : 'entries'}</span>
                </div>

                <ol className="analytics-entry-list">
                  {visibleEntries.map((entry) => (
                    <li key={entry.work_entry_id} className="analytics-entry">
                      <span className={`analytics-entry-icon analytics-entry-icon--${entry.context_type}`}>
                        <i className={entry.context_type === 'project' ? 'ri-folder-3-line' : 'ri-flashlight-line'} />
                      </span>
                      <div className="analytics-entry-main">
                        <div>
                          <span className="analytics-entry-person">
                            {entry.employee_name} · {entry.employee_code}
                          </span>
                          <strong>{entry.context_label}</strong>
                          <small>
                            {entry.context_type === 'project' ? 'Project' : 'Activity'}
                            {' · '}
                            {entry.employee_department || 'No department'}
                          </small>
                        </div>
                        <p>{entry.task_description || 'No task description recorded.'}</p>
                      </div>
                      <div className="analytics-entry-time">
                        <strong>{formatDuration(entry.worked_seconds)}</strong>
                        <span>{formatEntryDate(entry.started_at)}</span>
                        <small>{formatClock(entry.started_at)} – {formatClock(entry.ended_at)}</small>
                        {Number(entry.break_seconds) > 0 && (
                          <small>Break {formatDuration(entry.break_seconds)}</small>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </>
      )}
    </Layout>
  );
};

export default WorkDistribution;
