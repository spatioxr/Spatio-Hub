import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { AuthContext } from './AuthContext';
import { supabase } from '../utils/supabaseClient';
import { canReviewLeave } from '../utils/leave';

const EMPTY_BALANCE = Object.freeze({
  'Sick Leave': { remaining: 0, pending: 0, used: 0 },
  'Casual Leave': { remaining: 0, pending: 0, used: 0 },
  'Comp Off': { remaining: 0, pending: 0, used: 0 },
});

export const LeaveContext = createContext({
  requests: [],
  holidays: [],
  balance: EMPTY_BALANCE,
  adminOverview: [],
  attendancePolicy: { late_after: null },
  loading: false,
  loadError: null,
  refreshLeaveData: async () => ({ error: null }),
});

const normaliseRequest = (request) => ({
  ...request,
  id: request.leave_id,
  type: request.leave_type,
  status: request.request_status,
  rejection_comment: request.decision_comment,
  employees: {
    name: request.employee_name,
    department: request.employee_department,
  },
});

const normaliseBalance = (rows = []) => rows.reduce((result, row) => ({
  ...result,
  [row.leave_type]: {
    remaining: Number(row.available || 0),
    pending: Number(row.pending || 0),
    used: Number(row.used_this_year || 0),
  },
}), { ...EMPTY_BALANCE });

export const LeaveProvider = ({ children }) => {
  const { user } = useContext(AuthContext);
  const [requests, setRequests] = useState([]);
  const [balance, setBalance] = useState(EMPTY_BALANCE);
  const [holidays, setHolidays] = useState([]);
  const [adminOverview, setAdminOverview] = useState([]);
  const [attendancePolicy, setAttendancePolicy] = useState({ late_after: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const fetchLeaveData = useCallback(async (surfaceError = true, showLoading = true) => {
    if (!user) {
      setRequests([]);
      setBalance(EMPTY_BALANCE);
      setHolidays([]);
      setAdminOverview([]);
      setAttendancePolicy({ late_after: null });
      setLoadError(null);
      setLoading(false);
      return { error: null };
    }

    if (showLoading) setLoading(true);
    if (surfaceError) setLoadError(null);

    const baseRequests = [
      supabase.rpc('scoped_leave_requests'),
      supabase.rpc('leave_balance_summary'),
      supabase.from('holidays').select('id, name, date').order('date', { ascending: true }),
      supabase.from('attendance_policy').select('late_after, working_weekdays, updated_at').maybeSingle(),
    ];
    if (canReviewLeave(user)) baseRequests.push(supabase.rpc('leave_admin_balance_overview'));

    const [requestsResult, balanceResult, holidaysResult, policyResult, overviewResult] = await Promise.all(baseRequests);
    const error = requestsResult.error
      || balanceResult.error
      || holidaysResult.error
      || policyResult.error
      || overviewResult?.error
      || null;

    if (error) {
      if (surfaceError) setLoadError(error);
      setLoading(false);
      return { error };
    }

    setRequests((requestsResult.data || []).map(normaliseRequest));
    setBalance(normaliseBalance(balanceResult.data));
    setHolidays(holidaysResult.data || []);
    setAttendancePolicy(policyResult.data || { late_after: null });
    setAdminOverview(overviewResult?.data || []);
    setLoading(false);
    return { error: null };
  }, [user]);

  useEffect(() => {
    void fetchLeaveData();
  }, [fetchLeaveData]);

  const commitAndRefresh = async (operation) => {
    const { error } = await operation();
    if (error) return { error, committed: false };
    const refreshResult = await fetchLeaveData(false, false);
    return { error: refreshResult.error, committed: true };
  };

  const applyLeave = (request) => commitAndRefresh(() => supabase.rpc('submit_leave_request', {
    leave_type: request.type,
    leave_from: request.from,
    leave_to: request.to,
    is_half_day: request.isHalfDay,
    leave_reason: request.reason,
  }));

  const updateLeave = (request) => commitAndRefresh(() => supabase.rpc('update_pending_leave_request', {
    target_leave_id: request.id,
    leave_type: request.type,
    leave_from: request.from,
    leave_to: request.to,
    is_half_day: request.isHalfDay,
    leave_reason: request.reason,
  }));

  const approveLeave = (requestId, comment = '') => commitAndRefresh(() => (
    supabase.rpc('decide_leave_request', {
      target_leave_id: requestId,
      approve: true,
      decision_comment: comment || null,
    })
  ));

  const rejectLeave = (requestId, comment = '') => commitAndRefresh(() => (
    supabase.rpc('decide_leave_request', {
      target_leave_id: requestId,
      approve: false,
      decision_comment: comment || null,
    })
  ));

  const adjustBalance = ({ employeeId, type, amount, reason }) => commitAndRefresh(() => (
    supabase.rpc('adjust_leave_balance', {
      target_employee_id: employeeId,
      leave_type: type,
      adjustment: amount,
      adjustment_reason: reason,
    })
  ));

  const saveHoliday = ({ id = null, name, date }) => commitAndRefresh(() => (
    supabase.rpc('save_company_holiday', {
      target_holiday_id: id,
      holiday_name: name,
      holiday_date: date,
    })
  ));

  const removeHoliday = (id) => commitAndRefresh(() => (
    supabase.rpc('remove_company_holiday', { target_holiday_id: id })
  ));

  const setLateCutoff = (value) => commitAndRefresh(() => (
    supabase.rpc('set_attendance_late_cutoff', {
      requested_late_after: value || null,
    })
  ));

  const loadBalanceHistory = useCallback(async (employeeId = null) => {
    const { data, error } = await supabase.rpc('leave_balance_history', {
      requested_employee_id: employeeId,
    });
    return { data: data || [], error };
  }, []);

  const value = {
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
    getUserBalance: () => balance,
    getMyRequests: () => requests.filter((request) => request.employee_id === user?.id),
    getPendingForApproval: () => (
      canReviewLeave(user)
        ? requests.filter((request) => request.status === 'Pending' && request.employee_id !== user?.id)
        : []
    ),
    getLeaveHistory: () => (canReviewLeave(user) ? requests : []),
    refreshLeaveData: fetchLeaveData,
    loading,
    loadError,
  };

  return <LeaveContext.Provider value={value}>{children}</LeaveContext.Provider>;
};
