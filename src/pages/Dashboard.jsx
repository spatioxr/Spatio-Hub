import React, { useContext, useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { LeaveContext } from '../context/LeaveContext';
import { WorkSessionContext } from '../context/WorkSessionContext';
import Layout from '../components/Layout';
import LiveStatusBoard from '../components/LiveStatusBoard';
import { supabase } from '../utils/supabaseClient';
import { getManagedDepartments, hasPermission, PERMISSIONS } from '../utils/rbac';
import { appDateKey, formatAppDate } from '../utils/timezone';

const Dashboard = () => {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  if (!user) return <Navigate to="/login" replace />;
  
  const { getLeaveHistory, getMyRequests } = useContext(LeaveContext);
  const {
    status: workStatus,
    contextLabel,
    dayState,
  } = useContext(WorkSessionContext);

  const userKey = user.role;

  // Supabase State
  const [totalEmployees, setTotalEmployees] = useState(0);

  const [toastMessage, setToastMessage] = useState('');

  const [holidays, setHolidays] = useState([]);
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [newHolidayName, setNewHolidayName] = useState('');
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [attendanceCounts, setAttendanceCounts] = useState({ present: 0, absent: 0 });

  const fetchHolidays = async () => {
    const { data } = await supabase.from('holidays').select('*').order('date', { ascending: true });
    if (data) setHolidays(data);
  };

  // Fetch today's data from Supabase
  const fetchData = async () => {
    if (!user) return;
    const today = appDateKey();

    if (user.role === 'admin' || user.role === 'manager' || user.role === 'head' || user.role === 'superadmin') {
      let countQuery = supabase.from('employees').select('id', { count: 'exact', head: true });
      if (user.role === 'admin' || user.role === 'manager') {
        const allowedDepts = getManagedDepartments(user);
        if (allowedDepts.length > 0) {
          countQuery = countQuery.or(`department.in.(${allowedDepts.join(',')}),reports_to.eq.${user.id}`);
        } else {
          countQuery = countQuery.eq('reports_to', user.id);
        }
      }
      const { count: totalCount } = await countQuery;
      setTotalEmployees(totalCount || 0);

      // Fetch today's attendance counts
      const today = appDateKey();
      let attQuery = supabase.from('attendance').select('employee_id').eq('date', today);
      
      if (user.role === 'admin' || user.role === 'manager') {
        // Get employee ids in department first
        let deptEmpsQuery = supabase.from('employees').select('id');
        const allowedDepts = getManagedDepartments(user);
        if (allowedDepts.length > 0) {
          deptEmpsQuery = deptEmpsQuery.or(`department.in.(${allowedDepts.join(',')}),reports_to.eq.${user.id}`);
        } else {
          deptEmpsQuery = deptEmpsQuery.eq('reports_to', user.id);
        }
        
        const { data: deptEmps } = await deptEmpsQuery;
        const deptIds = (deptEmps || []).map(e => e.id);
        if (deptIds.length > 0) {
          attQuery = attQuery.in('employee_id', deptIds);
        } else {
          attQuery = attQuery.eq('id', '00000000-0000-0000-0000-000000000000'); // match none
        }
      }
      
      const { data: attData } = await attQuery;
      const present = (attData || []).length;
      const absent = (totalCount || 0) - present;
      setAttendanceCounts({ present, absent: Math.max(0, absent) });
    }
  };

  useEffect(() => {
    fetchData();
    fetchHolidays();
  }, [user, workStatus]);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const handleAddHoliday = async (e) => {
    e.preventDefault();
    if (!newHolidayName || !newHolidayDate) return;
    const { error } = await supabase.from('holidays').insert({ name: newHolidayName, date: newHolidayDate });
    if (error) {
      if (error.message.includes('relation "public.holidays" does not exist')) {
        showToast('Please run the SQL script to create holidays table.');
      } else {
        showToast('Failed to add holiday.');
      }
    } else {
      setNewHolidayName('');
      setNewHolidayDate('');
      fetchHolidays();
      showToast('Holiday added successfully!');
    }
  };

  const showToast = (message) => {
    setToastMessage(message);
  };

  // Content configuration based on user roles
  const isEmployee = user.role === 'employee';
  const isSuperAdmin = user.role === 'superadmin';
  const isNormalAdmin = user.role === 'admin';
  const canViewLiveStatus = hasPermission(user, PERMISSIONS.VIEW_LIVE_STATUS);

  // Stats Card Configs
  const renderStats = () => {
    if (isEmployee) {
      return (
        <div className="dashboard-kpi-grid">
          <div className="dashboard-card-custom orange-theme" style={{ cursor: 'pointer' }} onClick={() => navigate('/attendance')}>
            <i className="ri-arrow-right-s-line card-chevron"></i>
            <div className="card-icon-wrapper">
              <i className="ri-calendar-line"></i>
            </div>
            <div className="card-info">
              <span className="card-label">My Attendance</span>
              <span className="card-value" style={{ fontSize: '1rem', color: '#646465', fontWeight: 500 }}>View Calendar →</span>
            </div>
          </div>

          <div className="dashboard-card-custom blue-theme" style={{ cursor: 'pointer' }} onClick={() => setShowHolidayModal(true)}>
            <i className="ri-arrow-right-s-line card-chevron"></i>
            <div className="card-icon-wrapper">
              <i className="ri-time-line"></i>
            </div>
            <div className="card-info">
              <span className="card-label">Upcoming Holiday</span>
              <span className="card-value">{holidays.filter(h => h.date >= appDateKey()).length}</span>
            </div>
          </div>
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
              <span className="card-label">{isNormalAdmin ? 'Department Employees' : 'Total Employees'}</span>
              <span className="card-value">{totalEmployees}</span>
            </div>
          </div>

          <div className="dashboard-card-custom orange-theme" style={{ cursor: 'pointer' }} onClick={() => navigate('/attendance')}>
            <i className="ri-arrow-right-s-line card-chevron"></i>
            <div className="card-icon-wrapper">
              <i className="ri-calendar-line"></i>
            </div>
            <div className="card-info">
              <span className="card-label">Attendance</span>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', marginTop: '0.2rem' }}>
                <span className="card-value" style={{ color: '#00A87E', fontSize: '1.5rem' }}>{attendanceCounts.present} <span style={{ fontSize: '0.7rem', color: '#646465', fontWeight: 500 }}>Present</span></span>
                <span style={{ color: '#E2E8F0' }}>|</span>
                <span className="card-value" style={{ color: '#494949', fontSize: '1.5rem' }}>{attendanceCounts.absent} <span style={{ fontSize: '0.7rem', color: '#646465', fontWeight: 500 }}>Absent</span></span>
              </div>
            </div>
          </div>

          <div className="dashboard-card-custom blue-theme" style={{ cursor: 'pointer' }} onClick={() => setShowHolidayModal(true)}>
            <i className="ri-arrow-right-s-line card-chevron"></i>
            <div className="card-icon-wrapper">
              <i className="ri-time-line"></i>
            </div>
            <div className="card-info">
              <span className="card-label">Upcoming Holiday</span>
              <span className="card-value">{holidays.filter(h => h.date >= appDateKey()).length}</span>
            </div>
          </div>
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
                      : 'Use Start work in the timer above. BOS is requested there when required.'
                    : contextLabel}
                </span>
              </div>
            </div>
          </div>

        </div> {/* End Left Column */}

        {/* Right Column: Leave Lists — only for admins */}
        {!isEmployee && (
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

      {canViewLiveStatus && (
        <LiveStatusBoard refreshKey={workStatus} />
      )}

      {/* Bottom Row: Leaves Grid */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <div className="flex justify-between items-center mb-5" style={{ cursor: 'pointer' }} onClick={() => navigate('/leave')}>
          <h3 className="font-bold" style={{ fontSize: '1.125rem', color: 'var(--text-main)' }}>Leaves</h3>
          <i className="ri-arrow-right-s-line" style={{ color: '#A3AED0', fontSize: '1.25rem' }}></i>
        </div>
        
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
                  <span className="leave-metric-num">2</span>
                </div>
                <div className="leave-metric-col">
                  <span className="leave-metric-label">Available</span>
                  <span className="leave-metric-num">8</span>
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
                  <span className="leave-metric-num">10</span>
                </div>
                <div className="leave-metric-col">
                  <span className="leave-metric-label">Available</span>
                  <span className="leave-metric-num">20</span>
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
                  <span className="leave-metric-num">0</span>
                </div>
                <div className="leave-metric-col">
                  <span className="leave-metric-label">Available</span>
                  <span className="leave-metric-num">5</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {toastMessage && (
        <div className="toast-success-bottom">
          <i className="ri-checkbox-circle-fill" style={{ color: '#00A884', fontSize: '1.25rem' }}></i>
          {toastMessage}
        </div>
      )}

      {/* Holiday Modal */}
      {showHolidayModal && (
        <div className="salary-modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowHolidayModal(false)}>
          <div className="salary-modal" style={{ maxWidth: 650, boxSizing: 'border-box' }}>
            <div className="salary-modal-header" style={{ marginBottom: '1.5rem' }}>
              <div>
                <h3 className="salary-modal-title">Upcoming Holidays</h3>
                <p className="salary-modal-sub">View company holidays</p>
              </div>
              <button className="salary-modal-close" onClick={() => setShowHolidayModal(false)}>
                <i className="ri-close-line" />
              </button>
            </div>
            
            <div className="holiday-calendar-view" style={{ display: 'grid', gap: '1.5rem' }}>
              {isSuperAdmin && (
                <div style={{ background: '#F4F4F4', padding: '1rem', borderRadius: '8px', border: '1px solid #E8E8E8' }}>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: '#000000' }}>Add New Holiday</h4>
                  <form onSubmit={handleAddHoliday} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', color: '#646465', marginBottom: '0.25rem' }}>Holiday Name</label>
                      <textarea
                        className="salary-input"
                        value={newHolidayName}
                        onChange={e => setNewHolidayName(e.target.value)}
                        placeholder="e.g. Christmas Day — National Holiday"
                        required
                        rows={2}
                        style={{ margin: 0, resize: 'none', width: '100%', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 200px' }}>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#646465', marginBottom: '0.25rem' }}>Date</label>
                        <input type="date" className="salary-input" value={newHolidayDate} onChange={e => setNewHolidayDate(e.target.value)} required style={{ margin: 0, width: '100%', boxSizing: 'border-box' }} />
                      </div>
                      <button type="submit" className="btn-teal" style={{ height: '42px', display: 'flex', alignItems: 'center', flexShrink: 0, padding: '0 1rem' }}>
                        <i className="ri-add-line" style={{ marginRight: '0.25rem' }}></i> Add
                      </button>
                    </div>
                  </form>
                </div>
              )}

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
