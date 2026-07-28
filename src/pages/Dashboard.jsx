import React, { useContext, useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { LeaveContext } from '../context/LeaveContext';
import Layout from '../components/Layout';
import { supabase } from '../utils/supabaseClient';
import { getManagedDepartments } from '../utils/rbac';

const Dashboard = () => {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  if (!user) return <Navigate to="/login" replace />;
  
  const { getLeaveHistory, getMyRequests } = useContext(LeaveContext);

  const userKey = user.role;

  // Supabase State
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [attendanceStatus, setAttendanceStatus] = useState('not_checked_in');
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');
  
  const [showBosModal, setShowBosModal] = useState(false);
  const [bosReportText, setBosReportText] = useState('');
  
  const [showEodModal, setShowEodModal] = useState(false);
  const [eodReportText, setEodReportText] = useState('');

  const [toastMessage, setToastMessage] = useState('');

  const [holidays, setHolidays] = useState([]);
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [newHolidayName, setNewHolidayName] = useState('');
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [attendanceCounts, setAttendanceCounts] = useState({ present: 0, absent: 0 });
  const [elapsedTime, setElapsedTime] = useState('');

  const fetchHolidays = async () => {
    const { data } = await supabase.from('holidays').select('*').order('date', { ascending: true });
    if (data) setHolidays(data);
  };

  // Fetch today's data from Supabase
  const fetchData = async () => {
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];

    // Fetch attendance
    const { data: attData } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', user.id)
      .eq('date', today)
      .maybeSingle();

    if (attData) {
      if (attData.check_in && !attData.check_out) {
        setAttendanceStatus('checked_in');
        setCheckInTime(attData.check_in);
      } else if (attData.check_in && attData.check_out) {
        setAttendanceStatus('attendance_complete');
        setCheckInTime(attData.check_in);
        setCheckOutTime(attData.check_out);
      }
    }

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
      const today = new Date().toISOString().split('T')[0];
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
  }, [user]);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Running timer when checked in
  useEffect(() => {
    if (attendanceStatus !== 'checked_in' || !checkInTime) {
      setElapsedTime('');
      return;
    }
    const tick = () => {
      const now = new Date();
      const [h, m] = checkInTime.split(':').map(Number);
      const start = new Date();
      start.setHours(h, m, 0, 0);
      const diff = Math.max(0, Math.floor((now - start) / 1000));
      const hh = Math.floor(diff / 3600);
      const mm = Math.floor((diff % 3600) / 60);
      const ss = diff % 60;
      setElapsedTime(`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [attendanceStatus, checkInTime]);

  const handleCheckInClick = () => setShowBosModal(true);
  const handleCheckOutClick = () => setShowEodModal(true);

  const submitBosAndCheckIn = async (e) => {
    e.preventDefault();
    if (!bosReportText.trim()) return;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = now.toISOString().split('T')[0];

    // Attendance manual upsert
    const { data: existingAtt } = await supabase.from('attendance').select('id, check_in').eq('employee_id', user.id).eq('date', today).maybeSingle();
    
    if (existingAtt && existingAtt.check_in) {
      showToast('You have already checked in today!');
      setShowBosModal(false);
      return;
    }

    if (existingAtt) {
      await supabase.from('attendance').update({
        check_in: timeStr,
        status: (now.getHours() > 10 || (now.getHours() === 10 && now.getMinutes() >= 30)) ? 'Late' : 'Present'
      }).eq('id', existingAtt.id);
    } else {
      await supabase.from('attendance').insert({
        employee_id: user.id,
        date: today,
        check_in: timeStr,
        status: (now.getHours() > 10 || (now.getHours() === 10 && now.getMinutes() >= 30)) ? 'Late' : 'Present'
      });
    }

    // Daily Reports manual upsert
    const { data: existingRep } = await supabase.from('daily_reports').select('id, bos_submitted_at').eq('employee_id', user.id).eq('date', today).maybeSingle();
    if (existingRep && existingRep.bos_submitted_at) {
       // already submitted bos, skip
    } else if (existingRep) {
      await supabase.from('daily_reports').update({
        bos_report: bosReportText,
        bos_submitted_at: now.toISOString()
      }).eq('id', existingRep.id);
    } else {
      await supabase.from('daily_reports').insert({
        employee_id: user.id,
        date: today,
        bos_report: bosReportText,
        bos_submitted_at: now.toISOString()
      });
    }

    setShowBosModal(false);
    setBosReportText('');
    showToast('Checked in & BOS Report submitted!');
    await fetchData();
  };

  const submitEodAndCheckOut = async (e) => {
    e.preventDefault();
    if (!eodReportText.trim()) return;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = now.toISOString().split('T')[0];

    // Attendance manual update
    const { data: existingAtt } = await supabase.from('attendance').select('id, check_out').eq('employee_id', user.id).eq('date', today).maybeSingle();
    
    if (existingAtt && existingAtt.check_out) {
      showToast('You have already checked out today!');
      setShowEodModal(false);
      return;
    }

    if (existingAtt) {
      await supabase.from('attendance').update({ check_out: timeStr }).eq('id', existingAtt.id);
    }

    // Daily Reports manual upsert
    const { data: existingRep } = await supabase.from('daily_reports').select('id, eod_submitted_at').eq('employee_id', user.id).eq('date', today).maybeSingle();
    if (existingRep && existingRep.eod_submitted_at) {
       // already submitted eod, skip
    } else if (existingRep) {
      await supabase.from('daily_reports').update({
        eod_report: eodReportText,
        eod_submitted_at: now.toISOString()
      }).eq('id', existingRep.id);
    } else {
      await supabase.from('daily_reports').insert({
        employee_id: user.id,
        date: today,
        eod_report: eodReportText,
        eod_submitted_at: now.toISOString()
      });
    }

    setShowEodModal(false);
    setEodReportText('');
    showToast('Checked out & EOD Report submitted!');
    await fetchData();
  };

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
              <span className="card-value">{holidays.filter(h => h.date >= new Date().toISOString().split('T')[0]).length}</span>
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
              <span className="card-value">{holidays.filter(h => h.date >= new Date().toISOString().split('T')[0]).length}</span>
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
    const today = new Date().toISOString().split('T')[0];
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
    <Layout title="Dashboard">
      {/* Hello Greeting Header */}
      <div className="mb-6">
        <h2 style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          Hello {userFirstName}! 👋
        </h2>
        <p className="text-muted font-medium mt-1 text-sm">Good Morning</p>
      </div>

      {/* Top Stats Row */}
      {renderStats()}

      {/* Main Grid: Shift Progress & Leaves Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        
        {/* Left Column: Attendance, BOS & EOD reports */}
        <div className="flex flex-col gap-6">
          
          {/* Attendance Section */}
          <div className="card">
            <h3 className="font-bold mb-4" style={{ fontSize: '1.125rem', color: 'var(--text-main)' }}>Attendance</h3>
            
                {attendanceStatus === 'not_checked_in' && (
                  <div>
                    <div className="alert-banner warning">
                      <i className="ri-error-warning-line alert-icon"></i>
                      <div className="alert-content">
                        <span className="alert-title">Action Required</span>
                        <span className="alert-desc">Please check in to start your day</span>
                      </div>
                    </div>
                    <button className="btn-teal" onClick={handleCheckInClick}>
                      <i className="ri-time-line"></i> Check In (Submit BOS)
                    </button>
                  </div>
                )}
                {attendanceStatus === 'checked_in' && (
                  <div>
                    <div className="alert-banner info">
                      <i className="ri-time-line alert-icon"></i>
                      <div className="alert-content">
                        <span className="alert-title">Currently Checked In</span>
                        <span className="alert-desc">Check in time: {checkInTime || '-'}</span>
                      </div>
                      {elapsedTime && (
                        <div style={{ marginLeft: 'auto', textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: '0.7rem', color: '#646465', fontWeight: 600 }}>TIME ELAPSED</div>
                          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#006742', fontFamily: 'monospace', letterSpacing: '0.05em' }}>{elapsedTime}</div>
                        </div>
                      )}
                    </div>
                    <button className="btn-outline-blue" onClick={handleCheckOutClick}>
                      <i className="ri-time-line"></i> Check Out (Submit EOD)
                    </button>
                  </div>
                )}
                {attendanceStatus === 'attendance_complete' && (
                  <div className="alert-banner success" style={{ marginBottom: 0 }}>
                    <i className="ri-checkbox-circle-line alert-icon"></i>
                    <div className="alert-content">
                      <span className="alert-title">Attendance Complete</span>
                      <span className="alert-desc">Check in: {checkInTime} | Check out: {checkOutTime}</span>
                    </div>
                  </div>
                )}
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
                const fromDateObj = new Date(leave.from_date || leave.from);
                
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
                      {fromDateObj.getDate()}
                      <span>{fromDateObj.toLocaleString('default', { month: 'short' })}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
        )}

      </div>

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

      {/* BOS Modal */}
      {showBosModal && (
        <div className="salary-modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowBosModal(false)}>
          <div className="salary-modal" style={{ maxWidth: 500 }}>
            <div className="salary-modal-header">
              <div>
                <h3 className="salary-modal-title">Check In & BOS</h3>
                <p className="salary-modal-sub">Submit your Beginning of Shift report</p>
              </div>
              <button className="salary-modal-close" onClick={() => setShowBosModal(false)}>
                <i className="ri-close-line" />
              </button>
            </div>
            <form onSubmit={submitBosAndCheckIn}>
              <div className="salary-field">
                <textarea
                  className="salary-input"
                  style={{ minHeight: 120, resize: 'none' }}
                  placeholder="What are your plans for today?"
                  value={bosReportText}
                  onChange={e => setBosReportText(e.target.value)}
                  required
                />
              </div>
              <div className="salary-modal-actions">
                <button type="button" className="salary-cancel-btn" onClick={() => setShowBosModal(false)}>Cancel</button>
                <button type="submit" className="salary-submit-btn" style={{ background: '#00A884' }}>Check In</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EOD Modal */}
      {showEodModal && (
        <div className="salary-modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowEodModal(false)}>
          <div className="salary-modal" style={{ maxWidth: 500 }}>
            <div className="salary-modal-header">
              <div>
                <h3 className="salary-modal-title">Check Out & EOD</h3>
                <p className="salary-modal-sub">Submit your End of Day report</p>
              </div>
              <button className="salary-modal-close" onClick={() => setShowEodModal(false)}>
                <i className="ri-close-line" />
              </button>
            </div>
            <form onSubmit={submitEodAndCheckOut}>
              <div className="salary-field">
                <textarea
                  className="salary-input"
                  style={{ minHeight: 120, resize: 'none' }}
                  placeholder="What did you accomplish today?"
                  value={eodReportText}
                  onChange={e => setEodReportText(e.target.value)}
                  required
                />
              </div>
              <div className="salary-modal-actions">
                <button type="button" className="salary-cancel-btn" onClick={() => setShowEodModal(false)}>Cancel</button>
                <button type="submit" className="salary-submit-btn" style={{ background: '#E57D3E' }}>Check Out</button>
              </div>
            </form>
          </div>
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
                  const d = new Date(h.date);
                  return (
                    <div key={h.id} style={{ background: 'white', border: '1px solid #E8E8E8', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)' }}>
                      <div style={{ background: '#003B2C', color: 'white', padding: '0.5rem', textAlign: 'center', fontWeight: 600, fontSize: '0.9rem' }}>
                        {d.toLocaleString('default', { month: 'short', year: 'numeric' })}
                      </div>
                      <div style={{ padding: '1rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#000000', lineHeight: 1 }}>{d.getDate()}</div>
                        <div style={{ fontSize: '0.85rem', color: '#646465', marginTop: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d.toLocaleString('default', { weekday: 'short' })}</div>
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
