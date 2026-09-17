import useListSort from '../hooks/useListSort';
import ListSortControls from '../components/ListSortControls';
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AnalyticsPeriodPicker from '../components/AnalyticsPeriodPicker';
import { earliestAnalyticsDate, loadAnalytics } from '../utils/analyticsData';
import AppState from '../components/AppState';
import Layout from '../components/Layout';
import './WorkDistribution.css';
import './AnalyticsNavigation.css';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { getRole, ROLES } from '../utils/rbac';
import useAnalyticsNavigation from '../hooks/useAnalyticsNavigation';
import {
  changeAnalyticsFilter,
  emptyAnalyticsFilters,
  retainAnalyticsOption,
} from '../utils/analyticsNavigation';
import {
  ANALYTICS_EXPORT_TYPES,
  buildDailyEmployeeCsv,
  buildOrganisationDowntimeCsv,
  buildWorkDistributionCsv,
  workDistributionCsvFilename,
} from '../utils/workDistributionCsv';
import {
  appDateKey,
  formatAppClock,
  formatAppDate,
  formatAppDateTime,
} from '../utils/timezone';
import {
  downtimeCategoryLabel,
  downtimeStatusLabel,
  sumDowntimeSeconds,
} from '../utils/downtime';

const dateKey = appDateKey;

const formatDuration = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
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
                onClick={(event) => onSelect(dimension, item, event.currentTarget)}
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
  const listSort = useListSort('entryList', [{ key: 'date', label: 'Start time', value: (item) => Date.parse(item.started_at) }, { key: 'person', label: 'Person', value: (item) => item.employee_name }, { key: 'context', label: 'Project / activity', value: (item) => item.context_label }, { key: 'hours', label: 'Worked time', value: (item) => Number(item.worked_seconds) }], 'date', 'desc');
  const { user } = useContext(AuthContext);
  const isManager = getRole(user) === ROLES.MANAGER;
  const analyticsScope = isManager ? 'managed' : 'organisation';
  const today = dateKey();
  const { range: appliedRange, mode, filters, updateView } = useAnalyticsNavigation(user.id, today);
  const [detailRows, setDetailRows] = useState([]);
  const [detailsLoaded, setDetailsLoaded] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const periodKey = `${user.id}:${analyticsScope}:${appliedRange.start}:${appliedRange.end}`;
  const [settledPeriod, setSettledPeriod] = useState('');
  const [exporting, setExporting] = useState(false);
  const [detailLimit, setDetailLimit] = useState(200);
  useEffect(() => setDetailLimit(200), [appliedRange, filters]);
  const [entries, setEntries] = useState([]);
  const [downtimeEvents, setDowntimeEvents] = useState([]);
  const [fetching, setFetching] = useState(true);
  const loading = fetching || settledPeriod !== periodKey;
  const [exportType, setExportType] = useState('entries');
  const [error, setError] = useState('');
  const entriesRef = useRef(null);
  const filtersRef = useRef(null);
  const chartsRef = useRef(null);
  const entryListRef = useRef(null);
  const selectedBarRef = useRef(null);
  const requestRef = useRef(0);
  const optionLabelsRef = useRef(new Map());

  const fetchEntries = useCallback(async (refresh = false) => {
    const request = ++requestRef.current;
    setFetching(true);
    setError('');
    setDetailsLoaded(false);
    setDetailsLoading(false);
    setDetailRows([]);
    setDetailsError('');
    try {
      const result = await loadAnalytics(supabase, appliedRange, analyticsScope, user.id, {
        refresh: refresh === true, isCurrent: () => request === requestRef.current,
      });
      if (request !== requestRef.current) return;
      setEntries(result.rows);
      setDowntimeEvents(result.downtime);
    } catch (failure) {
      if (request !== requestRef.current) return;
      setEntries([]);
      setDowntimeEvents([]);
      setError(failure.message || 'Unable to load analytics.');
    } finally {
      if (request === requestRef.current) {
        setSettledPeriod(periodKey);
        setFetching(false);
      }
    }
  }, [analyticsScope, appliedRange, user.id, periodKey]);

  useEffect(() => {
    void fetchEntries();
    return () => { requestRef.current += 1; };
  }, [fetchEntries]);

  const loadDetails = async () => {
    const request = requestRef.current;
    setDetailsLoading(true);
    setDetailsError('');
    try {
      const result = await loadAnalytics(supabase, appliedRange, analyticsScope, user.id, {
        details: true, isCurrent: () => request === requestRef.current,
      });
      if (request !== requestRef.current) return null;
      setDetailRows(result.rows);
      setDetailsLoaded(true);
      return result.rows;
    } catch (failure) {
      if (request === requestRef.current) setDetailsError(failure.message || 'Unable to load supporting entries.');
      return null;
    } finally {
      if (request === requestRef.current) setDetailsLoading(false);
    }
  };

  const periodOptions = useMemo(() => ({
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

  useEffect(() => {
    Object.entries(periodOptions).forEach(([dimension, options]) => {
      options.forEach((option) => optionLabelsRef.current.set(`${dimension}:${option.value}`, option.label));
    });
  }, [periodOptions]);

  const filterOptions = useMemo(() => Object.fromEntries(Object.entries(periodOptions).map(([dimension, options]) => {
    const key = { projects: 'project', activities: 'activity', departments: 'department', employees: 'employee' }[dimension];
    return [dimension, retainAnalyticsOption(options, filters[key], optionLabelsRef.current.get(`${dimension}:${filters[key]}`))];
  })), [periodOptions, filters]);

  const matchesFilters = useCallback((entry) => {
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
  }, [filters]);
  const filteredEntries = useMemo(() => entries.filter(matchesFilters), [entries, matchesFilters]);

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
      sessions: filteredEntries.reduce((total, entry) => total + Number(entry.session_count || 1), 0),
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
    detailRows.filter(matchesFilters).sort((left, right) => (
      new Date(right.started_at) - new Date(left.started_at)
    ))
  ), [detailRows, matchesFilters]);

  const clearFilters = () => updateView({ filters: emptyAnalyticsFilters() });

  const changeFilter = (key, value) => {
    updateView({ filters: changeAnalyticsFilter(filters, key, value) });
  };

  const removeFilter = (key) => {
    changeFilter(key, 'all');
  };

  const scrollTo = (target) => {
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  const drillIntoEntries = (dimension, item, button) => {
    selectedBarRef.current = button;
    if (!detailsLoaded && !detailsLoading && !loading) void loadDetails();
    updateView({ filters: changeAnalyticsFilter(filters, dimension, item.key, true) });
    window.requestAnimationFrame(() => {
      if (entryListRef.current) entryListRef.current.scrollTop = 0;
      scrollTo(entriesRef.current);
    });
  };

  const backToCharts = () => scrollTo(
    selectedBarRef.current?.isConnected ? selectedBarRef.current : chartsRef.current,
  );

  const exportCount = exportType === 'downtime' ? downtimeEvents.length : summary.sessions;
  const exportCsv = async () => {
    if (loading || exporting || error || exportCount === 0) return;
    setExporting(true);
    const rows = exportType === 'downtime' ? [] : detailsLoaded ? detailRows : await loadDetails();
    if (!rows) { setExporting(false); return; }
    const exportRows = rows.filter(matchesFilters);

    const csv = exportType === 'downtime'
      ? buildOrganisationDowntimeCsv(downtimeEvents)
      : exportType === 'daily'
        ? buildDailyEmployeeCsv(exportRows)
        : buildWorkDistributionCsv(exportRows);
    const downloadUrl = URL.createObjectURL(new Blob([csv], {
      type: 'text/csv;charset=utf-8',
    }));
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = workDistributionCsvFilename(appliedRange, exportType);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    setExporting(false);
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
        <div className="analytics-export">
          <div className="analytics-export-controls">
            <label htmlFor="analytics-export-format">Export</label>
            <select id="analytics-export-format" value={exportType} onChange={(event) => setExportType(event.target.value)} aria-describedby="analytics-export-help">
              {ANALYTICS_EXPORT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <button type="button" className="btn btn-outline analytics-export-button" onClick={exportCsv}
              disabled={loading || exporting || Boolean(error) || exportCount === 0}>
              <i className="ri-download-2-line" aria-hidden="true" /> {exporting ? 'Preparing…' : 'Export CSV'}
            </button>
          </div>
          <p id="analytics-export-help">
            {exportType === 'downtime'
              ? 'Organisation-wide events for this period; work filters do not apply.'
              : exportType === 'daily'
                ? 'Filtered work, grouped by employee and session start date (IST).'
                : 'One row per filtered work session. Dates and times are in IST.'}
            {' '}Hours are decimal (1.50 = 1h 30m).
            {exportType !== 'downtime' && ' In-progress hours reflect the last data load.'}
            {!loading && !error && exportCount === 0 && ' No matching records to export.'}
          </p>
        </div>
      )}
    >
      <AnalyticsPeriodPicker range={appliedRange} mode={mode} today={today} loading={loading}
        onChange={(range, nextMode) => updateView({ range, mode: nextMode })}
        onAllTime={() => earliestAnalyticsDate(supabase, today)} />
      {!loading && detailsError && <p role="alert" className="analytics-update-note">{detailsError}</p>}

      <div className="analytics-results" aria-busy={loading}>
        {loading && <div className="analytics-results-skeleton" aria-hidden="true">
          <div className="card analytics-skeleton-filters"><span /><div>{Array.from({ length: 4 }, (_, i) => <span key={i} />)}</div></div>
          <div className="analytics-kpi-grid">{Array.from({ length: 5 }, (_, i) => <div className="card analytics-skeleton-kpi" key={i}><span /><span /></div>)}</div>
          <div className="analytics-chart-grid">{Array.from({ length: 4 }, (_, i) => <div className="card analytics-skeleton-chart" key={i}><span />{[85, 65, 45].map((width) => <span key={width} style={{ width: `${width}%` }} />)}</div>)}</div>
        </div>}
        <div className={loading ? 'analytics-results-content analytics-results-content--loading' : 'analytics-results-content'} aria-hidden={loading || undefined} inert={loading ? '' : undefined}>
      {error ? (
        <AppState
          type="error"
          title="Analytics could not be loaded"
          message={error}
          action={<button type="button" className="btn btn-outline" onClick={() => fetchEntries(true)}>Try again</button>}
        />
      ) : (
        <>
          <section className="card analytics-filter-panel" aria-label="Analytics filters" ref={filtersRef} tabIndex={-1}>
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
              <div className="analytics-chart-grid" ref={chartsRef} tabIndex={-1} aria-label="Work distribution charts">
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

              <section className="card analytics-entry-panel" ref={entriesRef} tabIndex={-1} aria-label="Supporting entries">
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
                  <span>{summary.sessions} {summary.sessions === 1 ? 'entry' : 'entries'}</span>
                </div>

                <div className="analytics-entry-navigation">
                  <div className="analytics-entry-navigation-actions">
                    <button type="button" className="btn btn-outline" onClick={backToCharts}>
                      <i className="ri-arrow-up-line" aria-hidden="true" /> Back to charts
                    </button>
                    <button type="button" className="btn btn-outline" onClick={() => scrollTo(filtersRef.current)}>Edit filters</button>
                    {activeFilters.length > 0 && <button type="button" className="timesheet-clear-filters" onClick={clearFilters}>Clear all filters</button>}
                  </div>
                  {activeFilters.length > 0 && (
                    <div className="analytics-active-filters" aria-label="Supporting entries filters">
                      {activeFilters.map((filter) => (
                        <button type="button" className="analytics-filter-chip" key={filter.key}
                          onClick={() => removeFilter(filter.key)} aria-label={`Remove ${filter.label} filter from supporting entries`}>
                          <small>{filter.label}</small><span>{filter.value}</span><i className="ri-close-line" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {!detailsLoaded && <button type="button" className="btn btn-outline" disabled={loading || detailsLoading} onClick={loadDetails}>{detailsLoading ? 'Loading entries…' : 'Load supporting entries'}</button>}
                {detailsLoaded && <ListSortControls sort={listSort} />}
                <ol className="analytics-entry-list" ref={entryListRef}>
                  {listSort.sort(visibleEntries).slice(0, detailLimit).map((entry) => (
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
                {visibleEntries.length > detailLimit && <button type="button" className="btn btn-outline" onClick={() => setDetailLimit((count) => count + 200)}>Show more entries ({detailLimit} of {visibleEntries.length})</button>}
              </section>
            </>
          )}
        </>
      )}
        </div>
      </div>
    </Layout>
  );
};

export default WorkDistribution;
