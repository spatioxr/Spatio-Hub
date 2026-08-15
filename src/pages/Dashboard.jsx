import React, { useContext, useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { LeaveContext } from '../context/LeaveContext';
import { WorkSessionContext } from '../context/WorkSessionContext';
import Layout from '../components/Layout';
import LiveStatusBoard from '../components/LiveStatusBoard';
import { supabase } from '../utils/supabaseClient';
import { hasPermission, PERMISSIONS } from '../utils/rbac';
import { appDateKey, formatAppDate } from '../utils/timezone';
import { summarizeAttendanceMonth } from '../utils/attendance';
import useDialogFocus from '../hooks/useDialogFocus';

const Dashboard = () => {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();

  const { getLeaveHistory, getMyRequests, getUserBalance } = useContext(LeaveContext);
  const {
    status: workStatus,
    contextLabel,
    dayState,
  } = useContext(WorkSessionContext);

  // Supabase State
  const [totalEmployees, setTotalEmployees] = useState(0);

  const [holidays, setHolidays] = useState([]);
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [attendanceSummary, setAttendanceSummary] = useState({ completedDays: 0, leaveDays: 0 });
  const holidayDialogRef = useDialogFocus(
    showHolidayModal,
    () => setShowHolidayModal(false),
  );

  const fetchHolidays = async () => {
    const { data } = await supabase.from('holidays').select('*').order('date', { ascending: true });
    if (data) setHolidays(data);
  };

  // Fetch today's data from Supabase
  const fetchData = async () => {
    if (!user) return;

    const today = appDateKey();
    const [year, month] = today.split('-').map(Number);
    const nextMonth = new Date(Date.UTC(year, month, 1));
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const requests = [
      supabase.rpc('scoped_attendance_month', {
        requested_start_date: startDate,
        requested_end_date: endDate,
        requested_scope: 'personal',
        requested_employee_id: user.id,
      }),
    ];
    if (user.role !== 'employee') {
      requests.push(supabase.from('employees').select('id', { count: 'exact', head: true }));
    }

    const [attendanceResult, peopleResult] = await Promise.all(requests);
    if (!attendanceResult.error) {
      setAttendanceSummary(summarizeAttendanceMonth(attendanceResult.data || [], today));
    }
    if (peopleResult) setTotalEmployees(peopleResult.count || 0);
  };

  useEffect(() => {
    fetchData();
    fetchHolidays();
  }, [user, workStatus]);

  if (!user) return <Navigate to="/login" replace />;

  // Content configuration based on user roles
  const isEmployee = user.role === 'employee';
  const isNormalAdmin = user.role === 'admin';
  const canViewLiveStatus = hasPermission(user, PERMISSIONS.VIEW_LIVE_STATUS);
  const hasManagementLiveRail = hasPermission(user, PERMISSIONS.VIEW_MANAGEMENT_LIVE_RAIL);
  const myLeaveBalance = getUserBalance(user.id);

  // Stats Card Configs
  const renderStats = () => {
    if (isEmployee) {
      return (
        <div className="dashboard-kpi-grid">
          <button type="button" className="dashboard-card-custom dashboard-card-custom--interactive orange-theme" onClick={() => navigate('/attendance')}>
            <i className="ri-arrow-right-s-line card-chevron"></i>
            <div className="card-icon-wrapper">
              <i className="ri-calendar-line"></i>
            </div>
            <div className="card-info">
              <span className="card-label">My Attendance</span>
              <span className="card-value" style={{ fontSize: '1rem', color: '#646465', fontWeight: 500 }}>{attendanceSummary.completedDays} completed · {attendanceSummary.leaveDays} leave</span>
            </div>
          </button>

          <button type="button" className="dashboard-card-custom dashboard-card-custom--interactive blue-theme" onClick={() => setShowHolidayModal(true)}>
            <i className="ri-arrow-right-s-line card-chevron"></i>
            <div className="card-icon-wrapper">
              <i className="ri-time-line"></i>
            </div>
            <div className="card-info">
              <span className="card-label">Upcoming Holiday</span>
              <span className="card-value">{holidays.filter(h => h.date >= appDateKey()).length}</span>
            </div>
          </button>
        </div>
      );
    } else {
      // Admin and Super Admin
      return (
        <div className="dashboard-kpi-grid">
          <div className="dashboard-card-custom green-theme">
            <div className="card-icon-wrapper">
              <i className="ri-group-line"></i>
            </div>
            <div className="card-info">
              <span className="card-label">{isNormalAdmin ? 'People in scope' : 'Total Employees'}</span>
              <span className="card-value">{totalEmployees}</span>
            </div>
          </div>

          <button type="button" className="dashboard-card-custom dashboard-card-custom--interactive orange-theme" onClick={() => navigate('/attendance')}>
            <i className="ri-arrow-right-s-line card-chevron"></i>
            <div className="card-icon-wrapper">
              <i className="ri-calendar-line"></i>
            </div>
            <div className="card-info">
              <span className="card-label">Attendance</span>
              <span className="card-value" style={{ fontSize: '1rem', color: '#646465', fontWeight: 500 }}>{attendanceSummary.completedDays} completed · {attendanceSummary.leaveDays} leave</span>
            </div>
          </button>

          <button type="button" className="dashboard-card-custom dashboard-card-custom--interactive blue-theme" onClick={() => setShowHolidayModal(true)}>
            <i className="ri-arrow-right-s-line card-chevron"></i>
            <div className="card-icon-wrapper">
              <i className="ri-time-line"></i>
            </div>
            <div className="card-info">
              <span className="card-label">Upcoming Holiday</span>
              <span className="card-value">{holidays.filter(h => h.date >= appDateKey()).length}</span>
            </div>
          </button>
        </div>
      );
    }
  };

  // Determine user first name for hello title
  const userFirstName = user.name ? user.name.split(' ')[0] : 'User';

  const isTodayBetween = (start, end) => {
    if (!start || !end) return false;
    const today = appDateKey();
    return today >= start && today <= end;
  };

  const getDailyLeaves = () => {
    if (isEmployee) {
       return getMyRequests().filter(r => r.status === 'Approved' && isTodayBetween(r.from_date || r.from, r.to_date || r.to));
    }
    return getLeaveHistory().filter(r => r.status === 'Approved' && isTodayBetween(r.from_date || r.from, r.to_date || r.to));
  };

  const dailyLeaves = getDailyLeaves();

  return (
    <Layout
      title="Dashboard"
      eyebrow="Overview"
      heading={`Hello ${userFirstName}`}
      description="Here is what is happening across your work day."
    >

      {/* Top Stats Row */}
      {renderStats()}

      {/* Main Grid: Shift Progress & Leaves Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        
        {/* Left Column: Work-day status */}
        <div className="flex flex-col gap-6">
          <div className="card">
            <h3 className="font-bold mb-4" style={{ fontSize: '1.125rem', color: 'var(--text-main)' }}>Work day</h3>
            <div
              className={`alert-banner ${
                workStatus === 'working'
                  ? 'info'
                  : workStatus === 'break'
                    ? 'warning'
                    : dayState.hasWorkToday ? 'success' : 'warning'
              }`}
              style={{ marginBottom: 0 }}
            >
              <i
                className={`${
                  workStatus === 'working'
                    ? 'ri-time-line'
                    : workStatus === 'break'
                      ? 'ri-pause-circle-line'
                      : dayState.hasWorkToday
                        ? 'ri-checkbox-circle-line'
                        : 'ri-play-circle-line'
                } alert-icon`}
              />
              <div className="alert-content">
                <span className="alert-title">
                  {workStatus === 'working'
                    ? 'Currently working'
                    : workStatus === 'break'
                      ? 'On break'
                      : dayState.hasWorkToday ? 'Work day complete' : 'Ready to start'}
                </span>
                <span className="alert-desc">
                  {workStatus === 'out'
                    ? dayState.hasWorkToday
                      ? 'Your final session is closed for today.'
                      : 'Use Start work in the timer above. Your start-of-day plan is requested there when required.'
                    : contextLabel}
                </span>
              </div>
            </div>
          </div>

        </div> {/* End Left Column */}

        {/* Right Column: Leave Lists — only for admins */}
        {hasPermission(user, PERMISSIONS.APPROVE_LEAVE) && (
        <div className="card">
          <h3 className="font-bold mb-4" style={{ fontSize: '1.125rem', color: 'var(--text-main)' }}>
            Members on Leave Today
          </h3>
          
          <div className="flex-col">
            {dailyLeaves.length === 0 ? (
              <p className="text-muted text-sm">No one is on leave today.</p>
            ) : (
              dailyLeaves.map(leave => {
                const empName = leave.employees?.name || user.name || 'User';
                const avatarInitials = empName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                const fromDate = leave.from_date || leave.from;
                
                return (
                  <div className="leave-item-custom" key={leave.id}>
                    <div className="leave-item-info">
                      <div className="leave-item-avatar">{avatarInitials}</div>
                      <div className="leave-item-details">
                        <h4>{empName}</h4>
                        <p>Type: {leave.type}</p>
                        {leave.reason && <div className="leave-item-note">Note: {leave.reason}</div>}
                      </div>
                    </div>
                    <div className="leave-item-date">
                      {formatAppDate(fromDate, { day: 'numeric', month: undefined, year: undefined })}
                      <span>{formatAppDate(fromDate, { month: 'short', day: undefined, year: undefined })}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
        )}

      </div>

      {canViewLiveStatus && !hasManagementLiveRail && (
        <LiveStatusBoard refreshKey={workStatus} />
      )}

      {/* Bottom Row: Leaves Grid */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <button type="button" className="dashboard-section-link flex justify-between items-center mb-5" onClick={() => navigate('/leave')}>
          <h3 className="font-bold" style={{ fontSize: '1.125rem', color: 'var(--text-main)' }}>Leaves</h3>
          <i className="ri-arrow-right-s-line" style={{ color: '#A3AED0', fontSize: '1.25rem' }}></i>
        </button>
        
        <div className="leaves-grid">
          
          <div className="leave-metric-card sick-leave">
            <div className="metric-icon-box">
              <i className="ri-calendar-line"></i>
            </div>
            <div className="metric-info">
              <span className="metric-title">Sick Leave</span>
              <div className="leave-metric-values">
                <div className="leave-metric-col">
                  <span className="leave-metric-label">Used</span>
                  <span className="leave-metric-num">{myLeaveBalance['Sick Leave']?.used ?? 0}</span>
                </div>
                <div className="leave-metric-col">
                  <span className="leave-metric-label">Available</span>
                  <span className="leave-metric-num">{myLeaveBalance['Sick Leave']?.remaining ?? 0}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="leave-metric-card casual-leave">
            <div className="metric-icon-box">
              <i className="ri-calendar-line"></i>
            </div>
            <div className="metric-info">
              <span className="metric-title">Casual Leave</span>
              <div className="leave-metric-values">
                <div className="leave-metric-col">
                  <span className="leave-metric-label">Used</span>
                  <span className="leave-metric-num">{myLeaveBalance['Casual Leave']?.used ?? 0}</span>
                </div>
                <div className="leave-metric-col">
                  <span className="leave-metric-label">Available</span>
                  <span className="leave-metric-num">{myLeaveBalance['Casual Leave']?.remaining ?? 0}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="leave-metric-card comp-off">
            <div className="metric-icon-box">
              <i className="ri-calendar-line"></i>
            </div>
            <div className="metric-info">
              <span className="metric-title">Comp Off</span>
              <div className="leave-metric-values">
                <div className="leave-metric-col">
                  <span className="leave-metric-label">Used</span>
                  <span className="leave-metric-num">{myLeaveBalance['Comp Off']?.used ?? 0}</span>
                </div>
                <div className="leave-metric-col">
                  <span className="leave-metric-label">Available</span>
                  <span className="leave-metric-num">{myLeaveBalance['Comp Off']?.remaining ?? 0}</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Holiday Modal */}
      {showHolidayModal && (
        <div className="salary-modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowHolidayModal(false)}>
          <div
            ref={holidayDialogRef}
            className="salary-modal"
            style={{ maxWidth: 650, boxSizing: 'border-box' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="holiday-dialog-title"
            tabIndex="-1"
          >
            <div className="salary-modal-header" style={{ marginBottom: '1.5rem' }}>
              <div>
                <h3 className="salary-modal-title" id="holiday-dialog-title">Upcoming Holidays</h3>
                <p className="salary-modal-sub">View company holidays</p>
              </div>
              <button type="button" className="salary-modal-close" onClick={() => setShowHolidayModal(false)} aria-label="Close upcoming holidays">
                <i className="ri-close-line" aria-hidden="true" />
              </button>
            </div>
            
            <div className="holiday-calendar-view" style={{ display: 'grid', gap: '1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '1rem' }}>
                {holidays.map(h => {
                  const d = h.date;
                  return (
                    <div key={h.id} style={{ background: 'white', border: '1px solid #E8E8E8', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)' }}>
                      <div style={{ background: '#003B2C', color: 'white', padding: '0.5rem', textAlign: 'center', fontWeight: 600, fontSize: '0.9rem' }}>
                        {formatAppDate(d, { month: 'short', year: 'numeric', day: undefined })}
                      </div>
                      <div style={{ padding: '1rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#000000', lineHeight: 1 }}>{formatAppDate(d, { day: 'numeric', month: undefined, year: undefined })}</div>
                        <div style={{ fontSize: '0.85rem', color: '#646465', marginTop: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{formatAppDate(d, { weekday: 'short', day: undefined, month: undefined, year: undefined })}</div>
                        <div style={{ marginTop: '0.75rem', fontWeight: 600, color: '#006742', fontSize: '0.95rem', minHeight: '2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{h.name}</div>
                      </div>
                    </div>
                  );
                })}
                {holidays.length === 0 && (
                  <p style={{ color: '#646465', gridColumn: '1 / -1', textAlign: 'center', padding: '2rem 0', fontStyle: 'italic' }}>No upcoming holidays found.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default Dashboard;
