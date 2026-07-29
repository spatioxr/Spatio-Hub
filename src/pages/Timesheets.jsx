import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import AppState from '../components/AppState';
import { AuthContext } from '../context/AuthContext';
import { WorkSessionContext } from '../context/WorkSessionContext';
import { supabase } from '../utils/supabaseClient';
import { hasPermission, PERMISSIONS } from '../utils/rbac';

const SCOPE_COPY = {
  personal: {
    label: 'Personal',
    eyebrow: 'Personal',
    heading: 'My timesheet',
    description: 'A focused view of your tracked work, breaks, and daily context.',
  },
  managed: {
    label: 'Managed by me',
    eyebrow: 'Project teams',
    heading: 'Team timesheets',
    description: 'Weekly work for people assigned to projects you manage.',
  },
  organisation: {
    label: 'Organisation',
    eyebrow: 'Organisation',
    heading: 'Organisation timesheets',
    description: 'Company-wide weekly totals with a clear path to each person.',
  },
};

const startOfWeek = (date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const dateKey = (value) => {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDuration = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
};

const formatClock = (value) => (
  value
    ? new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value))
    : 'Now'
);

const formatWeekRange = (weekStart) => {
  const weekEnd = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
  const start = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    ...(sameMonth ? {} : { month: 'short' }),
  }).format(weekStart);
  const end = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(weekEnd);
  return `${start} – ${end}`;
};

const Timesheets = () => {
  const { user } = useContext(AuthContext);
  const { status: workStatus } = useContext(WorkSessionContext);
  const availableScopes = useMemo(() => {
    const scopes = ['personal'];
    if (hasPermission(user, PERMISSIONS.VIEW_ASSIGNED_TEAM_TIMESHEETS)) {
      scopes.push('managed');
    }
    if (hasPermission(user, PERMISSIONS.VIEW_ORGANISATION_TIMESHEETS)) {
      return ['personal', 'organisation'];
    }
    return scopes;
  }, [user]);
  const [scope, setScope] = useState('personal');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('all');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [entries, setEntries] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );

  const loadTimesheet = useCallback(async () => {
    setLoading(true);
    setError('');

    const rangeEnd = addDays(weekStart, 7);
    const [
      { data: entryData, error: entryError },
      { data: memberData, error: memberError },
    ] = await Promise.all([
      supabase.rpc('scoped_timesheet_entries', {
        requested_start_at: weekStart.toISOString(),
        requested_end_at: rangeEnd.toISOString(),
        requested_scope: scope,
        requested_employee_id: selectedEmployeeId === 'all' ? null : selectedEmployeeId,
      }),
      supabase.rpc('timesheet_scope_members', {
        requested_scope: scope,
      }),
    ]);

    const fetchError = entryError || memberError;
    if (fetchError) {
      setEntries([]);
      setMembers([]);
      setError(fetchError.message || 'Unable to load your timesheet.');
    } else {
      setEntries(entryData || []);
      setMembers(memberData || []);
    }
    setLoading(false);
  }, [scope, selectedEmployeeId, weekStart]);

  useEffect(() => {
    void loadTimesheet();
  }, [loadTimesheet, workStatus]);

  const entriesByDay = useMemo(() => {
    const grouped = Object.fromEntries(weekDays.map((day) => [dateKey(day), []]));
    entries.forEach((entry) => {
      const key = dateKey(entry.started_at);
      if (grouped[key]) grouped[key].push(entry);
    });
    return grouped;
  }, [entries, weekDays]);

  const daySummaries = useMemo(() => (
    Object.fromEntries(weekDays.map((day) => {
      const key = dateKey(day);
      const dayEntries = entriesByDay[key] || [];
      return [key, {
        workedSeconds: dayEntries.reduce(
          (total, entry) => total + Number(entry.worked_seconds || 0),
          0,
        ),
        breakSeconds: dayEntries.reduce(
          (total, entry) => total + Number(entry.break_seconds || 0),
          0,
        ),
        sessionCount: dayEntries.length,
      }];
    }))
  ), [entriesByDay, weekDays]);

  const weeklySummary = useMemo(() => (
    Object.values(daySummaries).reduce(
      (summary, day) => ({
        workedSeconds: summary.workedSeconds + day.workedSeconds,
        breakSeconds: summary.breakSeconds + day.breakSeconds,
        sessionCount: summary.sessionCount + day.sessionCount,
        activeDays: summary.activeDays + (day.sessionCount > 0 ? 1 : 0),
      }),
      { workedSeconds: 0, breakSeconds: 0, sessionCount: 0, activeDays: 0 },
    )
  ), [daySummaries]);

  const selectedMember = members.find((member) => member.employee_id === selectedEmployeeId);
  const scopeCopy = SCOPE_COPY[scope];
  const isSharedScope = scope !== 'personal';
  const selectedEntries = entriesByDay[selectedDate] || [];
  const selectedSummary = daySummaries[selectedDate] || {
    workedSeconds: 0,
    breakSeconds: 0,
    sessionCount: 0,
  };
  const selectedDateValue = new Date(`${selectedDate}T00:00:00`);

  const moveWeek = (offset) => {
    const nextWeek = addDays(weekStart, offset * 7);
    setWeekStart(nextWeek);
    setSelectedDate(dateKey(nextWeek));
  };

  const goToCurrentWeek = () => {
    const today = new Date();
    setWeekStart(startOfWeek(today));
    setSelectedDate(dateKey(today));
  };

  const changeScope = (nextScope) => {
    setScope(nextScope);
    setSelectedEmployeeId('all');
  };

  return (
    <Layout
      title="Timesheets"
      eyebrow={scopeCopy.eyebrow}
      heading={scopeCopy.heading}
      description={scopeCopy.description}
      actions={(
        <button type="button" className="btn btn-outline timesheet-today" onClick={goToCurrentWeek}>
          Today
        </button>
      )}
    >
      {(availableScopes.length > 1 || isSharedScope) && (
        <section className="filter-bar timesheet-controls" aria-label="Timesheet scope">
          {availableScopes.length > 1 && (
            <div className="app-tabs">
              {availableScopes.map((availableScope) => (
                <button
                  type="button"
                  className={`app-tab${scope === availableScope ? ' active' : ''}`}
                  key={availableScope}
                  onClick={() => changeScope(availableScope)}
                >
                  {SCOPE_COPY[availableScope].label}
                </button>
              ))}
            </div>
          )}
          {isSharedScope && (
            <label className="timesheet-person-select">
              <span>Person</span>
              <select
                value={selectedEmployeeId}
                onChange={(event) => setSelectedEmployeeId(event.target.value)}
              >
                <option value="all">
                  {scope === 'organisation' ? 'All people' : 'Entire managed team'}
                </option>
                {members.map((member) => (
                  <option key={member.employee_id} value={member.employee_id}>
                    {member.employee_name} ({member.employee_code})
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
      )}

      <section className="timesheet-summary" aria-label="Weekly summary">
        <article className="timesheet-summary-card timesheet-summary-card--primary">
          <span>
            {selectedMember ? `${selectedMember.employee_name} · worked` : 'Worked this week'}
          </span>
          <strong>{formatDuration(weeklySummary.workedSeconds)}</strong>
          <small>Break time is excluded</small>
        </article>
        <article className="timesheet-summary-card">
          <span>Breaks</span>
          <strong>{formatDuration(weeklySummary.breakSeconds)}</strong>
          <small>Across {weeklySummary.sessionCount} session{weeklySummary.sessionCount === 1 ? '' : 's'}</small>
        </article>
        <article className="timesheet-summary-card">
          <span>{isSharedScope ? 'People in scope' : 'Active days'}</span>
          <strong>{isSharedScope ? members.length : weeklySummary.activeDays}</strong>
          <small>
            {isSharedScope
              ? selectedMember ? selectedMember.employee_code : 'Available for individual review'
              : 'of 7 days in this week'}
          </small>
        </article>
      </section>

      <section className="surface timesheet-week">
        <div className="timesheet-week-toolbar">
          <button type="button" className="timesheet-nav-button" onClick={() => moveWeek(-1)} aria-label="Previous week">
            <i className="ri-arrow-left-s-line" />
          </button>
          <div>
            <span className="page-eyebrow">Week</span>
            <h3>{formatWeekRange(weekStart)}</h3>
          </div>
          <button type="button" className="timesheet-nav-button" onClick={() => moveWeek(1)} aria-label="Next week">
            <i className="ri-arrow-right-s-line" />
          </button>
        </div>

        {loading ? (
          <AppState
            type="loading"
            title={isSharedScope ? 'Loading scoped timesheets' : 'Loading your week'}
            message="Collecting sessions and break totals."
            compact
          />
        ) : error ? (
          <AppState
            type="error"
            title="Timesheet unavailable"
            message={error}
            action={(
              <button type="button" className="btn btn-outline" onClick={loadTimesheet}>
                Try again
              </button>
            )}
            compact
          />
        ) : (
          <>
            <div className="timesheet-days" role="tablist" aria-label="Days in selected week">
              {weekDays.map((day) => {
                const key = dateKey(day);
                const summary = daySummaries[key];
                const isSelected = key === selectedDate;
                const isToday = key === dateKey(new Date());
                return (
                  <button
                    type="button"
                    className={`timesheet-day${isSelected ? ' timesheet-day--selected' : ''}`}
                    key={key}
                    onClick={() => setSelectedDate(key)}
                    role="tab"
                    aria-selected={isSelected}
                  >
                    <span>{day.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                    <strong>{day.getDate()}</strong>
                    <b>{formatDuration(summary.workedSeconds)}</b>
                    <small>
                      {summary.sessionCount
                        ? `${summary.sessionCount} session${summary.sessionCount === 1 ? '' : 's'}`
                        : 'No entries'}
                    </small>
                    {isToday && <i className="timesheet-today-dot" aria-label="Today" />}
                  </button>
                );
              })}
            </div>

            <div className="timesheet-detail">
              <div className="timesheet-detail-header">
                <div>
                  <span className="page-eyebrow">Day detail</span>
                  <h3>
                    {selectedDateValue.toLocaleDateString('en-IN', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </h3>
                </div>
                <div className="timesheet-day-totals">
                  <span>
                    <small>Worked</small>
                    <strong>{formatDuration(selectedSummary.workedSeconds)}</strong>
                  </span>
                  <span>
                    <small>Breaks</small>
                    <strong>{formatDuration(selectedSummary.breakSeconds)}</strong>
                  </span>
                </div>
              </div>

              {selectedEntries.length === 0 ? (
                <AppState
                  type="empty"
                  title={isSharedScope ? 'No scoped work tracked' : 'No work tracked'}
                  message={
                    isSharedScope
                      ? 'There are no permitted sessions for this selection and day.'
                      : 'There are no sessions recorded for this day.'
                  }
                  compact
                />
              ) : (
                <ol className="timesheet-timeline">
                  {selectedEntries.map((entry) => (
                    <li className="timesheet-session" key={entry.work_entry_id}>
                      <span className={`timesheet-context-icon timesheet-context-icon--${entry.context_type}`}>
                        <i className={entry.context_type === 'project' ? 'ri-folder-3-line' : 'ri-flashlight-line'} />
                      </span>
                      <div className="timesheet-session-body">
                        <div className="timesheet-session-heading">
                          <div>
                            {isSharedScope && (
                              <span className="timesheet-person">
                                {entry.employee_name} · {entry.employee_code}
                              </span>
                            )}
                            <span className="timesheet-context-type">
                              {entry.context_type === 'project' ? 'Project' : 'Activity'}
                            </span>
                            <h4>{entry.context_label}</h4>
                          </div>
                          <span className="timesheet-session-duration">
                            {formatDuration(entry.worked_seconds)}
                          </span>
                        </div>
                        <p>{entry.task_description}</p>
                        <div className="timesheet-session-meta">
                          <span>
                            <i className="ri-time-line" />
                            {formatClock(entry.started_at)} – {formatClock(entry.ended_at)}
                          </span>
                          {!entry.ended_at && <span className="badge success">In progress</span>}
                        </div>
                        {(entry.breaks || []).length > 0 && (
                          <div className="timesheet-break-list">
                            {(entry.breaks || []).map((breakEntry) => (
                              <div key={breakEntry.id}>
                                <span>
                                  <i className="ri-cup-line" />
                                  Break · {formatClock(breakEntry.started_at)} – {formatClock(breakEntry.ended_at)}
                                </span>
                                <strong>{formatDuration(breakEntry.duration_seconds)}</strong>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </section>
    </Layout>
  );
};

export default Timesheets;
