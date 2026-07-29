import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import AppState from '../components/AppState';
import { AuthContext } from '../context/AuthContext';
import { WorkSessionContext } from '../context/WorkSessionContext';
import { supabase } from '../utils/supabaseClient';
import {
  getRole,
  hasPermission,
  PERMISSIONS,
  ROLES,
} from '../utils/rbac';

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

const formatDateTime = (value) => (
  value
    ? new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value))
    : 'Not recorded'
);

const formatAuditBreaks = (breaks) => {
  if (!Array.isArray(breaks) || breaks.length === 0) return 'No breaks';
  return breaks.map((breakEntry) => (
    `${formatClock(breakEntry.started_at)} – ${formatClock(breakEntry.ended_at)}`
  )).join(', ');
};

const AUDIT_FIELDS = [
  {
    key: 'context',
    label: 'Project or activity',
    value: (record) => record?.context_label || 'Not recorded',
  },
  {
    key: 'task',
    label: 'Task description',
    value: (record) => record?.task_description || 'Not recorded',
  },
  {
    key: 'start',
    label: 'Start',
    value: (record) => formatDateTime(record?.started_at),
  },
  {
    key: 'end',
    label: 'End',
    value: (record) => formatDateTime(record?.ended_at),
  },
  {
    key: 'breaks',
    label: 'Breaks',
    value: (record) => formatAuditBreaks(record?.breaks),
  },
];

const getAuditChanges = (historyItem) => AUDIT_FIELDS
  .map((field) => ({
    ...field,
    before: historyItem.change_kind === 'created'
      ? 'No existing entry'
      : field.value(historyItem.old_record),
    after: field.value(historyItem.new_record),
  }))
  .filter((field) => (
    historyItem.change_kind === 'created' || field.before !== field.after
  ));

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

const toLocalDateTimeInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const defaultManualForm = (selectedDate) => ({
  context: '',
  taskDescription: '',
  startedAt: `${selectedDate}T09:00`,
  endedAt: `${selectedDate}T10:00`,
  breaks: [],
  reason: '',
});

const Timesheets = () => {
  const { user } = useContext(AuthContext);
  const { status: workStatus } = useContext(WorkSessionContext);
  const userRole = getRole(user);
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
  const [manualEditor, setManualEditor] = useState(null);
  const [manualContexts, setManualContexts] = useState([]);
  const [manualForm, setManualForm] = useState(() => defaultManualForm(dateKey(new Date())));
  const [manualError, setManualError] = useState('');
  const [manualSaving, setManualSaving] = useState(false);
  const [manualContextsLoading, setManualContextsLoading] = useState(false);
  const [historyViewer, setHistoryViewer] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

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
  const canCorrectTime = hasPermission(user, PERMISSIONS.CORRECT_SCOPED_TIME_ENTRIES);
  const canCorrectPersonal = [ROLES.ADMIN, ROLES.SUPERADMIN].includes(userRole);
  const canUseManualEditor = canCorrectTime && (scope !== 'personal' || canCorrectPersonal);
  const selectedManualEmployee = scope === 'personal'
    ? {
      employee_id: user?.id,
      employee_name: user?.name,
      employee_code: user?.emp_code,
    }
    : selectedMember;

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

  const closeManualEditor = () => {
    if (manualSaving) return;
    setManualEditor(null);
    setManualContexts([]);
    setManualError('');
  };

  const openManualEditor = async (mode, entry = null) => {
    const employee = entry
      ? {
        employee_id: entry.employee_id,
        employee_name: entry.employee_name,
        employee_code: entry.employee_code,
      }
      : selectedManualEmployee;

    if (!employee?.employee_id) {
      setError('Choose a person before adding a manual time entry.');
      return;
    }

    setManualError('');
    setManualContextsLoading(true);
    setManualEditor({ mode, entry, employee });

    const { data, error: contextError } = await supabase.rpc(
      'manual_time_entry_contexts',
      { target_employee_id: employee.employee_id },
    );

    if (contextError) {
      setManualContexts([]);
      setManualError(contextError.message || 'Unable to load permitted work contexts.');
      setManualContextsLoading(false);
      return;
    }

    const contexts = data || [];
    const currentContext = entry
      ? {
        context_type: entry.context_type,
        context_id: entry.context_id,
        context_label: entry.context_label,
      }
      : null;
    const currentContextMissing = currentContext && !contexts.some(
      (context) => (
        context.context_type === currentContext.context_type
        && context.context_id === currentContext.context_id
      ),
    );
    const availableContexts = currentContextMissing
      ? [currentContext, ...contexts]
      : contexts;
    const contextValue = entry
      ? `${entry.context_type}:${entry.context_id}`
      : availableContexts[0]
        ? `${availableContexts[0].context_type}:${availableContexts[0].context_id}`
        : '';

    setManualContexts(availableContexts);
    setManualForm(entry ? {
      context: contextValue,
      taskDescription: entry.task_description,
      startedAt: toLocalDateTimeInput(entry.started_at),
      endedAt: toLocalDateTimeInput(entry.ended_at),
      breaks: (entry.breaks || []).map((breakEntry) => ({
        startedAt: toLocalDateTimeInput(breakEntry.started_at),
        endedAt: toLocalDateTimeInput(breakEntry.ended_at),
      })),
      reason: '',
    } : {
      ...defaultManualForm(selectedDate),
      context: contextValue,
    });
    setManualContextsLoading(false);
  };

  const updateManualBreak = (index, field, value) => {
    setManualForm((current) => ({
      ...current,
      breaks: current.breaks.map((breakEntry, breakIndex) => (
        breakIndex === index ? { ...breakEntry, [field]: value } : breakEntry
      )),
    }));
  };

  const removeManualBreak = (index) => {
    setManualForm((current) => ({
      ...current,
      breaks: current.breaks.filter((_, breakIndex) => breakIndex !== index),
    }));
  };

  const addManualBreak = () => {
    setManualForm((current) => ({
      ...current,
      breaks: [
        ...current.breaks,
        { startedAt: current.startedAt, endedAt: current.endedAt },
      ],
    }));
  };

  const saveManualEntry = async (event) => {
    event.preventDefault();
    if (!manualEditor) return;

    setManualError('');

    if (!manualForm.context) {
      setManualError('Select a project or internal activity.');
      return;
    }

    if (!manualForm.taskDescription.trim() || !manualForm.reason.trim()) {
      setManualError('Task description and change reason are required.');
      return;
    }

    const startedAt = new Date(manualForm.startedAt);
    const endedAt = new Date(manualForm.endedAt);
    if (
      Number.isNaN(startedAt.getTime())
      || Number.isNaN(endedAt.getTime())
      || endedAt <= startedAt
    ) {
      setManualError('Choose a completed positive-duration time range.');
      return;
    }

    const parsedBreaks = manualForm.breaks.map((breakEntry) => ({
      startedAt: new Date(breakEntry.startedAt),
      endedAt: new Date(breakEntry.endedAt),
    }));
    if (parsedBreaks.some((breakEntry) => (
      Number.isNaN(breakEntry.startedAt.getTime())
      || Number.isNaN(breakEntry.endedAt.getTime())
      || breakEntry.endedAt <= breakEntry.startedAt
      || breakEntry.startedAt < startedAt
      || breakEntry.endedAt > endedAt
    ))) {
      setManualError('Every break must have a positive duration inside the work-entry range.');
      return;
    }
    const breaks = parsedBreaks.map((breakEntry) => ({
      started_at: breakEntry.startedAt.toISOString(),
      ended_at: breakEntry.endedAt.toISOString(),
    }));

    const [contextType, contextId] = manualForm.context.split(':');
    const payload = {
      target_project_id: contextType === 'project' ? contextId : null,
      target_activity_id: contextType === 'activity' ? contextId : null,
      entry_task_description: manualForm.taskDescription,
      entry_started_at: startedAt.toISOString(),
      entry_ended_at: endedAt.toISOString(),
      entry_breaks: breaks,
      change_reason: manualForm.reason,
    };

    setManualSaving(true);
    const { error: saveError } = manualEditor.mode === 'edit'
      ? await supabase.rpc('correct_manual_time_entry', {
        target_work_entry_id: manualEditor.entry.work_entry_id,
        ...payload,
      })
      : await supabase.rpc('create_manual_time_entry', {
        target_employee_id: manualEditor.employee.employee_id,
        ...payload,
      });
    setManualSaving(false);

    if (saveError) {
      setManualError(saveError.message || 'Unable to save the manual time entry.');
      return;
    }

    setManualEditor(null);
    setManualContexts([]);
    await loadTimesheet();
  };

  const closeHistory = () => {
    setHistoryViewer(null);
    setHistory([]);
    setHistoryError('');
  };

  const loadHistory = async (entry) => {
    setHistoryLoading(true);
    setHistoryError('');

    const { data, error: historyFetchError } = await supabase.rpc(
      'work_entry_change_history',
      { target_work_entry_id: entry.work_entry_id },
    );

    if (historyFetchError) {
      setHistory([]);
      setHistoryError(
        historyFetchError.message || 'Unable to load change history.',
      );
    } else {
      setHistory(data || []);
    }
    setHistoryLoading(false);
  };

  const openHistory = (entry) => {
    setHistoryViewer(entry);
    void loadHistory(entry);
  };

  return (
    <Layout
      title="Timesheets"
      eyebrow={scopeCopy.eyebrow}
      heading={scopeCopy.heading}
      description={scopeCopy.description}
      actions={(
        <div className="timesheet-page-actions">
          {canUseManualEditor && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openManualEditor('create')}
              disabled={!selectedManualEmployee?.employee_id}
              title={selectedManualEmployee?.employee_id ? '' : 'Choose a person first'}
            >
              <i className="ri-add-line" />
              Add time
            </button>
          )}
          <button type="button" className="btn btn-outline timesheet-today" onClick={goToCurrentWeek}>
            Today
          </button>
        </div>
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
                          <button
                            type="button"
                            className="timesheet-edit-button"
                            onClick={() => openHistory(entry)}
                          >
                            <i className="ri-history-line" />
                            History
                          </button>
                          {canUseManualEditor && entry.ended_at && (
                            <button
                              type="button"
                              className="timesheet-edit-button"
                              onClick={() => openManualEditor('edit', entry)}
                            >
                              <i className="ri-pencil-line" />
                              Correct entry
                            </button>
                          )}
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

      {manualEditor && (
        <div className="timesheet-editor-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeManualEditor();
        }}>
          <aside className="timesheet-editor" aria-label="Manual time entry">
            <header className="timesheet-editor-header">
              <div>
                <span className="page-eyebrow">
                  {manualEditor.mode === 'edit' ? 'Correction' : 'Manual entry'}
                </span>
                <h2>
                  {manualEditor.mode === 'edit' ? 'Correct time entry' : 'Add time entry'}
                </h2>
                <p>
                  {manualEditor.employee.employee_name}
                  {manualEditor.employee.employee_code
                    ? ` · ${manualEditor.employee.employee_code}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                className="timesheet-editor-close"
                onClick={closeManualEditor}
                aria-label="Close manual time entry"
              >
                <i className="ri-close-line" />
              </button>
            </header>

            <form className="timesheet-editor-form" onSubmit={saveManualEntry}>
              {manualError && (
                <div className="alert-banner error">
                  <i className="ri-error-warning-line alert-icon" />
                  <div className="alert-content">
                    <span className="alert-title">Entry not saved</span>
                    <span className="alert-desc">{manualError}</span>
                  </div>
                </div>
              )}

              <label className="timesheet-field">
                <span>Project or activity</span>
                <select
                  value={manualForm.context}
                  onChange={(event) => setManualForm((current) => ({
                    ...current,
                    context: event.target.value,
                  }))}
                  disabled={manualContextsLoading}
                  required
                >
                  {manualContexts.length === 0 && (
                    <option value="">
                      {manualContextsLoading ? 'Loading…' : 'No permitted contexts'}
                    </option>
                  )}
                  {manualContexts.map((context) => (
                    <option
                      key={`${context.context_type}:${context.context_id}`}
                      value={`${context.context_type}:${context.context_id}`}
                    >
                      {context.context_type === 'project' ? 'Project' : 'Activity'} · {context.context_label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="timesheet-field">
                <span>Task description</span>
                <textarea
                  rows="3"
                  value={manualForm.taskDescription}
                  onChange={(event) => setManualForm((current) => ({
                    ...current,
                    taskDescription: event.target.value,
                  }))}
                  placeholder="What work was completed?"
                  required
                />
              </label>

              <div className="timesheet-editor-grid">
                <label className="timesheet-field">
                  <span>Start</span>
                  <input
                    type="datetime-local"
                    value={manualForm.startedAt}
                    onChange={(event) => setManualForm((current) => ({
                      ...current,
                      startedAt: event.target.value,
                    }))}
                    required
                  />
                </label>
                <label className="timesheet-field">
                  <span>End</span>
                  <input
                    type="datetime-local"
                    value={manualForm.endedAt}
                    onChange={(event) => setManualForm((current) => ({
                      ...current,
                      endedAt: event.target.value,
                    }))}
                    required
                  />
                </label>
              </div>

              <section className="timesheet-editor-breaks">
                <div>
                  <div>
                    <span>Breaks</span>
                    <small>Optional; each break must stay inside the entry.</small>
                  </div>
                  <button type="button" onClick={addManualBreak}>
                    <i className="ri-add-line" />
                    Add break
                  </button>
                </div>
                {manualForm.breaks.map((breakEntry, index) => (
                  <div className="timesheet-editor-break" key={`${index}-${breakEntry.startedAt}`}>
                    <label className="timesheet-field">
                      <span>Break start</span>
                      <input
                        type="datetime-local"
                        value={breakEntry.startedAt}
                        onChange={(event) => updateManualBreak(
                          index,
                          'startedAt',
                          event.target.value,
                        )}
                        required
                      />
                    </label>
                    <label className="timesheet-field">
                      <span>Break end</span>
                      <input
                        type="datetime-local"
                        value={breakEntry.endedAt}
                        onChange={(event) => updateManualBreak(
                          index,
                          'endedAt',
                          event.target.value,
                        )}
                        required
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeManualBreak(index)}
                      aria-label={`Remove break ${index + 1}`}
                    >
                      <i className="ri-delete-bin-line" />
                    </button>
                  </div>
                ))}
              </section>

              <label className="timesheet-field">
                <span>Reason for change</span>
                <textarea
                  rows="3"
                  value={manualForm.reason}
                  onChange={(event) => setManualForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))}
                  placeholder="Required for the immutable audit record"
                  required
                />
              </label>

              <footer className="timesheet-editor-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={closeManualEditor}
                  disabled={manualSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={manualSaving || manualContextsLoading || manualContexts.length === 0}
                >
                  {manualSaving
                    ? 'Saving…'
                    : manualEditor.mode === 'edit' ? 'Save correction' : 'Add entry'}
                </button>
              </footer>
            </form>
          </aside>
        </div>
      )}

      {historyViewer && (
        <div className="timesheet-editor-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeHistory();
        }}>
          <aside
            className="timesheet-editor timesheet-history"
            aria-label="Time entry change history"
          >
            <header className="timesheet-editor-header">
              <div>
                <span className="page-eyebrow">Immutable audit trail</span>
                <h2>Change history</h2>
                <p>
                  {historyViewer.context_label}
                  {historyViewer.employee_name
                    ? ` · ${historyViewer.employee_name}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                className="timesheet-editor-close"
                onClick={closeHistory}
                aria-label="Close change history"
              >
                <i className="ri-close-line" />
              </button>
            </header>

            <div className="timesheet-history-body">
              <div className="timesheet-history-notice">
                <i className="ri-lock-2-line" />
                <span>This history is read-only and cannot be edited or deleted.</span>
              </div>

              {historyLoading ? (
                <AppState
                  type="loading"
                  title="Loading change history"
                  message="Reading the entry’s immutable audit trail."
                  compact
                />
              ) : historyError ? (
                <AppState
                  type="error"
                  title="History unavailable"
                  message={historyError}
                  action={(
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => loadHistory(historyViewer)}
                    >
                      Try again
                    </button>
                  )}
                  compact
                />
              ) : history.length === 0 ? (
                <AppState
                  type="empty"
                  title="No manual changes"
                  message="This entry has no manual additions or corrections."
                  compact
                />
              ) : (
                <ol className="timesheet-history-list">
                  {history.map((historyItem) => (
                    <li key={historyItem.audit_id}>
                      <article className="timesheet-history-event">
                        <header>
                          <span className={`badge ${
                            historyItem.change_kind === 'created'
                              ? 'success'
                              : 'warning'
                          }`}
                          >
                            {historyItem.change_kind === 'created'
                              ? 'Entry added'
                              : 'Entry corrected'}
                          </span>
                          <time dateTime={historyItem.changed_at}>
                            {formatDateTime(historyItem.changed_at)}
                          </time>
                        </header>
                        <p className="timesheet-history-editor">
                          <i className="ri-user-line" />
                          {historyItem.editor_name} · {historyItem.editor_code}
                        </p>
                        <div className="timesheet-history-reason">
                          <span>Reason</span>
                          <p>{historyItem.change_reason}</p>
                        </div>
                        <div className="timesheet-history-changes">
                          <div className="timesheet-history-change-head">
                            <span>Field</span>
                            <span>Before</span>
                            <span>After</span>
                          </div>
                          {getAuditChanges(historyItem).map((change) => (
                            <div
                              className="timesheet-history-change"
                              key={change.key}
                            >
                              <strong>{change.label}</strong>
                              <span>{change.before}</span>
                              <span>{change.after}</span>
                            </div>
                          ))}
                        </div>
                      </article>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </aside>
        </div>
      )}
    </Layout>
  );
};

export default Timesheets;
