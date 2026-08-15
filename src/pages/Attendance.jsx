import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Layout from '../components/Layout';
import AppState from '../components/AppState';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { getRole, ROLES } from '../utils/rbac';
import {
  appDateKey,
  appDayRange,
  formatAppClock,
  formatAppDate,
} from '../utils/timezone';
import {
  ATTENDANCE_DAY_STATES,
  resolveAttendanceDayState,
  summarizeAttendanceMonth,
} from '../utils/attendance';
import useDialogFocus from '../hooks/useDialogFocus';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const STATE_COPY = {
  [ATTENDANCE_DAY_STATES.NOT_APPLICABLE]: { label: 'Before joining', short: '', icon: '' },
  [ATTENDANCE_DAY_STATES.FUTURE]: { label: 'Future', short: '', icon: '' },
  [ATTENDANCE_DAY_STATES.HOLIDAY]: { label: 'Company holiday', short: 'H', icon: 'ri-sun-line' },
  [ATTENDANCE_DAY_STATES.WEEKEND]: { label: 'Weekend', short: '', icon: '' },
  [ATTENDANCE_DAY_STATES.LEAVE]: { label: 'Approved leave', short: 'L', icon: 'ri-flight-takeoff-line' },
  [ATTENDANCE_DAY_STATES.HALF_LEAVE_WORKED]: { label: 'Half leave + worked', short: '½', icon: 'ri-contrast-2-line' },
  [ATTENDANCE_DAY_STATES.WORKING]: { label: 'Working', short: '', icon: 'ri-time-line' },
  [ATTENDANCE_DAY_STATES.COMPLETED]: { label: 'Completed', short: '', icon: 'ri-check-line' },
  [ATTENDANCE_DAY_STATES.NO_RECORD]: { label: 'No record', short: '–', icon: '' },
};

const formatDuration = (seconds) => {
  const totalMinutes = Math.max(0, Math.floor(Number(seconds || 0) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
};

const monthBounds = (value) => {
  const year = value.getFullYear();
  const month = value.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const next = new Date(year, month + 1, 1);
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
  return { year, month, days, start, end };
};

const Attendance = () => {
  const { user } = useContext(AuthContext);
  const role = getRole(user);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [members, setMembers] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(user?.id || '');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDay, setSelectedDay] = useState(null);
  const [detailEntries, setDetailEntries] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const detailRequestKey = useRef('');
  const closeDayDetail = useCallback(() => {
    detailRequestKey.current = '';
    setSelectedDay(null);
    setDetailEntries([]);
    setDetailError('');
    setDetailLoading(false);
  }, []);
  const detailDialogRef = useDialogFocus(
    Boolean(selectedDay),
    closeDayDetail,
  );
  const bounds = useMemo(() => monthBounds(currentMonth), [currentMonth]);
  const today = appDateKey();

  const organisationScope = [ROLES.ADMIN, ROLES.SUPERADMIN].includes(role);
  const teamScope = role === ROLES.MANAGER;

  useEffect(() => {
    if (!user?.id) return;
    setSelectedEmployeeId((current) => current || user.id);
  }, [user?.id]);

  const loadMembers = useCallback(async () => {
    if (!user?.id || (!organisationScope && !teamScope)) {
      setMembers([]);
      return;
    }

    const requestedScope = organisationScope ? 'organisation' : 'managed';
    const { data, error: memberError } = await supabase.rpc('timesheet_scope_members', {
      requested_scope: requestedScope,
    });
    if (memberError) {
      setError(memberError.message || 'Unable to load the attendance scope.');
      return;
    }
    setMembers((data || []).filter((member) => member.employee_id !== user.id));
  }, [organisationScope, teamScope, user?.id]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const loadAttendance = useCallback(async () => {
    if (!selectedEmployeeId || !user?.id) return;
    setLoading(true);
    setError('');

    const requestedScope = selectedEmployeeId === user.id
      ? 'personal'
      : organisationScope ? 'organisation' : 'managed';
    const { data, error: attendanceError } = await supabase.rpc('scoped_attendance_month', {
      requested_start_date: bounds.start,
      requested_end_date: bounds.end,
      requested_scope: requestedScope,
      requested_employee_id: selectedEmployeeId,
    });

    if (attendanceError) {
      setError(attendanceError.message || 'Unable to load this attendance month.');
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }, [bounds.end, bounds.start, organisationScope, selectedEmployeeId, user?.id]);

  useEffect(() => {
    void loadAttendance();
  }, [loadAttendance]);

  useEffect(() => {
    closeDayDetail();
  }, [bounds.start, closeDayDetail, selectedEmployeeId]);

  const rowsByDate = useMemo(
    () => new Map(rows.map((row) => [row.attendance_date, row])),
    [rows],
  );
  const summary = useMemo(() => summarizeAttendanceMonth(rows, today), [rows, today]);
  const selectedEmployee = selectedEmployeeId === user?.id
    ? { employee_name: user.name, employee_code: user.emp_code }
    : members.find((member) => member.employee_id === selectedEmployeeId);
  const firstWeekday = new Date(Date.UTC(bounds.year, bounds.month, 1)).getUTCDay();
  const calendarCells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: bounds.days }, (_, index) => index + 1),
  ];

  const moveMonth = (offset) => {
    setCurrentMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const openDayDetail = async (row, date, state) => {
    const requestKey = `${selectedEmployeeId}:${date}`;
    const requestedScope = selectedEmployeeId === user.id
      ? 'personal'
      : organisationScope ? 'organisation' : 'managed';
    const range = appDayRange(date, date);

    detailRequestKey.current = requestKey;
    setSelectedDay({
      ...(row || {}),
      attendance_date: date,
      state,
    });
    setDetailEntries([]);
    setDetailError('');
    setDetailLoading(true);

    const { data, error: detailFetchError } = await supabase.rpc('scoped_timesheet_entries', {
      requested_start_at: range.start,
      requested_end_at: range.end,
      requested_scope: requestedScope,
      requested_employee_id: selectedEmployeeId,
    });

    if (detailRequestKey.current !== requestKey) return;
    if (detailFetchError) {
      setDetailError(detailFetchError.message || 'Unable to load this day’s work timeline.');
    } else {
      setDetailEntries(data || []);
    }
    setDetailLoading(false);
  };

  return (
    <Layout
      title="Attendance"
      eyebrow="Attendance"
      heading="Attendance calendar"
      description="Review factual workday records, approved leave and company holidays. Work actions stay in Track Work; corrections stay in Timesheets."
    >
      <section className="attendance-overview" aria-label="Attendance month summary">
        <article className="attendance-kpi attendance-kpi--primary">
          <span className="attendance-kpi-icon"><i className="ri-calendar-check-line" /></span>
          <div><span>Working days to date</span><strong>{summary.workingDays}</strong></div>
        </article>
        <article className="attendance-kpi attendance-kpi--success">
          <span className="attendance-kpi-icon"><i className="ri-checkbox-circle-line" /></span>
          <div><span>Completed days</span><strong>{summary.completedDays}</strong></div>
        </article>
        <article className="attendance-kpi attendance-kpi--leave">
          <span className="attendance-kpi-icon"><i className="ri-flight-takeoff-line" /></span>
          <div><span>Approved leave</span><strong>{summary.leaveDays}</strong></div>
        </article>
        <article className="attendance-kpi attendance-kpi--holiday">
          <span className="attendance-kpi-icon"><i className="ri-sun-line" /></span>
          <div><span>Company holidays</span><strong>{summary.holidays}</strong></div>
        </article>
        <article className="attendance-kpi attendance-kpi--neutral">
          <span className="attendance-kpi-icon"><i className="ri-question-line" /></span>
          <div><span>No record</span><strong>{summary.noRecordDays}</strong></div>
        </article>
      </section>

      <section className="card attendance-calendar-card" aria-labelledby="attendance-month-title">
        <div className="attendance-calendar-toolbar">
          <div className="attendance-month-control">
            <button type="button" onClick={() => moveMonth(-1)} aria-label="Previous month">
              <i className="ri-arrow-left-s-line" />
            </button>
            <div>
              <span className="page-eyebrow">Monthly record</span>
              <h2 id="attendance-month-title">{MONTHS[bounds.month]} {bounds.year}</h2>
            </div>
            <button type="button" onClick={() => moveMonth(1)} aria-label="Next month">
              <i className="ri-arrow-right-s-line" />
            </button>
          </div>

          {(organisationScope || teamScope) && (
            <label className="attendance-person-select">
              <span>Viewing</span>
              <select value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
                <option value={user.id}>Me · {user.name}</option>
                {members.map((member) => (
                  <option value={member.employee_id} key={member.employee_id}>
                    {member.employee_name} · {member.employee_code}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="attendance-calendar-context">
          <span className="attendance-calendar-avatar">
            {(selectedEmployee?.employee_name || 'Employee').split(' ').map((part) => part[0]).join('').slice(0, 2)}
          </span>
          <div>
            <strong>{selectedEmployee?.employee_name || 'Employee'}</strong>
            <span>{selectedEmployee?.employee_code || 'Personal attendance'} · Read-only record</span>
          </div>
          {rows[0]?.late_after ? (
            <span className="attendance-policy-chip"><i className="ri-time-line" /> Late after {rows[0].late_after.slice(0, 5)}</span>
          ) : (
            <span className="attendance-policy-chip attendance-policy-chip--muted"><i className="ri-information-line" /> Lateness not configured</span>
          )}
        </div>

        {error && (
          <AppState
            compact
            type="error"
            title="Attendance could not be refreshed"
            message={error}
            action={<button type="button" className="btn btn-outline" onClick={loadAttendance}>Try again</button>}
          />
        )}

        {loading && rows.length === 0 && !error ? (
          <AppState compact type="loading" title="Loading attendance" message="Reconciling work, leave and holiday records." />
        ) : (
          <div className="attendance-calendar-shell">
            <div className="attendance-weekdays" aria-hidden="true">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="attendance-calendar-grid">
              {calendarCells.map((day, index) => {
                if (!day) return <span className="attendance-calendar-blank" key={`blank-${index}`} />;
                const date = `${bounds.year}-${String(bounds.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const row = rowsByDate.get(date);
                const state = resolveAttendanceDayState(row, today);
                const copy = STATE_COPY[state];
                return (
                  <button
                    type="button"
                    className={`attendance-day attendance-day--${state}${date === today ? ' attendance-day--today' : ''}`}
                    key={date}
                    onClick={() => openDayDetail(row, date, state)}
                    aria-label={`${formatAppDate(date)}: ${copy.label}. Open full-day details`}
                  >
                    <span className="attendance-day-number">{day}</span>
                    {copy.icon ? <i className={copy.icon} aria-hidden="true" /> : <strong>{copy.short}</strong>}
                    <small>{copy.label}</small>
                    {row?.is_late === true && <span className="attendance-late-dot">Late</span>}
                    {row?.work_mode === 'wfh' && <span className="attendance-wfh-dot"><i className="ri-home-4-line" /> WFH</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="attendance-legend" aria-label="Calendar legend">
          {[ATTENDANCE_DAY_STATES.COMPLETED, ATTENDANCE_DAY_STATES.WORKING, ATTENDANCE_DAY_STATES.LEAVE, ATTENDANCE_DAY_STATES.HALF_LEAVE_WORKED, ATTENDANCE_DAY_STATES.HOLIDAY, ATTENDANCE_DAY_STATES.NO_RECORD].map((state) => (
            <span key={state}><i className={`attendance-legend-swatch attendance-legend-swatch--${state}`} />{STATE_COPY[state].label}</span>
          ))}
        </div>
      </section>

      {selectedDay && (
        <div className="drawer-backdrop" onClick={(event) => event.target === event.currentTarget && closeDayDetail()}>
          <aside
            ref={detailDialogRef}
            className="drawer attendance-detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attendance-detail-title"
            tabIndex="-1"
          >
            <div className="attendance-detail-header">
              <div>
                <span className="page-eyebrow">Attendance detail</span>
                <h2 id="attendance-detail-title">{formatAppDate(selectedDay.attendance_date, { weekday: 'long', month: 'long' })}</h2>
                <p>{selectedEmployee?.employee_name || 'Employee'} · {STATE_COPY[selectedDay.state].label}</p>
              </div>
              <button type="button" className="people-icon-button" onClick={closeDayDetail} aria-label="Close attendance detail">
                <i className="ri-close-line" />
              </button>
            </div>

            {selectedDay.holiday_id && (
              <div className="attendance-detail-banner attendance-detail-banner--holiday">
                <i className="ri-sun-line" /><div><span>Company holiday</span><strong>{selectedDay.holiday_name}</strong></div>
              </div>
            )}
            {Number(selectedDay.leave_fraction) > 0 && (
              <div className="attendance-detail-banner attendance-detail-banner--leave">
                <i className="ri-flight-takeoff-line" /><div><span>Approved leave</span><strong>{selectedDay.leave_type || 'Approved leave'} · {selectedDay.leave_fraction} day</strong></div>
              </div>
            )}

            <div className="attendance-detail-metrics">
              <article><span>First check-in</span><strong>{selectedDay.checked_in_at ? formatAppClock(selectedDay.checked_in_at) : '—'}</strong></article>
              <article><span>Final check-out</span><strong>{selectedDay.checked_out_at ? formatAppClock(selectedDay.checked_out_at) : selectedDay.has_open_session ? 'In progress' : '—'}</strong></article>
              <article><span>Net worked</span><strong>{formatDuration(selectedDay.worked_seconds)}</strong></article>
              <article><span>Breaks</span><strong>{formatDuration(selectedDay.break_seconds)}</strong></article>
            </div>

            <div className="attendance-detail-mode">
              <i className={selectedDay.work_mode === 'wfh' ? 'ri-home-4-line' : 'ri-building-line'} />
              <div><span>Work mode</span><strong>{selectedDay.work_mode === 'wfh' ? 'Work from home' : selectedDay.work_mode === 'office' ? 'Office' : 'Not recorded'}</strong></div>
            </div>

            {selectedDay.is_late === true && (
              <div className="attendance-detail-note">
                <i className="ri-time-line" /> First check-in was after the configured {selectedDay.late_after?.slice(0, 5)} cutoff.
              </div>
            )}

            <section className="attendance-detail-section" aria-labelledby="attendance-day-timeline-title">
              <div className="attendance-detail-section-heading">
                <div>
                  <span className="page-eyebrow">Work breakdown</span>
                  <h3 id="attendance-day-timeline-title">Full-day timeline</h3>
                </div>
                {!detailLoading && !detailError && (
                  <span>{detailEntries.length} {detailEntries.length === 1 ? 'session' : 'sessions'}</span>
                )}
              </div>

              {detailLoading ? (
                <AppState compact type="loading" title="Loading full-day data" message="Collecting projects, activities, tasks and breaks." />
              ) : detailError ? (
                <AppState
                  compact
                  type="error"
                  title="Full-day data could not be loaded"
                  message={detailError}
                  action={(
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => openDayDetail(selectedDay, selectedDay.attendance_date, selectedDay.state)}
                    >
                      Try again
                    </button>
                  )}
                />
              ) : detailEntries.length === 0 ? (
                <AppState
                  compact
                  type="empty"
                  title="No tracked sessions"
                  message="There are no project or internal-activity sessions recorded for this date."
                />
              ) : (
                <ol className="timesheet-timeline attendance-detail-timeline">
                  {detailEntries.map((entry) => (
                    <li className="timesheet-session" key={entry.work_entry_id}>
                      <span className={`timesheet-context-icon timesheet-context-icon--${entry.context_type}`}>
                        <i className={entry.context_type === 'project' ? 'ri-folder-3-line' : 'ri-flashlight-line'} />
                      </span>
                      <div className="timesheet-session-body">
                        <div className="timesheet-session-heading">
                          <div>
                            <span className="timesheet-context-type">
                              {entry.context_type === 'project' ? 'Project' : 'Internal activity'}
                            </span>
                            <h4>{entry.context_label || 'Context not recorded'}</h4>
                          </div>
                          <span className="timesheet-session-duration">{formatDuration(entry.worked_seconds)}</span>
                        </div>
                        <p>{entry.task_description || 'First work start · no task description required'}</p>
                        <div className="timesheet-session-meta">
                          <span>
                            <i className="ri-time-line" />
                            {formatAppClock(entry.started_at)} – {entry.ended_at ? formatAppClock(entry.ended_at) : 'In progress'}
                          </span>
                          {!entry.ended_at && <span className="badge success">In progress</span>}
                        </div>
                        {(entry.breaks || []).length > 0 && (
                          <div className="timesheet-break-list">
                            {(entry.breaks || []).map((breakEntry) => (
                              <div key={breakEntry.id}>
                                <span>
                                  <i className="ri-cup-line" />
                                  Break · {formatAppClock(breakEntry.started_at)} – {breakEntry.ended_at ? formatAppClock(breakEntry.ended_at) : 'In progress'}
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
            </section>

            <div className="attendance-detail-footer">
              Attendance is read-only. Use Timesheets for an authorised correction and its audit history.
            </div>
          </aside>
        </div>
      )}
    </Layout>
  );
};

export default Attendance;
