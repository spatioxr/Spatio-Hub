import React, { useState, useContext, useEffect } from 'react';
import Layout from '../components/Layout';
import { AuthContext } from '../context/AuthContext';
import { LeaveContext } from '../context/LeaveContext';
import { supabase } from '../utils/supabaseClient';
import AppState from '../components/AppState';
import { formatAppDate } from '../utils/timezone';
import { calculateLeaveDays } from '../utils/leave';

const LEAVE_TYPES = ['Sick Leave', 'Comp Off', 'Casual Leave'];

const LEAVE_COLORS = {
  'Sick Leave': { bg: '#FFF2F2', color: '#EE5D50', icon: 'ri-heart-pulse-line' },
  'Comp Off': { bg: '#EDF4FE', color: '#4318FF', icon: 'ri-sun-line' },
  'Casual Leave': { bg: '#F0FDF9', color: '#00A884', icon: 'ri-umbrella-line' },
};

const statusBadge = (status) => {
  const map = { Approved: 'success', Pending: 'warning', Rejected: 'danger' };
  return <span className={`badge ${map[status] || 'warning'}`}>{status}</span>;
};

// Component for Superadmin to grant Comp Off days
const GrantCompOffModal = ({ onClose, onGrant }) => {
  const [employees, setEmployees] = useState([]);
  const [selectedEmp, setSelectedEmp] = useState('');
  const [days, setDays] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase.from('employees').select('id, name').order('name').then(({ data }) => {
      setEmployees(data || []);
    });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedEmp || days <= 0) return;
    setSubmitting(true);
    await onGrant(selectedEmp, parseInt(days, 10));
    setSubmitting(false);
  };

  return (
    <div className="salary-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="salary-modal">
        <div className="salary-modal-header">
          <div>
            <h3 className="salary-modal-title">Grant Comp Off</h3>
            <p className="salary-modal-sub">Add Comp Off days to an employee's balance</p>
          </div>
          <button className="salary-modal-close" onClick={onClose}><i className="ri-close-line" /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="salary-field">
            <label className="salary-field-label">Employee <span className="salary-required">*</span></label>
            <select className="salary-input" value={selectedEmp} onChange={e => setSelectedEmp(e.target.value)} required>
              <option value="">-- Select Employee --</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="salary-field">
            <label className="salary-field-label">Days to Add <span className="salary-required">*</span></label>
            <input className="salary-input" type="number" min="1" value={days} onChange={e => setDays(e.target.value)} required />
          </div>
          <div className="salary-modal-actions">
            <button type="button" className="salary-cancel-btn" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="salary-submit-btn" disabled={submitting} style={{ background: '#003B2C' }}>
              {submitting ? 'Granting...' : 'Grant Days'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const Leave = () => {
  const { user } = useContext(AuthContext);
  const {
    applyLeave, updateLeave, getUserBalance, getMyRequests, getPendingForApproval,
    approveLeave, rejectLeave, grantCompOff, getLeaveHistory, loading
  } = useContext(LeaveContext);

  const [activeTab, setActiveTab] = useState('my');
  const [form, setForm] = useState({ type: 'Sick Leave', from: '', to: '', reason: '', isHalfDay: false });
  const [editingLeaveId, setEditingLeaveId] = useState(null);
  const [formMsg, setFormMsg] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [historyMonth, setHistoryMonth] = useState('');
  const [historyDepartment, setHistoryDepartment] = useState('');
  const [selectedLeaveReason, setSelectedLeaveReason] = useState(null); // { reason, type }
  const [rejectTarget, setRejectTarget] = useState(null); // { id } to reject
  const [rejectComment, setRejectComment] = useState('');

  const balance = user ? getUserBalance(user.id) : {};
  const myRequests = getMyRequests();
  const pendingApprovals = getPendingForApproval();

  const isSuperAdmin = user?.role === 'superadmin';
  const isAdmin = user?.role === 'admin';
  const canViewApprovals = ['admin', 'superadmin', 'manager', 'head'].includes(user?.role);
  const canApprove = isSuperAdmin; // only superadmin can approve/reject

  const leaveHistory = getLeaveHistory();
  const filteredHistory = leaveHistory.filter(r => {
    let match = true;
    if (historyMonth) {
      const fromMonth = (r.from_date || r.from || '').substring(0, 7);
      if (fromMonth !== historyMonth) match = false;
    }
    if (isSuperAdmin && historyDepartment) {
      if (r.employees?.department !== historyDepartment) match = false;
    }
    return match;
  });

  const handleFormChange = (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(prev => {
      const nextForm = { ...prev, [e.target.name]: value };
      if (nextForm.isHalfDay) nextForm.to = nextForm.from; // Lock "to" date if half day
      return nextForm;
    });
    setFormMsg(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.from || !form.to) {
      setFormMsg({ type: 'error', text: 'Please select both From and To dates.' });
      return;
    }
    if (!form.reason || !form.reason.trim()) {
      setFormMsg({ type: 'error', text: 'Leave reason is mandatory.' });
      return;
    }
    if (new Date(form.to) < new Date(form.from)) {
      setFormMsg({ type: 'error', text: '"To" date cannot be before "From" date.' });
      return;
    }

    const days = calculateLeaveDays(form.from, form.to, form.isHalfDay);
    const bal = balance[form.type];
    
    if (bal && days > bal.remaining && !(editingLeaveId)) {
      setFormMsg({ type: 'error', text: `Insufficient balance. You have ${bal.remaining} day(s) remaining for ${form.type}.` });
      return;
    }

    // Check for duplicate/overlapping leaves
    const { data: existingLeaves } = await supabase
      .from('leaves')
      .select('id, from_date, to_date')
      .eq('employee_id', user.id)
      .neq('status', 'Rejected');
    
    const newFrom = new Date(form.from).getTime();
    const newTo = new Date(form.to).getTime();
    const hasOverlap = existingLeaves?.some(l => {
      if (editingLeaveId && l.id === editingLeaveId) return false;
      const exFrom = new Date(l.from_date).getTime();
      const exTo = new Date(l.to_date).getTime();
      return (newFrom <= exTo && newTo >= exFrom);
    });

    if (hasOverlap) {
      setFormMsg({ type: 'error', text: 'You already have a leave request overlapping these dates.' });
      return;
    }

    setSubmitting(true);
    let result;
    if (editingLeaveId) {
      result = await updateLeave({
        id: editingLeaveId,
        type: form.type,
        from: form.from,
        to: form.to,
        reason: form.reason,
        isHalfDay: form.isHalfDay,
      });
    } else {
      result = await applyLeave({
        type: form.type,
        from: form.from,
        to: form.to,
        reason: form.reason,
        isHalfDay: form.isHalfDay,
      });
    }

    if (result?.error) {
      setFormMsg({
        type: 'error',
        text: result.error.message || 'Unable to save the leave request.',
      });
      setSubmitting(false);
      return;
    }

    setFormMsg({
      type: 'success',
      text: editingLeaveId
        ? `Leave request updated successfully! (${days} day${days > 1 ? 's' : ''})`
        : isSuperAdmin
          ? `Leave request submitted and auto-approved! (${days} day${days > 1 ? 's' : ''})`
          : `Leave request submitted successfully! Awaiting approval. (${days} day${days > 1 ? 's' : ''})`,
    });

    setForm({ type: 'Sick Leave', from: '', to: '', reason: '', isHalfDay: false });
    setEditingLeaveId(null);
    setSubmitting(false);
  };

  const handleEditLeave = (leave) => {
    setEditingLeaveId(leave.id);
    setForm({
      type: leave.type,
      from: leave.from_date || leave.from,
      to: leave.to_date || leave.to,
      reason: leave.reason || '',
      isHalfDay: leave.days === 0.5
    });
    setFormMsg(null);
    // scroll to top smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleGrant = async (employeeId, daysToAdd) => {
    await grantCompOff(employeeId, daysToAdd);
    setShowGrantModal(false);
  };

  const roleLabel = (role) => {
    if (role === 'superadmin') return 'Super Admin';
    if (role === 'admin') return 'Admin';
    return 'Employee';
  };

  if (loading) {
    return (
      <Layout
        title="Leave"
        eyebrow="Time away"
        heading="Leave"
        description="Manage your balance, requests and approvals in one place."
      >
        <div className="card">
          <AppState
            type="loading"
            title="Loading leave details"
            message="Your balances and requests are being prepared."
          />
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      title="Leave"
      eyebrow="Time away"
      heading="Leave"
      description="Manage your balance, requests and approvals in one place."
    >

      {/* ── Balance Cards ── */}
      <div className="leave-balance-grid">
        {LEAVE_TYPES.map(type => {
          const info = LEAVE_COLORS[type];
          const b = balance[type] || { remaining: 0 };
          return (
            <div key={type} className="leave-balance-card" style={{ borderTop: `4px solid ${info.color}` }}>
              <div className="leave-balance-header">
                <div className="leave-balance-icon" style={{ background: info.bg, color: info.color }}>
                  <i className={info.icon} />
                </div>
                <span className="leave-balance-type">{type}</span>
              </div>
              <div className="leave-balance-nums" style={{ justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div className="leave-balance-val" style={{ color: info.color, fontSize: '2rem' }}>{b.remaining}</div>
                  <div className="leave-balance-label">Remaining Days</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Main Content ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* Top: Apply Form */}
        <div className="card">
          <div className="leave-section-header">
            <h3 className="font-bold">Apply for Leave</h3>
            {isSuperAdmin && (
              <span className="leave-auto-badge">
                <i className="ri-flashlight-line" /> Auto-approved
              </span>
            )}
          </div>

          {formMsg && (
            <div className={`leave-form-msg ${formMsg.type}`}>
              <i className={formMsg.type === 'success' ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'} />
              {formMsg.text}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-4 gap-4">
              <div className="input-group">
                <label>Leave Type</label>
                <select name="type" value={form.type} onChange={handleFormChange}>
                  {LEAVE_TYPES.map(t => (
                    <option key={t} value={t}>
                      {t} ({(balance[t]?.remaining ?? 0)} days left)
                    </option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label>From</label>
                <input type="date" name="from" value={form.from} onChange={handleFormChange} required />
              </div>
              <div className="input-group">
                <label>To</label>
                <input type="date" name="to" value={form.to} onChange={handleFormChange} required disabled={form.isHalfDay} />
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <input type="checkbox" name="isHalfDay" checked={form.isHalfDay} onChange={handleFormChange} />
                  Half Day (0.5 days)
                </label>
              </div>
              <div className="input-group">
                <label>Reason</label>
                <input
                  type="text"
                  name="reason"
                  value={form.reason}
                  onChange={handleFormChange}
                  placeholder="Enter reason"
                />
              </div>
            </div>

            {/* Reason replaced in grid */}

            {form.from && form.to && new Date(form.to) >= new Date(form.from) && (
              <div className="leave-days-preview">
                <i className="ri-calendar-event-line" />
                <strong>
                  {calculateLeaveDays(form.from, form.to, form.isHalfDay)} day(s)
                </strong> requested
              </div>
            )}

            <button
              type="submit"
              className="btn-teal"
              style={{ marginTop: '1rem' }}
              disabled={submitting}
            >
              <i className="ri-send-plane-line" />
              {editingLeaveId ? 'Update Request' : isSuperAdmin ? 'Submit & Auto-Approve' : 'Submit Request'}
            </button>
          </form>
        </div>

        {/* Bottom: Tabs + History */}
        <div>
          {/* ── Tab Navigation ── */}
          <div className="salary-tabs" style={{ display: 'flex', alignItems: 'center', marginBottom: '1.5rem' }}>
            <button
              className={`salary-tab-btn${activeTab === 'my' ? ' active' : ''}`}
              onClick={() => setActiveTab('my')}
            >
              <i className="ri-file-list-3-line" /> My Leaves
              <span className="leave-tab-count" style={{ marginLeft: '0.25rem', background: '#E2E8F0', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem', color: '#1E293B' }}>{myRequests.length}</span>
            </button>
            {canViewApprovals && (
              <button
                className={`salary-tab-btn${activeTab === 'approvals' ? ' active' : ''}`}
                onClick={() => setActiveTab('approvals')}
              >
                <i className="ri-checkbox-circle-line" /> {(isSuperAdmin || user?.role === 'head') ? 'Pending Approvals' : 'Department Approvals'}
                {pendingApprovals.length > 0 && (
                  <span className="leave-tab-count pending" style={{ marginLeft: '0.25rem', background: '#FEE2E2', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem', color: '#991B1B' }}>{pendingApprovals.length}</span>
                )}
              </button>
            )}
            {canViewApprovals && (
              <button
                className={`salary-tab-btn${activeTab === 'history' ? ' active' : ''}`}
                onClick={() => setActiveTab('history')}
              >
                <i className="ri-history-line" /> Leave History
              </button>
            )}

            {isSuperAdmin && (
              <button className="salary-add-btn" onClick={() => setShowGrantModal(true)} style={{ marginLeft: 'auto', background: '#003B2C' }}>
                <i className="ri-award-line" /> Grant Comp Off
              </button>
            )}
          </div>

          {/* Top/Left: History or Approvals */}
          <div className="card">

            {/* My Leaves Tab */}
            {activeTab === 'my' && (
              <>
                <div className="leave-section-header">
                  <h3 className="font-bold">My Leave History</h3>
                  <span className="text-muted text-sm">{myRequests.length} request{myRequests.length !== 1 ? 's' : ''}</span>
                </div>
                {myRequests.length === 0 ? (
                  <AppState
                    compact
                    type="empty"
                    title="No leave requests yet"
                    message="Apply for leave above and your request will appear here."
                  />
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Leave Type</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Days</th>
                          <th>Status</th>
                          <th>Applied On</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {myRequests.map(row => (
                          <tr key={row.id}>
                            <td>
                              <span className="leave-type-pill" style={{
                                background: LEAVE_COLORS[row.type]?.bg,
                                color: LEAVE_COLORS[row.type]?.color
                              }}>
                                <i className={LEAVE_COLORS[row.type]?.icon} /> {row.type}
                              </span>
                            </td>
                            <td>{row.from_date || row.from}</td>
                            <td>{row.to_date || row.to}</td>
                            <td><strong>{row.days}</strong></td>
                            <td>{statusBadge(row.status)}</td>
                            <td style={{ color: '#A3AED0' }}>{formatAppDate(row.created_at || row.appliedOn || new Date())}</td>
                            <td>
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                  style={{ background: 'none', border: '1px solid #CBD5E1', borderRadius: 6, padding: '0.25rem 0.6rem', cursor: 'pointer', color: '#003B2C', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                                  onClick={() => setSelectedLeaveReason({ reason: row.reason || 'No reason provided.', type: row.type, comment: row.rejection_comment, status: row.status })}
                                >
                                  <i className="ri-eye-line" /> View
                                </button>
                                {row.status === 'Pending' && (
                                  <button
                                    style={{ background: 'none', border: '1px solid #CBD5E1', borderRadius: 6, padding: '0.25rem 0.6rem', cursor: 'pointer', color: '#64748B', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                                    onClick={() => handleEditLeave(row)}
                                  >
                                    <i className="ri-pencil-line" /> Edit
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* Pending Approvals Tab */}
            {activeTab === 'approvals' && canViewApprovals && (
              <>
                <div className="leave-section-header">
                  <h3 className="font-bold">{isSuperAdmin ? 'Pending Approvals' : 'Department Approvals'}</h3>
                  <span className="text-muted text-sm">{pendingApprovals.length} pending</span>
                </div>
                {pendingApprovals.length === 0 ? (
                  <AppState
                    compact
                    type="success"
                    title="You are all caught up"
                    message="There are no pending leave requests to review."
                  />
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Role</th>
                          <th>Leave Type</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Days</th>
                          <th>Status</th>
                          <th></th>
                          {canApprove && <th>Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {pendingApprovals.map(row => (
                          <tr key={row.id}>
                            <td>
                              <div className="leave-approval-user">
                                <div className="leave-approval-avatar">
                                  {(row.employees?.name || row.userName || 'User').split(' ').map(n => n[0]).join('').slice(0, 2)}
                                </div>
                                <span>{row.employees?.name || row.userName}</span>
                              </div>
                            </td>
                            <td>
                              <span className="badge primary">{roleLabel(row.employees?.role || row.userRole)}</span>
                            </td>
                            <td>
                              <span className="leave-type-pill" style={{
                                background: LEAVE_COLORS[row.type]?.bg,
                                color: LEAVE_COLORS[row.type]?.color
                              }}>
                                <i className={LEAVE_COLORS[row.type]?.icon} /> {row.type}
                              </span>
                            </td>
                            <td>{row.from_date || row.from}</td>
                            <td>{row.to_date || row.to}</td>
                            <td><strong>{row.days}</strong></td>
                            <td>{statusBadge(row.status)}</td>
                            <td>
                              <button
                                style={{ background: 'none', border: '1px solid #CBD5E1', borderRadius: 6, padding: '0.25rem 0.6rem', cursor: 'pointer', color: '#46ff18ff', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                                onClick={() => setSelectedLeaveReason({ reason: row.reason || 'No reason provided.', type: row.type, comment: row.rejection_comment, status: row.status })}
                              >
                                <i className="ri-eye-line" /> View
                              </button>
                            </td>
                            {canApprove && (
                              <td>
                                <div className="leave-action-btns">
                                  {row.status === 'Pending' && (
                                    <>
                                      <button
                                        className="leave-action-approve"
                                        onClick={() => approveLeave(row.id)}
                                        title="Approve"
                                      >
                                        <i className="ri-check-line" /> Approve
                                      </button>
                                      <button
                                        className="leave-action-reject"
                                        onClick={() => { setRejectTarget(row); setRejectComment(''); }}
                                        title="Reject"
                                      >
                                        <i className="ri-close-line" /> Reject
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* Leave History Tab */}
            {activeTab === 'history' && canViewApprovals && (
              <>
                <div className="leave-section-header">
                  <h3 className="font-bold">Leave History</h3>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <input
                      type="month"
                      className="salary-input"
                      value={historyMonth}
                      onChange={e => setHistoryMonth(e.target.value)}
                      style={{ padding: '0.25rem 0.5rem', margin: 0, width: '150px' }}
                    />
                    {isSuperAdmin && (
                      <select
                        className="salary-input"
                        value={historyDepartment}
                        onChange={e => setHistoryDepartment(e.target.value)}
                        style={{ padding: '0.25rem 0.5rem', margin: 0, width: '150px' }}
                      >
                        <option value="">All Departments</option>
                        <option value="Development">Development</option>
                        <option value="Design">Design</option>
                        <option value="Operations">Operations</option>
                        <option value="Sales">Sales</option>
                      </select>
                    )}
                  </div>
                </div>
                {filteredHistory.length === 0 ? (
                  <AppState
                    compact
                    type="empty"
                    title="No matching leave history"
                    message="Adjust the month or department filter to see more results."
                  />
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Role</th>
                          <th>Leave Type</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Days</th>
                          <th>Status</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHistory.map(row => (
                          <tr key={row.id}>
                            <td>
                              <div className="leave-approval-user">
                                <div className="leave-approval-avatar">
                                  {(row.employees?.name || row.userName || 'User').split(' ').map(n => n[0]).join('').slice(0, 2)}
                                </div>
                                <span>{row.employees?.name || row.userName}</span>
                              </div>
                            </td>
                            <td>
                              <span className="badge primary">{roleLabel(row.employees?.role || row.userRole)}</span>
                            </td>
                            <td>
                              <span className="leave-type-pill" style={{
                                background: LEAVE_COLORS[row.type]?.bg,
                                color: LEAVE_COLORS[row.type]?.color
                              }}>
                                <i className={LEAVE_COLORS[row.type]?.icon} /> {row.type}
                              </span>
                            </td>
                            <td>{row.from_date || row.from}</td>
                            <td>{row.to_date || row.to}</td>
                            <td><strong>{row.days}</strong></td>
                            <td>{statusBadge(row.status)}</td>
                            <td>
                              <button
                                style={{ background: 'none', border: '1px solid #CBD5E1', borderRadius: 6, padding: '0.25rem 0.6rem', cursor: 'pointer', color: '#003B2C', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                                onClick={() => setSelectedLeaveReason({ reason: row.reason || 'No reason provided.', type: row.type, comment: row.rejection_comment, status: row.status })}
                              >
                                <i className="ri-eye-line" /> View
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>

        </div>
      </div>

      {showGrantModal && (
        <GrantCompOffModal
          onClose={() => setShowGrantModal(false)}
          onGrant={handleGrant}
        />
      )}

      {/* Reason View Modal */}
      {selectedLeaveReason && (
        <div className="salary-modal-overlay" onClick={() => setSelectedLeaveReason(null)}>
          <div className="salary-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="salary-modal-header">
              <div>
                <h3 className="salary-modal-title">Leave Details</h3>
                <p className="salary-modal-sub" style={{ textTransform: 'capitalize' }}>{selectedLeaveReason.type}</p>
              </div>
              <button className="salary-modal-close" onClick={() => setSelectedLeaveReason(null)}><i className="ri-close-line" /></button>
            </div>
            <div style={{ padding: '0 0 1rem' }}>
              <p style={{ fontSize: '0.85rem', color: '#64748B', marginBottom: '0.25rem', fontWeight: 600 }}>Reason</p>
              <p style={{ color: '#1E293B', lineHeight: 1.6 }}>{selectedLeaveReason.reason || '—'}</p>
              {selectedLeaveReason.comment && (
                <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: '#FFF2F2', borderRadius: 8, borderLeft: '4px solid #EE5D50' }}>
                  <p style={{ fontSize: '0.85rem', color: '#EE5D50', fontWeight: 600, marginBottom: '0.25rem' }}>Rejection Comment</p>
                  <p style={{ color: '#7F1D1D', lineHeight: 1.6 }}>{selectedLeaveReason.comment}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject with Comment Modal */}
      {rejectTarget && (
        <div className="salary-modal-overlay" onClick={() => setRejectTarget(null)}>
          <div className="salary-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="salary-modal-header">
              <div>
                <h3 className="salary-modal-title">Reject Leave Request</h3>
                <p className="salary-modal-sub">Add a comment for {rejectTarget.employees?.name}</p>
              </div>
              <button className="salary-modal-close" onClick={() => setRejectTarget(null)}><i className="ri-close-line" /></button>
            </div>
            <div className="salary-field">
              <label className="salary-field-label">Rejection Comment <span style={{ color: '#A3AED0', fontWeight: 400 }}>(optional)</span></label>
              <textarea
                className="salary-input"
                style={{ minHeight: 100, resize: 'none' }}
                placeholder="Explain why the leave is being rejected..."
                value={rejectComment}
                onChange={e => setRejectComment(e.target.value)}
              />
            </div>
            <div className="salary-modal-actions">
              <button className="salary-cancel-btn" onClick={() => setRejectTarget(null)}>Cancel</button>
              <button
                className="salary-submit-btn"
                style={{ background: '#EE5D50' }}
                onClick={async () => {
                  await rejectLeave(rejectTarget.id, rejectComment);
                  setRejectTarget(null);
                  setRejectComment('');
                }}
              >
                <i className="ri-close-circle-line" /> Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default Leave;
