import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { LeaveContext } from '../context/LeaveContext';
import { WorkSessionContext } from '../context/WorkSessionContext';
import Layout from '../components/Layout';
import LiveStatusBoard from '../components/LiveStatusBoard';
import { supabase } from '../utils/supabaseClient';
import { hasPermission, PERMISSIONS } from '../utils/rbac';
import { appDateKey, formatAppClock, formatAppDate } from '../utils/timezone';
import { summarizeAttendanceMonth } from '../utils/attendance';
import {
  attendanceCompletionRate,
  leaveBalanceSeries,
  workdayPresentation,
} from '../utils/dashboard';
import useDialogFocus from '../hooks/useDialogFocus';

const EMPTY_ATTENDANCE = Object.freeze({
  workingDays: 0,
  completedDays: 0,
  activeDays: 0,
  leaveDays: 0,
  holidays: 0,
  noRecordDays: 0,
  lateDays: 0,
});

const initialsFor = (name = '') => String(name || '')
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part[0])
  .join('')
  .slice(0, 2)
  .toUpperCase() || '—';

const Dashboard = () => {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const {
    requests,
    holidays,
    balance,
    refreshLeaveData,
  } = useContext(LeaveContext);
  const {
    status: workStatus,
    contextLabel,
    dayState,
  } = useContext(WorkSessionContext);

  const [totalEmployees, setTotalEmployees] = useState(0);
  const [reportingManager, setReportingManager] = useState(null);
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [attendanceSummary, setAttendanceSummary] = useState(EMPTY_ATTENDANCE);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const holidayDialogRef = useDialogFocus(
    showHolidayModal,
    () => setShowHolidayModal(false),
  );

  const refreshDashboard = useCallback(async ({ quiet = false } = {}) => {
    if (!user) return;
    if (!quiet) setDashboardLoading(true);

    const today = appDateKey();
    const [year, month] = today.split('-').map(Number);
    const nextMonth = new Date(Date.UTC(year, month, 1));
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const peopleRequest = user.role === 'employee'
      ? Promise.resolve({ count: null, error: null })
      : supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'Active');

    const [attendanceResult, peopleResult, managerResult, leaveResult] = await Promise.all([
      supabase.rpc('scoped_attendance_month', {
        requested_start_date: startDate,
        requested_end_date: endDate,
        requested_scope: 'personal',
        requested_employee_id: user.id,
      }),
      peopleRequest,
      supabase.rpc('current_reporting_manager'),
      refreshLeaveData(false, false),
    ]);

    const errors = [
      attendanceResult.error,
      peopleResult.error,
      managerResult.error,
      leaveResult?.error,
    ].filter(Boolean);

    if (!attendanceResult.error) {
      setAttendanceSummary(summarizeAttendanceMonth(attendanceResult.data || [], today));
    }
    if (!peopleResult.error && peopleResult.count !== null) {
      setTotalEmployees(peopleResult.count || 0);
    }
    if (!managerResult.error) {
      setReportingManager(managerResult.data?.[0] || null);
    }

    setDashboardError(errors.length ? 'Some dashboard data could not be refreshed. Showing the latest available values.' : '');
    setDashboardLoading(false);
    setUpdatedAt(new Date());
  }, [refreshLeaveData, user]);

  useEffect(() => {
    if (!user) return undefined;

    void refreshDashboard();
    const handleFocus = () => void refreshDashboard({ quiet: true });
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handleFocus();
    };
    const pollId = window.setInterval(handleFocus, 60000);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(pollId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshDashboard, user, workStatus]);

  const dashboardFacts = useMemo(() => {
    const today = appDateKey();
    const nextHoliday = holidays.find((holiday) => holiday.date >= today) || null;
    const leaveTypes = leaveBalanceSeries(balance);
    const leaveAvailable = leaveTypes.reduce((total, item) => total + item.remaining, 0);
    const leaveUsed = leaveTypes.reduce((total, item) => total + item.used, 0);
    const leavePending = leaveTypes.reduce((total, item) => total + item.pending, 0);
    return {
      nextHoliday,
      leaveTypes,
      leaveAvailable,
      leaveUsed,
      leavePending,
      attendanceRate: attendanceCompletionRate(attendanceSummary),
    };
  }, [attendanceSummary, balance, holidays]);

  if (!user) return <Navigate to="/login" replace />;

  const isEmployee = user.role === 'employee';
  const canViewLiveStatus = hasPermission(user, PERMISSIONS.VIEW_LIVE_STATUS);
  const hasManagementLiveRail = hasPermission(user, PERMISSIONS.VIEW_MANAGEMENT_LIVE_RAIL);
  const canReviewLeave = hasPermission(user, PERMISSIONS.APPROVE_LEAVE);
  const userFirstName = user.name ? user.name.split(' ')[0] : 'there';
  const workday = workdayPresentation(workStatus, dayState.hasWorkToday, contextLabel);
  const upcomingHolidayCount = holidays.filter((holiday) => holiday.date >= appDateKey()).length;

  const dailyLeaves = canReviewLeave
    ? requests.filter((request) => {
      const fromDate = request.from_date || request.from;
      const toDate = request.to_date || request.to;
      const today = appDateKey();
      return request.status === 'Approved' && fromDate && toDate && today >= fromDate && today <= toDate;
    })
    : [];

  return (
    <Layout
      title="Dashboard"
      eyebrow="Today"
      heading={`Welcome back, ${userFirstName}`}
      description="A live view of your workday, attendance and leave—kept in sync with the rest of Spatio HRMS."
    >
      {dashboardError && (
        <div className="dashboard-sync-alert" role="alert">
          <i className="ri-refresh-line" aria-hidden="true" />
          <span>{dashboardError}</span>
          <button type="button" onClick={() => refreshDashboard()}>Refresh now</button>
        </div>
      )}

      <section className={`dashboard-hero dashboard-hero--${workday.tone}`} aria-labelledby="dashboard-workday-title">
        <div className="dashboard-hero-copy">
          <span className="dashboard-hero-date">
            {formatAppDate(appDateKey(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
          <div className="dashboard-hero-status">
            <span className="dashboard-hero-status-icon" aria-hidden="true">
              <i className={workday.icon} />
            </span>
            <div>
              <span>Your workday</span>
              <h3 id="dashboard-workday-title">{workday.title}</h3>
              <p>{workday.description}</p>
            </div>
          </div>
          <button type="button" className="dashboard-primary-action" onClick={() => navigate('/track-work')}>
            Open Track Work
            <i className="ri-arrow-right-line" aria-hidden="true" />
          </button>
        </div>

        <div className="dashboard-person-card">
          <span className="dashboard-person-label">Reporting manager</span>
          <div className="dashboard-person-profile">
            <span className="dashboard-person-avatar">
              {reportingManager?.manager_avatar_url ? (
                <img src={reportingManager.manager_avatar_url} alt="" />
              ) : initialsFor(reportingManager?.manager_name)}
            </span>
            <div>
              <strong>{reportingManager?.manager_name || 'Not assigned'}</strong>
              <span>
                {reportingManager?.manager_designation
                  || reportingManager?.manager_code
                  || (user.role === 'superadmin' ? 'Top-level account' : 'Update in People')}
              </span>
            </div>
          </div>
          <div className="dashboard-person-meta">
            <span>{user.department || 'No department'}</span>
            <span>{user.designation || user.role}</span>
          </div>
        </div>
      </section>

      <section className="dashboard-snapshot-grid" aria-label="Dashboard snapshot">
        {!isEmployee && (
          <article className="dashboard-snapshot-card dashboard-snapshot-card--people">
            <span className="dashboard-snapshot-icon"><i className="ri-team-line" /></span>
            <div>
              <span>{user.role === 'manager' ? 'People in scope' : 'Active people'}</span>
              <strong>{dashboardLoading ? '—' : totalEmployees}</strong>
              <small>Current employee records</small>
            </div>
          </article>
        )}
        <button type="button" className="dashboard-snapshot-card dashboard-snapshot-card--attendance" onClick={() => navigate('/attendance')}>
          <span className="dashboard-snapshot-icon"><i className="ri-calendar-check-line" /></span>
          <div>
            <span>Attendance this month</span>
            <strong>{attendanceSummary.completedDays}<small> / {attendanceSummary.workingDays} days</small></strong>
            <small>{dashboardFacts.attendanceRate}% completion</small>
          </div>
          <i className="ri-arrow-right-s-line dashboard-snapshot-arrow" />
        </button>
        <button type="button" className="dashboard-snapshot-card dashboard-snapshot-card--leave" onClick={() => navigate('/leave')}>
          <span className="dashboard-snapshot-icon"><i className="ri-leaf-line" /></span>
          <div>
            <span>Leave available</span>
            <strong>{dashboardFacts.leaveAvailable}<small> days</small></strong>
            <small>{dashboardFacts.leavePending ? `${dashboardFacts.leavePending} pending` : 'No pending leave'}</small>
          </div>
          <i className="ri-arrow-right-s-line dashboard-snapshot-arrow" />
        </button>
        <button type="button" className="dashboard-snapshot-card dashboard-snapshot-card--holiday" onClick={() => setShowHolidayModal(true)}>
          <span className="dashboard-snapshot-icon"><i className="ri-sun-line" /></span>
          <div>
            <span>Next holiday</span>
            <strong className="dashboard-snapshot-holiday-name">{dashboardFacts.nextHoliday?.name || 'None scheduled'}</strong>
            <small>
              {dashboardFacts.nextHoliday
                ? formatAppDate(dashboardFacts.nextHoliday.date, { day: 'numeric', month: 'short', year: undefined })
                : 'Holiday calendar is clear'}
            </small>
          </div>
          <i className="ri-arrow-right-s-line dashboard-snapshot-arrow" />
        </button>
      </section>

      <div className="dashboard-visual-grid">
        <section className="card dashboard-insight-card" aria-labelledby="attendance-insight-title">
          <div className="dashboard-card-heading">
            <div>
              <span className="page-eyebrow">This month</span>
              <h3 id="attendance-insight-title">Attendance overview</h3>
            </div>
            <button type="button" onClick={() => navigate('/attendance')}>View calendar <i className="ri-arrow-right-line" /></button>
          </div>
          <div className="dashboard-attendance-visual">
            <div
              className="dashboard-progress-ring"
              style={{ '--dashboard-progress': `${dashboardFacts.attendanceRate * 3.6}deg` }}
              aria-label={`${dashboardFacts.attendanceRate}% of working days completed`}
            >
              <div>
                <strong>{dashboardFacts.attendanceRate}%</strong>
                <span>completed</span>
              </div>
            </div>
            <dl className="dashboard-attendance-facts">
              <div><dt><span className="dashboard-fact-dot dashboard-fact-dot--completed" />Completed</dt><dd>{attendanceSummary.completedDays}</dd></div>
              <div><dt><span className="dashboard-fact-dot dashboard-fact-dot--leave" />Approved leave</dt><dd>{attendanceSummary.leaveDays}</dd></div>
              <div><dt><span className="dashboard-fact-dot dashboard-fact-dot--missing" />No record</dt><dd>{attendanceSummary.noRecordDays}</dd></div>
              <div><dt><span className="dashboard-fact-dot dashboard-fact-dot--late" />Late days</dt><dd>{attendanceSummary.lateDays}</dd></div>
            </dl>
          </div>
          <p className="dashboard-data-note"><i className="ri-shield-check-line" /> Uses the same factual Attendance projection as the calendar.</p>
        </section>

        <section className="card dashboard-insight-card" aria-labelledby="leave-insight-title">
          <div className="dashboard-card-heading">
            <div>
              <span className="page-eyebrow">Your balance</span>
              <h3 id="leave-insight-title">Leave snapshot</h3>
            </div>
            <button type="button" onClick={() => navigate('/leave')}>Manage leave <i className="ri-arrow-right-line" /></button>
          </div>
          <div className="dashboard-leave-bars">
            {dashboardFacts.leaveTypes.map((item) => (
              <article key={item.type}>
                <div className="dashboard-leave-bar-heading">
                  <span><i className={item.icon} />{item.type}</span>
                  <strong>{item.remaining} available</strong>
                </div>
                <div className="dashboard-leave-track" aria-label={`${item.type}: ${item.used} used, ${item.remaining} available`}>
                  <span style={{ width: `${item.usedPercent}%` }} />
                </div>
                <div className="dashboard-leave-bar-meta">
                  <span>{item.used} used</span>
                  <span>{item.pending ? `${item.pending} pending` : 'Nothing pending'}</span>
                </div>
              </article>
            ))}
          </div>
          <div className="dashboard-leave-total">
            <span>Total used this year</span>
            <strong>{dashboardFacts.leaveUsed} days</strong>
          </div>
        </section>
      </div>

      <div className={`dashboard-secondary-grid${canReviewLeave ? '' : ' dashboard-secondary-grid--single'}`}>
        <section className="card dashboard-quick-card" aria-labelledby="quick-actions-title">
          <div className="dashboard-card-heading">
            <div>
              <span className="page-eyebrow">Shortcuts</span>
              <h3 id="quick-actions-title">Quick actions</h3>
            </div>
          </div>
          <div className="dashboard-quick-actions">
            <button type="button" onClick={() => navigate('/track-work')}><i className="ri-play-circle-line" /><span>Track work<small>Start, switch or finish</small></span><i className="ri-arrow-right-s-line" /></button>
            <button type="button" onClick={() => navigate('/timesheets')}><i className="ri-time-line" /><span>Timesheets<small>Review sessions and corrections</small></span><i className="ri-arrow-right-s-line" /></button>
            <button type="button" onClick={() => navigate('/attendance')}><i className="ri-calendar-event-line" /><span>Attendance<small>Open your factual calendar</small></span><i className="ri-arrow-right-s-line" /></button>
            <button type="button" onClick={() => navigate('/leave')}><i className="ri-flight-takeoff-line" /><span>Request leave<small>Balances, requests and history</small></span><i className="ri-arrow-right-s-line" /></button>
          </div>
        </section>

        {canReviewLeave && (
          <section className="card dashboard-today-leave" aria-labelledby="today-leave-title">
            <div className="dashboard-card-heading">
              <div>
                <span className="page-eyebrow">Availability</span>
                <h3 id="today-leave-title">On leave today</h3>
              </div>
              <span className="dashboard-count-badge">{dailyLeaves.length}</span>
            </div>
            {dailyLeaves.length === 0 ? (
              <div className="dashboard-empty-compact">
                <i className="ri-team-line" />
                <div><strong>Everyone is available</strong><span>No approved leave overlaps today.</span></div>
              </div>
            ) : (
              <div className="dashboard-leave-today-list">
                {dailyLeaves.slice(0, 4).map((leave) => {
                  const employeeName = leave.employees?.name || 'Team member';
                  return (
                    <article key={leave.id}>
                      <span>{initialsFor(employeeName)}</span>
                      <div><strong>{employeeName}</strong><small>{leave.type}{leave.is_half_day ? ' · Half day' : ''}</small></div>
                      <span className="badge warning">Away</span>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>

      {canViewLiveStatus && !hasManagementLiveRail && (
        <LiveStatusBoard refreshKey={workStatus} />
      )}

      <div className="dashboard-refresh-note" aria-live="polite">
        <i className="ri-refresh-line" aria-hidden="true" />
        {updatedAt ? `Dashboard reconciled ${formatAppClock(updatedAt)}` : 'Reconciling dashboard data…'}
      </div>

      {showHolidayModal && (
        <div className="salary-modal-overlay" onClick={(event) => event.target === event.currentTarget && setShowHolidayModal(false)}>
          <div
            ref={holidayDialogRef}
            className="salary-modal dashboard-holiday-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="holiday-dialog-title"
            tabIndex="-1"
          >
            <div className="salary-modal-header">
              <div>
                <span className="page-eyebrow">Company calendar</span>
                <h3 className="salary-modal-title" id="holiday-dialog-title">Upcoming holidays</h3>
                <p className="salary-modal-sub">{upcomingHolidayCount} scheduled from today</p>
              </div>
              <button type="button" className="salary-modal-close" onClick={() => setShowHolidayModal(false)} aria-label="Close upcoming holidays">
                <i className="ri-close-line" aria-hidden="true" />
              </button>
            </div>
            <div className="dashboard-holiday-grid">
              {holidays.filter((holiday) => holiday.date >= appDateKey()).map((holiday) => (
                <article key={holiday.id}>
                  <div className="dashboard-holiday-date">
                    <span>{formatAppDate(holiday.date, { month: 'short', day: undefined, year: undefined })}</span>
                    <strong>{formatAppDate(holiday.date, { day: 'numeric', month: undefined, year: undefined })}</strong>
                  </div>
                  <div>
                    <strong>{holiday.name}</strong>
                    <span>{formatAppDate(holiday.date, { weekday: 'long', day: undefined, month: undefined, year: undefined })}</span>
                  </div>
                </article>
              ))}
              {upcomingHolidayCount === 0 && (
                <div className="dashboard-empty-compact">
                  <i className="ri-calendar-check-line" />
                  <div><strong>No upcoming holidays</strong><span>The company holiday calendar has no future dates.</span></div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default Dashboard;
