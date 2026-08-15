import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import Layout from '../components/Layout';
import AppState from '../components/AppState';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { getRole, ROLES } from '../utils/rbac';
import {
  addAppDays,
  appDateKey,
  formatAppDate,
  formatAppTimeValue,
} from '../utils/timezone';
import useDialogFocus from '../hooks/useDialogFocus';

const Attendance = () => {
  const { user } = useContext(AuthContext);
  const userRole = getRole(user);

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(user?.id || '');
  const [selectedDepartment, setSelectedDepartment] = useState('all'); // for superadmin
  
  const [attendanceRecords, setAttendanceRecords] = useState({});
  const [leaveRecords, setLeaveRecords] = useState({});
  
  const [loading, setLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [selectedDateDetails, setSelectedDateDetails] = useState(null);
  const detailDialogRef = useDialogFocus(
    Boolean(selectedDateDetails),
    () => setSelectedDateDetails(null),
  );

  // Month Navigation
  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };
  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  // Fetch employees for Admin / Superadmin
  useEffect(() => {
    if (!user) return;
    const fetchEmployees = async () => {
      if (userRole === ROLES.EMPLOYEE) return;
      const scope = userRole === ROLES.MANAGER ? 'managed' : 'organisation';
      const { data, error } = await supabase.rpc('timesheet_scope_members', {
        requested_scope: scope,
      });
      if (error) {
        setDataError(error.message || 'Unable to load the employee list.');
        return;
      }
      setEmployees((data || []).map((employee) => ({
        id: employee.employee_id,
        name: employee.employee_name,
        department: employee.employee_department,
      })));
    };
    void fetchEmployees();
  }, [user, userRole]);

  // Ensure default selected employee is set when list loads
  useEffect(() => {
    if (userRole !== ROLES.EMPLOYEE && employees.length > 0 && !selectedEmployeeId) {
      setSelectedEmployeeId(user.id);
    } else if (userRole === ROLES.EMPLOYEE && user?.id) {
      setSelectedEmployeeId(user.id);
    }
  }, [employees, user, userRole]);

  // When department filter changes (superadmin), reset employee to first of that dept or own
  const filteredEmployees = useMemo(() => {
    if (userRole !== ROLES.SUPERADMIN || selectedDepartment === 'all') return employees;
    return employees.filter(e => e.department === selectedDepartment);
  }, [employees, selectedDepartment, userRole]);

  const departments = useMemo(() => (
    [...new Set(employees.map((employee) => employee.department).filter(Boolean))].sort()
  ), [employees]);

  useEffect(() => {
    if (userRole === ROLES.SUPERADMIN && selectedDepartment !== 'all') {
      // Reset to first employee in dept or own id
      const first = filteredEmployees.find(e => e.id !== user.id) || filteredEmployees[0];
      if (first && filteredEmployees.length > 0) setSelectedEmployeeId(first.id);
      else setSelectedEmployeeId(user.id);
    }
  }, [filteredEmployees, selectedDepartment, userRole, user?.id]);

  const fetchData = useCallback(async () => {
    if (!selectedEmployeeId) return { error: null };

    setLoading(true);
    setDataError('');

    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = `${year}-${String(month + 1).padStart(2, '0')}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, '0')}`;

    const [
      { data: attData, error: attendanceError },
      { data: repData, error: reportError },
      { data: leavesData, error: leaveError },
    ] = await Promise.all([
      supabase
        .from('attendance')
        .select('*')
        .eq('employee_id', selectedEmployeeId)
        .gte('date', firstDay)
        .lte('date', lastDay),
      supabase
        .from('daily_reports')
        .select('*')
        .eq('employee_id', selectedEmployeeId)
        .gte('date', firstDay)
        .lte('date', lastDay),
      supabase
        .from('leaves')
        .select('*')
        .eq('employee_id', selectedEmployeeId)
        .eq('status', 'Approved'),
    ]);

    const fetchError = attendanceError || reportError || leaveError;
    if (fetchError) {
      setDataError(fetchError.message || 'Unable to load attendance details.');
      setLoading(false);
      return { error: fetchError };
    }

    const attMap = {};
    (attData || []).forEach(att => {
      const rep = (repData || []).find(r => r.date === att.date);
        
      // Late logic: Check-in after 10:30 AM
      let isLate = false;
      if (att.check_in) {
        const parts = att.check_in.match(/(\d+):(\d+)/);
        if (parts) {
          const h = parseInt(parts[1]);
          const m = parseInt(parts[2]);
          if (h > 10 || (h === 10 && m >= 30)) isLate = true;
        }
      }
        
      // Duration logic
      let durationHours = 0;
      let dayType = 'Present'; // default if missing check-out
      if (att.check_in && att.check_out) {
        const t1 = new Date(`1970-01-01T${att.check_in}`);
        const t2 = new Date(`1970-01-01T${att.check_out}`);
        durationHours = (t2 - t1) / (1000 * 60 * 60);
          
        if (durationHours > 6) {
          dayType = 'Full Day';
        } else if (durationHours >= 4 && durationHours <= 6) {
          dayType = 'Half Day';
        } else {
          dayType = 'Leave'; // 0 to 4 hours
        }
      }
        
      attMap[att.date] = {
        ...att,
        bos_report: rep?.bos_report || '-',
        eod_report: rep?.eod_report || '-',
        isLate,
        dayType,
        durationHours
      };
    });
      
    const leaveMap = {};
    (leavesData || []).forEach(lv => {
      for (let date = lv.from_date; date <= lv.to_date; date = addAppDays(date, 1)) {
        leaveMap[date] = lv;
      }
    });
      
    setAttendanceRecords(attMap);
    setLeaveRecords(leaveMap);
    setLoading(false);
    return { error: null };
  }, [currentMonth, selectedEmployeeId]);

  // Fetch Data for the month
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // --- Stats derived from current month records ---
  const monthStats = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    let presentDays = 0;
    let halfDays = 0;
    let lateDays = 0;
    let leaveDays = 0;
    let absentDays = 0;
    
    const todayStr = appDateKey();
    
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (dateStr > todayStr) continue; // don't count future days
      
      const dayOfWeek = new Date(year, month, d).getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue; // skip weekends
      
      let _leave = 0;
      let _half = 0;
      let _pres = 0;
      let _abs = 0;
      
      if (leaveRecords[dateStr]) {
        if (leaveRecords[dateStr].days === 0.5) {
          _leave = 0.5;
          if (attendanceRecords[dateStr] && attendanceRecords[dateStr].check_in) {
            _pres = 0.5;
          } else {
            _abs = 0.5;
          }
        } else {
          _leave = 1;
        }
      } else if (attendanceRecords[dateStr]) {
        const att = attendanceRecords[dateStr];
        if (att.dayType === 'Leave') {
          _leave = 1;
        } else if (att.dayType === 'Half Day') {
          _half = 1;
        } else {
          _pres = 1;
        }
        if (att.isLate) lateDays++;
      } else {
        _abs = 1;
      }

      leaveDays += _leave;
      halfDays += _half;
      presentDays += _pres;
      absentDays += _abs;
    }
    
    return { presentDays, halfDays, lateDays, leaveDays, absentDays };
  }, [attendanceRecords, leaveRecords, currentMonth]);

  // Calendar rendering logic
  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();
  
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanksArray = Array.from({ length: firstDay }, (_, i) => i);

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const handleDayClick = (dateStr) => {
    const att = attendanceRecords[dateStr];
    const lv = leaveRecords[dateStr];
    
    if (att || lv) {
      setSelectedDateDetails({ date: dateStr, att, lv });
    }
  };

  return (
    <Layout
      title="Attendance"
      eyebrow="Attendance"
      heading="Attendance calendar"
      description="Review monthly presence, leave and punctuality. Work sessions and corrections remain in Timesheets."
    >
      {dataError && (
        <AppState
          compact
          type="error"
          title="Attendance data could not be refreshed"
          message={dataError}
          action={(
            <button type="button" className="btn btn-outline" onClick={fetchData}>
              Try again
            </button>
          )}
        />
      )}

      {loading && Object.keys(attendanceRecords).length === 0 && !dataError && (
        <AppState
          compact
          type="loading"
          title="Loading attendance calendar"
          message="Collecting presence, workday check-ins and approved leave."
        />
      )}

      {/* Monthly Stats Row */}
      <div className="attendance-summary-grid">
        <div className="attendance-summary-card attendance-summary-card--present">
          <div style={{ width: 44, height: 44, background: '#E8F2EF', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#006742', fontSize: '1.25rem', flexShrink: 0 }}>
            <i className="ri-checkbox-circle-line"></i>
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: '#646465', fontWeight: 600 }}>Full Days</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#006742' }}>{monthStats.presentDays}</div>
          </div>
        </div>
        <div className="attendance-summary-card attendance-summary-card--half">
          <div style={{ width: 44, height: 44, background: '#FFEDD5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F97316', fontSize: '1.25rem', flexShrink: 0 }}>
            <i className="ri-pie-chart-2-line"></i>
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: '#646465', fontWeight: 600 }}>Half Days</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#F97316' }}>{monthStats.halfDays}</div>
          </div>
        </div>
        <div className="attendance-summary-card attendance-summary-card--absent">
          <div style={{ width: 44, height: 44, background: '#F2F2F2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#494949', fontSize: '1.25rem', flexShrink: 0 }}>
            <i className="ri-close-circle-line"></i>
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: '#646465', fontWeight: 600 }}>Absent</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#494949' }}>{monthStats.absentDays}</div>
          </div>
        </div>
        <div className="attendance-summary-card attendance-summary-card--leave">
          <div style={{ width: 44, height: 44, background: '#E0F5EE', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00A87E', fontSize: '1.25rem', flexShrink: 0 }}>
            <i className="ri-flight-takeoff-line"></i>
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: '#646465', fontWeight: 600 }}>Leaves</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#00A87E' }}>{monthStats.leaveDays}</div>
          </div>
        </div>
        <div className="attendance-summary-card attendance-summary-card--late">
          <div style={{ width: 44, height: 44, background: '#FEF3C7', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#CA8A04', fontSize: '1.25rem', flexShrink: 0 }}>
            <i className="ri-time-line"></i>
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: '#646465', fontWeight: 600 }}>Late Days</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#CA8A04' }}>{monthStats.lateDays}</div>
          </div>
        </div>
      </div>

      <div className="card mb-6 flex flex-col gap-4">
        {/* Header Controls */}
        <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '1rem' }}>
          <div className="flex items-center gap-4">
            <button onClick={handlePrevMonth} style={{ padding: '0.5rem', background: '#F4F4F4', borderRadius: 8, color: '#646465' }}>
              <i className="ri-arrow-left-s-line text-xl" />
            </button>
            <h3 className="font-bold text-lg min-w-[150px] text-center" style={{ color: 'var(--text-main)' }}>
              {monthNames[month]} {year}
            </h3>
            <button onClick={handleNextMonth} style={{ padding: '0.5rem', background: '#F4F4F4', borderRadius: 8, color: '#646465' }}>
              <i className="ri-arrow-right-s-line text-xl" />
            </button>
          </div>

          <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
            {/* Department filter for Super Admin / Head */}
            {userRole === ROLES.SUPERADMIN && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-muted">Department:</span>
                <select
                  className="salary-input m-0"
                  style={{ minWidth: 160 }}
                  value={selectedDepartment}
                  onChange={e => setSelectedDepartment(e.target.value)}
                >
                  <option value="all">All Departments</option>
                  {departments.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            )}

            {userRole !== ROLES.EMPLOYEE && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-muted">Employee:</span>
                <select 
                  className="salary-input m-0" 
                  style={{ minWidth: 200 }} 
                  value={selectedEmployeeId} 
                  onChange={(e) => setSelectedEmployeeId(e.target.value)}
                >
                  <option value={user.id}>Me ({user.name})</option>
                  {(userRole === ROLES.SUPERADMIN ? filteredEmployees : employees)
                    .filter(e => e.id !== user.id)
                    .map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Calendar Grid */}
        <div style={{ border: '1px solid #E8E8E8', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#F4F4F4', borderBottom: '1px solid #E8E8E8' }}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div key={i} style={{ padding: '0.6rem', textAlign: 'center', fontWeight: 600, color: '#646465', fontSize: '0.85rem', borderRight: i < 6 ? '1px solid #E8E8E8' : 'none' }}>
                {d}
              </div>
            ))}
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {blanksArray.map(b => (
              <div key={`blank-${b}`} style={{ padding: '0.5rem', height: 65, borderRight: '1px solid #E8E8E8', borderBottom: '1px solid #E8E8E8' }}></div>
            ))}
            
            {daysArray.map(d => {
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const att = attendanceRecords[dateStr];
              const lv = leaveRecords[dateStr];
              
              const todayStr = appDateKey();
              
              const isToday = todayStr === dateStr;
              const isClickable = !!att || !!lv;
              const isWeekend = new Date(year, month, d).getDay() === 0;
              
              let indicator = null;
              if (lv && lv.days === 0.5 && att && att.check_in) {
                indicator = (
                  <div style={{ width: 24, height: 24, background: '#E0F2FE', color: '#0369A1', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.75rem', title: 'Half Day Leave + Present' }}>
                    L/P
                  </div>
                );
              } else if (lv || (att && att.dayType === 'Leave')) {
                indicator = (
                  <div style={{ width: 24, height: 24, background: '#FEE2E2', color: '#C0392B', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.85rem' }}>
                    L
                  </div>
                );
              } else if (att) {
                if (att.dayType === 'Half Day') {
                  indicator = (
                    <div style={{ width: 24, height: 24, background: '#FFEDD5', color: '#F97316', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.85rem' }}>
                      H
                    </div>
                  );
                } else if (att.isLate) {
                  indicator = (
                    <div style={{ width: 24, height: 24, background: '#FEF3C7', color: '#CA8A04', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.85rem' }}>
                      !
                    </div>
                  );
                } else {
                  indicator = (
                    <div style={{ width: 24, height: 24, background: '#D1FAE5', color: '#006742', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.85rem' }}>
                      <i className="ri-check-line"></i>
                    </div>
                  );
                }
              }

              return (
                <div 
                  key={d} 
                  onClick={() => handleDayClick(dateStr)}
                  style={{ 
                    padding: '0.5rem', 
                    height: 65, 
                    borderRight: '1px solid #E8E8E8', 
                    borderBottom: '1px solid #E8E8E8', 
                    background: isToday ? '#E8F2EF' : 'white',
                    cursor: isClickable ? 'pointer' : 'default',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.3rem',
                    transition: 'background 0.2s',
                  }}
                  onMouseOver={(e) => {
                    if (isClickable && !isToday) e.currentTarget.style.background = '#F4F4F4';
                  }}
                  onMouseOut={(e) => {
                    if (isClickable && !isToday) e.currentTarget.style.background = 'white';
                  }}
                >
                  <span style={{ fontSize: '0.95rem', color: isToday ? '#006742' : (isWeekend ? '#C0392B' : '#000000'), fontWeight: isToday ? 'bold' : 'normal' }}>
                    {d}
                  </span>
                  {indicator}
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', paddingTop: '0.5rem' }}>
          {[
            { color: '#D1FAE5', textColor: '#006742', label: 'Full Day / Present', symbol: '✓' },
            { color: '#FFEDD5', textColor: '#F97316', label: 'Half Day', symbol: 'H' },
            { color: '#FEF3C7', textColor: '#CA8A04', label: 'Late', symbol: '!' },
            { color: '#FEE2E2', textColor: '#C0392B', label: 'On Leave', symbol: 'L' },
            { color: '#E0F2FE', textColor: '#0369A1', label: '0.5 Leave + Present', symbol: 'L/P' },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#646465' }}>
              <div style={{ width: 20, height: 20, background: item.color, color: item.textColor, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.7rem', flexShrink: 0 }}>{item.symbol}</div>
              {item.label}
            </div>
          ))}
        </div>
      </div>

      {/* Date Detail Modal */}
      {selectedDateDetails && (
        <div className="salary-modal-overlay" onClick={() => setSelectedDateDetails(null)}>
          <div
            ref={detailDialogRef}
            className="salary-modal"
            style={{ maxWidth: 450 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="attendance-detail-title"
            tabIndex="-1"
            onClick={e => e.stopPropagation()}
          >
            <div className="salary-modal-header">
              <div>
                <h3 className="salary-modal-title" id="attendance-detail-title">Details for {formatAppDate(selectedDateDetails.date, { weekday: 'long', month: 'long' })}</h3>
              </div>
              <button type="button" className="salary-modal-close" onClick={() => setSelectedDateDetails(null)} aria-label="Close attendance details"><i className="ri-close-line" aria-hidden="true" /></button>
            </div>
            <div style={{ padding: '0 0 1rem' }}>
              
              <>
                  {selectedDateDetails.lv ? (
                    <div style={{ background: '#FFF2F2', padding: '1rem', borderRadius: 8, borderLeft: '4px solid #C0392B', marginBottom: '1rem' }}>
                      <h4 style={{ color: '#C0392B', fontWeight: 'bold', marginBottom: '0.5rem' }}><i className="ri-calendar-event-line"></i> {selectedDateDetails.lv.days === 0.5 ? 'Half Day ' : 'On '}Leave</h4>
                      <p style={{ fontSize: '0.9rem', color: '#000000', marginBottom: '0.25rem' }}><strong>Type:</strong> {selectedDateDetails.lv.type}</p>
                      <p style={{ fontSize: '0.9rem', color: '#000000' }}><strong>Reason:</strong> {selectedDateDetails.lv.reason || 'N/A'}</p>
                    </div>
                  ) : null}
                  
                  {selectedDateDetails.att ? (
                    <div>
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div style={{ background: '#F4F4F4', padding: '1rem', borderRadius: 8 }}>
                          <p style={{ fontSize: '0.8rem', color: '#646465', fontWeight: 600 }}>Check In</p>
                          <p style={{ fontSize: '1.1rem', color: '#000000', fontWeight: 'bold' }}>{formatAppTimeValue(selectedDateDetails.att.check_in)}</p>
                          {selectedDateDetails.att.isLate && (
                            <span style={{ fontSize: '0.75rem', color: '#CA8A04', background: '#FEF3C7', padding: '2px 6px', borderRadius: 4, fontWeight: 'bold' }}>LATE</span>
                          )}
                        </div>
                        <div style={{ background: '#F4F4F4', padding: '1rem', borderRadius: 8 }}>
                          <p style={{ fontSize: '0.8rem', color: '#646465', fontWeight: 600 }}>Check Out</p>
                          <p style={{ fontSize: '1.1rem', color: '#000000', fontWeight: 'bold' }}>{formatAppTimeValue(selectedDateDetails.att.check_out)}</p>
                          <span style={{ fontSize: '0.75rem', color: '#006742', background: '#E8F2EF', padding: '2px 6px', borderRadius: 4, fontWeight: 'bold' }}>
                            {selectedDateDetails.att.dayType.toUpperCase()}
                            {selectedDateDetails.att.durationHours ? ` (${selectedDateDetails.att.durationHours.toFixed(1)}h)` : ''}
                          </span>
                        </div>
                      </div>

                      <div className="attendance-work-mode">
                        <i
                          className={selectedDateDetails.att.work_mode === 'wfh'
                            ? 'ri-home-4-line'
                            : 'ri-building-line'}
                          aria-hidden="true"
                        />
                        <span>Work mode</span>
                        <strong>
                          {selectedDateDetails.att.work_mode === 'wfh'
                            ? 'Work from home'
                            : selectedDateDetails.att.work_mode === 'office'
                              ? 'Office'
                              : 'Not recorded'}
                        </strong>
                      </div>
                      
                      <div style={{ background: '#E8F2EF', padding: '1rem', borderRadius: 8, marginBottom: '0.5rem' }}>
                        <p style={{ fontSize: '0.8rem', color: '#006742', fontWeight: 600, marginBottom: '0.25rem' }}>Start-of-day plan</p>
                        <p style={{ fontSize: '0.9rem', color: '#000000', whiteSpace: 'pre-wrap' }}>{selectedDateDetails.att.bos_report || 'Not submitted'}</p>
                      </div>
                      
                      <div style={{ background: '#E0F5EE', padding: '1rem', borderRadius: 8 }}>
                        <p style={{ fontSize: '0.8rem', color: '#00A87E', fontWeight: 600, marginBottom: '0.25rem' }}>End-of-day summary</p>
                        <p style={{ fontSize: '0.9rem', color: '#000000', whiteSpace: 'pre-wrap' }}>{selectedDateDetails.att.eod_report || 'Not submitted'}</p>
                      </div>
                    </div>
                  ) : !selectedDateDetails.lv ? (
                    <p style={{ color: '#646465' }}>No attendance record found for this day.</p>
                  ) : null}

              </>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default Attendance;
