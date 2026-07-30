import React, { createContext, useState, useContext, useEffect } from 'react';
import { AuthContext } from './AuthContext';
import { supabase } from '../utils/supabaseClient';
import { canReviewLeave } from '../utils/leave';

export const LeaveContext = createContext();

export const LeaveProvider = ({ children }) => {
  const { user } = useContext(AuthContext);

  const [requests, setRequests] = useState([]);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const fetchLeaveData = async (surfaceError = true, showLoading = true) => {
    if (!user) {
      setRequests([]);
      setBalances({});
      setLoadError(null);
      setLoading(false);
      return { error: null };
    }

    if (showLoading) setLoading(true);
    setLoadError(null);

    // Fetch leaves with employee details
    const { data: leavesData, error: leavesError } = await supabase
      .from('leaves')
      .select(`
        *,
        employees (
          name,
          role,
          department
        )
      `)
      .order('created_at', { ascending: false });

    if (!leavesError && leavesData) {
      setRequests(leavesData);
    }

    // Fetch balances (only for current user normally, but admins/superadmins might need others)
    // For simplicity, we fetch all balances if admin/superadmin, or just own if employee.
    let balanceQuery = supabase.from('leave_balances').select('*');
    if (user.role === 'employee') {
      balanceQuery = balanceQuery.eq('employee_id', user.id);
    }
    
    const { data: balanceData, error: balanceError } = await balanceQuery;
    
    if (!balanceError && balanceData) {
      const balMap = {};
      balanceData.forEach(b => {
        balMap[b.employee_id] = {
          'Sick Leave': b.sick_leave,
          'Casual Leave': b.casual_leave,
          'Comp Off': b.comp_off
        };
      });
      setBalances(balMap);
    }

    const error = leavesError || balanceError || null;
    if (error && surfaceError) setLoadError(error);
    setLoading(false);
    return { error };
  };

  useEffect(() => {
    fetchLeaveData();
  }, [user]);

  // Apply for leave
  const applyLeave = async ({ type, from, to, reason, isHalfDay }) => {
    if (!user) return { error: new Error('Sign in to apply for leave.') };
    const { error } = await supabase.rpc('submit_leave_request', {
      leave_type: type,
      leave_from: from,
      leave_to: to,
      is_half_day: isHalfDay,
      leave_reason: reason,
    });

    if (error) return { error, committed: false };
    const refreshResult = await fetchLeaveData(false, false);
    return { error: refreshResult.error, committed: true };
  };

  // Update a pending leave request
  const updateLeave = async ({ id, type, from, to, reason, isHalfDay }) => {
    if (!user) return { error: new Error('Sign in to update leave.') };
    const { error } = await supabase.rpc('update_pending_leave_request', {
      target_leave_id: id,
      leave_type: type,
      leave_from: from,
      leave_to: to,
      is_half_day: isHalfDay,
      leave_reason: reason,
    });

    if (error) return { error, committed: false };
    const refreshResult = await fetchLeaveData(false, false);
    return { error: refreshResult.error, committed: true };
  };

  // Approve a leave request (only superadmin)
  const approveLeave = async (requestId) => {
    if (!canReviewLeave(user)) {
      return { error: new Error('Only a superadmin can approve leave.') };
    }

    const { error } = await supabase.rpc('decide_leave_request', {
      target_leave_id: requestId,
      approve: true,
      decision_comment: null,
    });
    if (error) return { error, committed: false };
    const refreshResult = await fetchLeaveData(false, false);
    return { error: refreshResult.error, committed: true };
  };

  // Reject a leave request (only superadmin)
  const rejectLeave = async (requestId, comment = '') => {
    if (!canReviewLeave(user)) {
      return { error: new Error('Only a superadmin can reject leave.') };
    }

    const { error } = await supabase.rpc('decide_leave_request', {
      target_leave_id: requestId,
      approve: false,
      decision_comment: comment,
    });
    if (error) return { error, committed: false };
    const refreshResult = await fetchLeaveData(false, false);
    return { error: refreshResult.error, committed: true };
  };

  // Grant Comp Off (Superadmin only)
  const grantCompOff = async (employeeId, daysToAdd) => {
    if (!canReviewLeave(user)) {
      return { error: new Error('Only a superadmin can grant Comp Off.') };
    }

    const { error } = await supabase.rpc('grant_comp_off_balance', {
      target_employee_id: employeeId,
      days_to_add: daysToAdd,
    });
    if (error) return { error, committed: false };
    const refreshResult = await fetchLeaveData(false, false);
    return { error: refreshResult.error, committed: true };
  };

  // Get balance for a given user
  const getUserBalance = (userId) => {
    const bal = balances[userId] || { 'Sick Leave': 0, 'Comp Off': 0, 'Casual Leave': 0 };
    return {
      'Sick Leave': { remaining: bal['Sick Leave'] },
      'Comp Off': { remaining: bal['Comp Off'] },
      'Casual Leave': { remaining: bal['Casual Leave'] }
    };
  };

  // Get requests visible to current user
  const getMyRequests = () => {
    if (!user) return [];
    return requests.filter(r => r.employee_id === user.id);
  };

  // Pending requests that current user can view/approve
  const getPendingForApproval = () => {
    if (!canReviewLeave(user)) return [];
    return requests.filter(r => r.status === 'Pending' && r.employee_id !== user.id);
  };

  // Get all leave history for admins/superadmins
  const getLeaveHistory = () => {
    return canReviewLeave(user) ? requests : [];
  };

  return (
    <LeaveContext.Provider value={{
      requests,
      applyLeave,
      updateLeave,
      approveLeave,
      rejectLeave,
      grantCompOff,
      getUserBalance,
      getMyRequests,
      getPendingForApproval,
      getLeaveHistory,
      refreshLeaveData: fetchLeaveData,
      loading,
      loadError
    }}>
      {children}
    </LeaveContext.Provider>
  );
};
