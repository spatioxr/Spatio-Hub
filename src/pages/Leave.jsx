import React, { useContext, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import AppState from '../components/AppState';
import { AuthContext } from '../context/AuthContext';
import { LeaveContext } from '../context/LeaveContext';
import { appDateKey, formatAppClock, formatAppDate } from '../utils/timezone';
import { calculateLeaveDays, canReviewLeave, filterLeaveHistory, previewBalanceAdjustment } from '../utils/leave';
import useDialogFocus from '../hooks/useDialogFocus';

const LEAVE_TYPES = ['Sick Leave', 'Casual Leave', 'Comp Off'];

const LEAVE_META = {
  'Sick Leave': { icon: 'ri-heart-pulse-line', tone: 'rose' },
  'Casual Leave': { icon: 'ri-umbrella-line', tone: 'green' },
  'Comp Off': { icon: 'ri-sun-line', tone: 'blue' },
};

const statusTone = (status) => ({
  Approved: 'success',
  Pending: 'warning',
  Rejected: 'danger',
}[status] || 'neutral');

const formatAmount = (amount) => {
  const value = Number(amount || 0);
  return `${value > 0 ? '+' : ''}${value}`;
};

const RequestTable = ({ requests, own, actionId, onEdit, onDecide }) => (
  <div className="table-wrap leave-request-table-wrap">
    <table className="leave-request-table">
      <thead>
        <tr>
          {!own && <th>Employee</th>}
          <th>Request</th>
          <th>Dates</th>
          <th>Days</th>
          <th>Status</th>
          <th>Reason / decision</th>
          {(own || onDecide) && <th aria-label="Actions" />}
        </tr>
      </thead>
      <tbody>
        {requests.map((request) => (
          <tr key={request.id}>
            {!own && (
              <td data-label="Employee">
                <div className="leave-person-cell">
                  <span>{request.employee_name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
                  <div><strong>{request.employee_name}</strong><small>{request.employee_code} · {request.employee_department || 'No department'}</small></div>
                </div>
              </td>
            )}
            <td data-label="Request">
              <span className={`leave-type-chip leave-type-chip--${LEAVE_META[request.type]?.tone || 'green'}`}>
                <i className={LEAVE_META[request.type]?.icon} /> {request.type}
              </span>
              <small className="leave-request-created">Requested {formatAppDate(request.created_at)}</small>
            </td>
            <td data-label="Dates">
              <strong>{formatAppDate(request.from_date, { month: 'short' })}</strong>
              <small>{request.from_date === request.to_date ? 'One date' : `to ${formatAppDate(request.to_date, { month: 'short' })}`}</small>
            </td>
            <td data-label="Days"><strong>{request.days}</strong></td>
            <td data-label="Status"><span className={`badge ${statusTone(request.status)}`}>{request.status}</span></td>
            <td data-label="Reason / decision">
              <span className="leave-request-reason">{request.reason}</span>
              {request.rejection_comment && <small className="leave-decision-note">{request.rejection_comment}</small>}
              {request.decided_at && <small>Decided {formatAppDate(request.decided_at)}{request.decided_by_name ? ` by ${request.decided_by_name}` : ''}</small>}
            </td>
            {(own || onDecide) && <td className="leave-request-actions">
              {own && request.status === 'Pending' && (
                <button type="button" className="btn btn-outline" onClick={() => onEdit(request)}>
                  <i className="ri-pencil-line" /> Edit
                </button>
              )}
              {!own && onDecide && request.status === 'Pending' && (
                <>
                  <button type="button" className="btn leave-approve-button" disabled={actionId === request.id} onClick={() => onDecide(request, true)}>
                    <i className="ri-check-line" /> Approve
                  </button>
                  <button type="button" className="btn btn-outline leave-reject-button" disabled={actionId === request.id} onClick={() => onDecide(request, false)}>
                    <i className="ri-close-line" /> Reject
                  </button>
                </>
              )}
            </td>}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const DecisionDialog = ({ decision, submitting, error, onClose, onSubmit }) => {
  const [comment, setComment] = useState('');
  const dialogRef = useDialogFocus(true, onClose, { closeDisabled: submitting });
  const rejecting = decision.approve === false;

  return (
    <div className="drawer-backdrop drawer-backdrop--center" onClick={(event) => event.target === event.currentTarget && !submitting && onClose()}>
      <section ref={dialogRef} className="leave-decision-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-decision-title" tabIndex="-1">
        <div className={`leave-decision-icon${rejecting ? ' leave-decision-icon--reject' : ''}`}>
          <i className={rejecting ? 'ri-close-line' : 'ri-check-line'} />
        </div>
        <span className="page-eyebrow">HR decision</span>
        <h2 id="leave-decision-title">{rejecting ? 'Reject' : 'Approve'} {decision.request.employee_name}&apos;s request?</h2>
        <p>{decision.request.type} · {decision.request.days} day(s) · {formatAppDate(decision.request.from_date)} to {formatAppDate(decision.request.to_date)}</p>
        <label className="people-field">
          <span>{rejecting ? 'Rejection reason *' : 'Decision note (optional)'}</span>
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder={rejecting ? 'Explain why this request is not approved' : 'Add a note for the employee'} disabled={submitting} />
        </label>
        {error && <div className="people-feedback people-feedback--error" role="alert">{error}</div>}
        <div className="leave-decision-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="button" className={`btn${rejecting ? ' leave-reject-confirm' : ''}`} onClick={() => onSubmit(comment)} disabled={submitting || (rejecting && !comment.trim())}>
            {submitting ? 'Saving…' : rejecting ? 'Confirm rejection' : 'Confirm approval'}
          </button>
        </div>
      </section>
    </div>
  );
};

const Leave = () => {
  const { user } = useContext(AuthContext);
  const {
    requests,
    holidays,
    balance,
    adminOverview,
    attendancePolicy,
    applyLeave,
    updateLeave,
    approveLeave,
    rejectLeave,
    adjustBalance,
    saveHoliday,
    removeHoliday,
    setLateCutoff,
    loadBalanceHistory,
    refreshLeaveData,
    loading,
    loadError,
  } = useContext(LeaveContext);
  const leaveAdmin = canReviewLeave(user);
  const [activeTab, setActiveTab] = useState('my');
  const [form, setForm] = useState({ type: 'Sick Leave', from: '', to: '', reason: '', isHalfDay: false });
  const [editingId, setEditingId] = useState(null);
  const [formMessage, setFormMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [decision, setDecision] = useState(null);
  const [decisionError, setDecisionError] = useState('');
  const [actionId, setActionId] = useState('');
  const [notice, setNotice] = useState(null);
  const [adjustment, setAdjustment] = useState({ employeeId: '', type: 'Sick Leave', amount: '1', operation: 'add', reason: '' });
  const [adjusting, setAdjusting] = useState(false);
  const [historyFilters, setHistoryFilters] = useState({ search: '', status: '', from: '', to: '' });
  const [historyEmployeeId, setHistoryEmployeeId] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [holidayForm, setHolidayForm] = useState({ name: '', date: '' });
  const [holidaySaving, setHolidaySaving] = useState(false);
  const [lateEnabled, setLateEnabled] = useState(Boolean(attendancePolicy?.late_after));
  const [lateTime, setLateTime] = useState(attendancePolicy?.late_after?.slice(0, 5) || '10:30');
  const [policySaving, setPolicySaving] = useState(false);

  const myRequests = useMemo(
    () => requests.filter((request) => request.employee_id === user?.id),
    [requests, user?.id],
  );
  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === 'Pending' && request.employee_id !== user?.id),
    [requests, user?.id],
  );
  const filteredHistory = useMemo(() => filterLeaveHistory(requests, historyFilters), [requests, historyFilters]);
  const historyRangeInvalid = Boolean(historyFilters.from && historyFilters.to && historyFilters.from > historyFilters.to);
  const adjustmentPerson = adminOverview.find((person) => person.employee_id === adjustment.employeeId);
  const balanceField = { 'Sick Leave': 'sick_leave', 'Casual Leave': 'casual_leave', 'Comp Off': 'comp_off' }[adjustment.type];
  const adjustmentPreview = previewBalanceAdjustment(adjustmentPerson?.[balanceField], adjustment.amount, adjustment.operation);
  const upcomingHolidays = holidays.filter((holiday) => holiday.date >= appDateKey());
  const previewDays = calculateLeaveDays(form.from, form.to, form.isHalfDay, holidays);

  useEffect(() => {
    setLateEnabled(Boolean(attendancePolicy?.late_after));
    setLateTime(attendancePolicy?.late_after?.slice(0, 5) || '10:30');
  }, [attendancePolicy]);

  useEffect(() => {
    if (!leaveAdmin || activeTab !== 'balances') return;
    const targetId = historyEmployeeId || adminOverview[0]?.employee_id || '';
    if (!targetId) return;
    if (!historyEmployeeId) setHistoryEmployeeId(targetId);
    setHistoryLoading(true);
    void loadBalanceHistory(targetId).then(({ data, error }) => {
      setTransactions(error ? [] : data);
      if (error) setNotice({ type: 'error', text: error.message || 'Unable to load balance history.' });
      setHistoryLoading(false);
    });
  }, [activeTab, adminOverview, historyEmployeeId, leaveAdmin, loadBalanceHistory]);

  const changeForm = (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => {
      const next = { ...current, [event.target.name]: value };
      if (event.target.name === 'from' && next.isHalfDay) next.to = value;
      if (event.target.name === 'isHalfDay' && value) next.to = next.from;
      return next;
    });
    setFormMessage(null);
  };

  const submitRequest = async (event) => {
    event.preventDefault();
    if (!form.from || !form.to || previewDays <= 0) {
      setFormMessage({ type: 'error', text: 'Choose a date range containing at least one company working day.' });
      return;
    }
    if (!form.reason.trim()) {
      setFormMessage({ type: 'error', text: 'A leave reason is required.' });
      return;
    }

    setSubmitting(true);
    const operation = editingId
      ? updateLeave({ ...form, id: editingId })
      : applyLeave(form);
    const result = await operation;
    setSubmitting(false);

    if (result.error && !result.committed) {
      setFormMessage({ type: 'error', text: result.error.message || 'Unable to save the leave request.' });
      return;
    }

    setFormMessage({
      type: result.error ? 'error' : 'success',
      text: result.error
        ? 'The request was saved, but the latest data could not be refreshed.'
        : editingId ? 'Pending request updated.' : 'Request sent to the HR leave queue.',
    });
    setForm({ type: 'Sick Leave', from: '', to: '', reason: '', isHalfDay: false });
    setEditingId(null);
  };

  const editRequest = (request) => {
    setEditingId(request.id);
    setForm({
      type: request.type,
      from: request.from_date,
      to: request.to_date,
      reason: request.reason,
      isHalfDay: Number(request.days) === 0.5,
    });
    setFormMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submitDecision = async (comment) => {
    setActionId(decision.request.id);
    setSubmitting(true);
    setDecisionError('');
    const result = decision.approve
      ? await approveLeave(decision.request.id, comment)
      : await rejectLeave(decision.request.id, comment);
    setSubmitting(false);
    setActionId('');
    if (result.error && !result.committed) {
      setDecisionError(result.error.message || 'Unable to save the decision.');
      return;
    }
    setDecision(null);
    setNotice({ type: result.error ? 'error' : 'success', text: result.error ? 'Decision saved; refresh failed.' : `Request ${decision.approve ? 'approved' : 'rejected'}.` });
  };

  const submitAdjustment = async (event) => {
    event.preventDefault();
    if (adjusting || !adjustment.employeeId || !adjustment.reason.trim() || !adjustmentPreview?.valid) return;
    setAdjusting(true);
    const result = await adjustBalance({
      ...adjustment,
      amount: adjustmentPreview.delta,
    });
    setAdjusting(false);
    if (result.error && !result.committed) {
      setNotice({ type: 'error', text: result.error.message || 'Unable to adjust the balance.' });
      return;
    }
    setNotice({ type: result.error ? 'error' : 'success', text: result.error ? 'Adjustment saved; refresh failed.' : 'Balance adjustment recorded in immutable history.' });
    setAdjustment((current) => ({ ...current, amount: '', reason: '' }));
    setHistoryEmployeeId(adjustment.employeeId);
    const history = await loadBalanceHistory(adjustment.employeeId);
    if (!history.error) setTransactions(history.data);
  };

  const submitHoliday = async (event) => {
    event.preventDefault();
    setHolidaySaving(true);
    const result = await saveHoliday(holidayForm);
    setHolidaySaving(false);
    if (result.error && !result.committed) {
      setNotice({ type: 'error', text: result.error.message || 'Unable to save the holiday.' });
      return;
    }
    setHolidayForm({ name: '', date: '' });
    setNotice({ type: result.error ? 'error' : 'success', text: result.error ? 'Holiday saved; refresh failed.' : 'Company holiday added.' });
  };

  const deleteHoliday = async (holiday) => {
    if (!window.confirm(`Remove ${holiday.name} from the company holiday calendar?`)) return;
    const result = await removeHoliday(holiday.id);
    setNotice({
      type: result.error ? 'error' : 'success',
      text: result.error
        ? result.error.message || 'Unable to remove the holiday.'
        : 'Company holiday removed.',
    });
  };

  const savePolicy = async (event) => {
    event.preventDefault();
    setPolicySaving(true);
    const result = await setLateCutoff(lateEnabled ? lateTime : null);
    setPolicySaving(false);
    setNotice({
      type: result.error ? 'error' : 'success',
      text: result.error ? result.error.message || 'Unable to save attendance policy.' : lateEnabled ? `Late timing is now after ${lateTime}.` : 'Late timing is disabled.',
    });
  };

  if (loading) {
    return (
      <Layout title="Leave" eyebrow="Time away" heading="Leave" description="Plan time away and follow every request from one place.">
        <div className="card"><AppState type="loading" title="Loading leave" message="Reconciling balances, requests and holidays." /></div>
      </Layout>
    );
  }

  if (loadError) {
    return (
      <Layout title="Leave" eyebrow="Time away" heading="Leave" description="Plan time away and follow every request from one place.">
        <div className="card"><AppState type="error" title="Leave could not be loaded" message={loadError.message} action={<button type="button" className="btn" onClick={() => refreshLeaveData()}>Try again</button>} /></div>
      </Layout>
    );
  }

  return (
    <Layout
      title="Leave"
      eyebrow="Time away"
      heading="Leave"
      description="See available days, request working-day leave and follow HR decisions. Attendance updates after approval."
      actions={leaveAdmin ? <span className="leave-admin-badge"><i className="ri-shield-user-line" /> Leave Admin</span> : null}
    >
      {notice && <div className={`people-feedback people-feedback--${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.text}</div>}

      <section className="leave-balance-overview" aria-label="My leave balances">
        {LEAVE_TYPES.map((type) => {
          const item = balance[type];
          const meta = LEAVE_META[type];
          return (
            <article className={`leave-balance-summary leave-balance-summary--${meta.tone}`} key={type}>
              <span className="leave-balance-summary-icon"><i className={meta.icon} /></span>
              <div className="leave-balance-summary-title"><span>{type}</span><strong>{item.remaining}</strong><small>available days</small></div>
              <div className="leave-balance-summary-breakdown"><span><strong>{item.pending}</strong> pending</span><span><strong>{item.used}</strong> used this year</span></div>
            </article>
          );
        })}
      </section>

      <div className="leave-primary-grid">
        <section className="card leave-apply-card" aria-labelledby="leave-apply-title">
          <div className="track-work-section-heading">
            <div><span className="page-eyebrow">My request</span><h2 id="leave-apply-title">{editingId ? 'Edit pending request' : 'Request leave'}</h2></div>
            {editingId && <button type="button" className="btn btn-outline" onClick={() => { setEditingId(null); setForm({ type: 'Sick Leave', from: '', to: '', reason: '', isHalfDay: false }); }}>Cancel edit</button>}
          </div>

          {formMessage && <div className={`leave-inline-message leave-inline-message--${formMessage.type}`} role={formMessage.type === 'error' ? 'alert' : 'status'}>{formMessage.text}</div>}

          <form className="leave-request-form" onSubmit={submitRequest}>
            <label><span>Leave type</span><select name="type" value={form.type} onChange={changeForm}>{LEAVE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
            <div className="leave-form-dates">
              <label><span>From</span><input type="date" name="from" value={form.from} onChange={changeForm} required /></label>
              <label><span>To</span><input type="date" name="to" value={form.to} onChange={changeForm} disabled={form.isHalfDay} required /></label>
            </div>
            <label className="leave-half-day-toggle"><input type="checkbox" name="isHalfDay" checked={form.isHalfDay} onChange={changeForm} /><span><strong>Half day</strong><small>Exactly 0.5 on one company working day</small></span></label>
            <label><span>Reason</span><textarea name="reason" value={form.reason} onChange={changeForm} placeholder="Briefly explain the request" required /></label>
            <div className="leave-request-preview">
              <span><i className="ri-calendar-check-line" /><strong>{previewDays}</strong> chargeable day{previewDays === 1 ? '' : 's'}</span>
              <small>Weekends and company holidays are excluded automatically.</small>
            </div>
            <button type="submit" className="btn" disabled={submitting}>{submitting ? 'Saving…' : editingId ? 'Update request' : 'Send to HR'}</button>
          </form>
        </section>

        <section className="card leave-holiday-card" aria-labelledby="leave-upcoming-title">
          <div className="track-work-section-heading"><div><span className="page-eyebrow">Company calendar</span><h2 id="leave-upcoming-title">Upcoming holidays</h2></div><span>{upcomingHolidays.length}</span></div>
          {upcomingHolidays.length === 0 ? (
            <AppState compact type="empty" title="No upcoming holidays" message="New company holidays will appear here." />
          ) : (
            <ol className="leave-holiday-list">
              {upcomingHolidays.slice(0, 6).map((holiday) => (
                <li key={holiday.id}>
                  <time><strong>{formatAppDate(holiday.date, { day: '2-digit', month: undefined, year: undefined })}</strong><span>{formatAppDate(holiday.date, { month: 'short', day: undefined, year: undefined })}</span></time>
                  <div><strong>{holiday.name}</strong><span>{formatAppDate(holiday.date, { weekday: 'long', day: undefined, month: undefined, year: undefined })}</span></div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <nav className="leave-workspace-tabs" aria-label="Leave workspace">
        <button type="button" className={activeTab === 'my' ? 'active' : ''} onClick={() => setActiveTab('my')}><i className="ri-file-list-3-line" /> My requests <span>{myRequests.length}</span></button>
        {leaveAdmin && <button type="button" className={activeTab === 'queue' ? 'active' : ''} onClick={() => setActiveTab('queue')}><i className="ri-inbox-archive-line" /> HR queue <span>{pendingRequests.length}</span></button>}
        {leaveAdmin && <button type="button" className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}><i className="ri-history-line" /> All requests</button>}
        {leaveAdmin && <button type="button" className={activeTab === 'balances' ? 'active' : ''} onClick={() => setActiveTab('balances')}><i className="ri-scales-3-line" /> Balances</button>}
        {leaveAdmin && <button type="button" className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}><i className="ri-calendar-settings-line" /> Holidays & policy</button>}
      </nav>

      {activeTab === 'my' && (
        <section className="card leave-workspace-card">
          <div className="track-work-section-heading"><div><span className="page-eyebrow">Request history</span><h2>My leave requests</h2></div><span>{myRequests.length} total</span></div>
          {myRequests.length === 0 ? <AppState compact type="empty" title="No requests yet" message="Your first request will appear here." /> : <RequestTable requests={myRequests} own actionId={actionId} onEdit={editRequest} />}
        </section>
      )}

      {activeTab === 'queue' && leaveAdmin && (
        <section className="card leave-workspace-card">
          <div className="track-work-section-heading"><div><span className="page-eyebrow">Organisation review</span><h2>HR leave queue</h2></div><span>{pendingRequests.length} awaiting decision</span></div>
          {pendingRequests.length === 0 ? <AppState compact type="success" title="Queue clear" message="There are no requests waiting for an HR decision." /> : <RequestTable requests={pendingRequests} actionId={actionId} onDecide={(request, approve) => { setDecision({ request, approve }); setDecisionError(''); }} />}
        </section>
      )}

      {activeTab === 'history' && leaveAdmin && (
        <section className="card leave-workspace-card">
          <div className="track-work-section-heading"><div><span className="page-eyebrow">Organisation history</span><h2>All leave requests</h2></div><span>{filteredHistory.length} {filteredHistory.length === 1 ? 'request' : 'requests'}</span></div>
          <div className="leave-admin-form leave-history-filters">
            <label><span>Employee, code or department</span><input type="search" value={historyFilters.search} onChange={(event) => setHistoryFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search employees" /></label>
            <label><span>Status</span><select value={historyFilters.status} onChange={(event) => setHistoryFilters((current) => ({ ...current, status: event.target.value }))}><option value="">All statuses</option>{['Pending', 'Approved', 'Rejected'].map((status) => <option key={status}>{status}</option>)}</select></label>
            <label><span>Leave from</span><input type="date" value={historyFilters.from} onChange={(event) => setHistoryFilters((current) => ({ ...current, from: event.target.value }))} /></label>
            <label><span>Leave to</span><input type="date" min={historyFilters.from || undefined} value={historyFilters.to} onChange={(event) => setHistoryFilters((current) => ({ ...current, to: event.target.value }))} /></label>
            <button type="button" className="btn btn-outline" onClick={() => setHistoryFilters({ search: '', status: '', from: '', to: '' })}>Clear filters</button>
          </div>
          {historyRangeInvalid && <p role="alert">Leave to must be on or after Leave from.</p>}
          <p className="leave-history-note">Includes requests overlapping the selected dates. Days show each full request; pending requests are not leave taken.</p>
          {filteredHistory.length === 0 ? <AppState compact type="empty" title="No matching requests" message="Try another employee, status or date range." /> : <RequestTable requests={filteredHistory} />}
        </section>
      )}

      {activeTab === 'balances' && leaveAdmin && (
        <div className="leave-admin-grid">
          <section className="card leave-adjustment-card">
            <div className="track-work-section-heading"><div><span className="page-eyebrow">Audited change</span><h2>Adjust a balance</h2></div></div>
            <form className="leave-admin-form" onSubmit={submitAdjustment}>
              <label><span>Employee</span><select value={adjustment.employeeId} onChange={(event) => setAdjustment((current) => ({ ...current, employeeId: event.target.value }))} required disabled={adjusting}><option value="">Choose employee</option>{adminOverview.filter((person) => person.employee_id !== user.id).map((person) => <option value={person.employee_id} key={person.employee_id}>{person.employee_name} · {person.employee_code}</option>)}</select><small>Leave Admins cannot change their own balance.</small></label>
              <label><span>Leave type</span><select value={adjustment.type} disabled={adjusting} onChange={(event) => setAdjustment((current) => ({ ...current, type: event.target.value }))}>{LEAVE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
              <label><span>Action</span><select value={adjustment.operation} onChange={(event) => setAdjustment((current) => ({ ...current, operation: event.target.value }))} disabled={adjusting}><option value="add">Add days</option><option value="remove">Remove days</option></select></label>
              <label><span>Number of days</span><input type="number" min="0.5" step="0.5" value={adjustment.amount} onChange={(event) => setAdjustment((current) => ({ ...current, amount: event.target.value }))} required disabled={adjusting} /><small>Use half-day increments, including adjustments for employees joining during the year.</small></label>
              <div className="leave-policy-note" aria-live="polite">{adjustmentPreview ? <span>Current: <strong>{adjustmentPreview.current} days</strong> → After {adjustment.operation === 'add' ? 'adding' : 'removing'} {adjustment.amount}: <strong>{adjustmentPreview.remaining} days</strong>{!adjustmentPreview.valid && ' — cannot remove more than the available balance.'}</span> : <span>Choose an employee and enter a positive number of days in half-day increments to preview the balance.</span>}</div>
              <label><span>Reason</span><textarea value={adjustment.reason} onChange={(event) => setAdjustment((current) => ({ ...current, reason: event.target.value }))} placeholder="Required for immutable history" required /></label>
              <button type="submit" className="btn" disabled={adjusting || !adjustmentPreview?.valid || !adjustment.reason.trim()}>{adjusting ? 'Recording…' : 'Record adjustment'}</button>
            </form>
          </section>

          <section className="card leave-balance-directory">
            <div className="track-work-section-heading"><div><span className="page-eyebrow">Current balances</span><h2>Employee balances</h2></div><span>{adminOverview.length} people</span></div>
            <div className="leave-balance-directory-list">
              {adminOverview.map((person) => (
                <button type="button" className={historyEmployeeId === person.employee_id ? 'active' : ''} onClick={() => setHistoryEmployeeId(person.employee_id)} key={person.employee_id}>
                  <span className="leave-directory-avatar">{person.employee_name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
                  <div><strong>{person.employee_name}</strong><small>{person.employee_department || 'No department'}</small></div>
                  <span><b>{person.sick_leave}</b> SL · <b>{person.casual_leave}</b> CL · <b>{person.comp_off}</b> CO</span>
                </button>
              ))}
            </div>
          </section>

          <section className="card leave-ledger-card">
            <div className="track-work-section-heading"><div><span className="page-eyebrow">Immutable history</span><h2>Balance ledger</h2></div></div>
            {historyLoading ? <AppState compact type="loading" title="Loading ledger" message="Collecting balance changes." /> : transactions.length === 0 ? <AppState compact type="empty" title="No balance history" message="Choose an employee or record an adjustment." /> : (
              <ol className="leave-ledger-list">
                {transactions.map((transaction) => (
                  <li key={transaction.transaction_id}>
                    <span className={Number(transaction.amount) > 0 ? 'positive' : 'negative'}>{formatAmount(transaction.amount)}</span>
                    <div><strong>{transaction.leave_type}</strong><p>{transaction.reason}</p><small>{formatAppDate(transaction.created_at)} · {formatAppClock(transaction.created_at)}{transaction.created_by_name ? ` · ${transaction.created_by_name}` : ''}</small></div>
                    <span className="badge neutral">{transaction.transaction_type.replace('_', ' ')}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}

      {activeTab === 'settings' && leaveAdmin && (
        <div className="leave-settings-grid">
          <section className="card">
            <div className="track-work-section-heading"><div><span className="page-eyebrow">Company calendar</span><h2>Add a holiday</h2></div></div>
            <form className="leave-admin-form" onSubmit={submitHoliday}>
              <label><span>Holiday name</span><input value={holidayForm.name} onChange={(event) => setHolidayForm((current) => ({ ...current, name: event.target.value }))} placeholder="Holiday name" required /></label>
              <label><span>Date</span><input type="date" value={holidayForm.date} onChange={(event) => setHolidayForm((current) => ({ ...current, date: event.target.value }))} required /></label>
              <button type="submit" className="btn" disabled={holidaySaving}>{holidaySaving ? 'Saving…' : 'Add holiday'}</button>
            </form>
            <ol className="leave-settings-holidays">
              {holidays.map((holiday) => (
                <li key={holiday.id}><div><strong>{holiday.name}</strong><span>{formatAppDate(holiday.date, { weekday: 'long', month: 'long' })}</span></div>{holiday.date >= appDateKey() && <button type="button" onClick={() => deleteHoliday(holiday)} aria-label={`Remove ${holiday.name}`}><i className="ri-delete-bin-line" /></button>}</li>
              ))}
            </ol>
          </section>

          <section className="card">
            <div className="track-work-section-heading"><div><span className="page-eyebrow">Attendance policy</span><h2>Late timing</h2></div></div>
            <p className="leave-settings-copy">Lateness is based only on the original daily check-in. Context switches never change it.</p>
            <form className="leave-admin-form" onSubmit={savePolicy}>
              <label className="leave-half-day-toggle"><input type="checkbox" checked={lateEnabled} onChange={(event) => setLateEnabled(event.target.checked)} /><span><strong>Enable a company late cutoff</strong><small>Leave disabled until HR has confirmed the policy.</small></span></label>
              <label><span>Late after</span><input type="time" value={lateTime} onChange={(event) => setLateTime(event.target.value)} disabled={!lateEnabled} required={lateEnabled} /><small>A check-in exactly at this time is on time; the next minute is late.</small></label>
              <button type="submit" className="btn" disabled={policySaving}>{policySaving ? 'Saving…' : 'Save policy'}</button>
            </form>
            <div className="leave-policy-note"><i className="ri-information-line" /><span>Working days are Monday–Friday. Weekends and company holidays do not consume leave.</span></div>
          </section>
        </div>
      )}

      {decision && <DecisionDialog decision={decision} submitting={submitting} error={decisionError} onClose={() => setDecision(null)} onSubmit={submitDecision} />}
    </Layout>
  );
};

export default Leave;
