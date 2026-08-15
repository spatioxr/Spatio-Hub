import React, { createContext, useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { isActivePerson, isArchivedPerson } from '../utils/people.js';

export const AuthContext = createContext();

const getAuthLinkType = () => {
  const queryType = new URLSearchParams(window.location.search).get('type');
  const hashType = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('type');
  return queryType || hashType;
};

const EMPLOYEE_PROFILE_FIELDS = [
  'id',
  'auth_id',
  'emp_code',
  'name',
  'email',
  'department',
  'role',
  'designation',
  'status',
  'date_of_joining',
  'managed_department',
  'reports_to',
  'avatar_url',
  'must_change_password',
  'is_leave_admin',
].join(', ');

const getEmployeeProfile = async (authUser) => {
  if (!authUser) return null;

  const { data: profileByAuthId, error: authIdError } = await supabase
    .from('employees')
    .select(EMPLOYEE_PROFILE_FIELDS)
    .eq('auth_id', authUser.id)
    .maybeSingle();

  if (authIdError) throw authIdError;
  if (profileByAuthId) return profileByAuthId;
  if (!authUser.email) return null;

  const { data: profileByEmail, error: emailError } = await supabase
    .from('employees')
    .select(EMPLOYEE_PROFILE_FIELDS)
    .eq('email', authUser.email.trim().toLowerCase())
    .maybeSingle();

  if (emailError) throw emailError;
  if (!profileByEmail) return null;

  // Transitional link for existing employees. HRMS-004 will enforce this
  // relationship through RLS once all users have been migrated.
  if (!profileByEmail.auth_id) {
    const { error: linkError } = await supabase
      .from('employees')
      .update({ auth_id: authUser.id })
      .eq('id', profileByEmail.id)
      .is('auth_id', null);

    if (linkError) {
      console.error('Unable to link employee profile to Auth user:', linkError.message);
    } else {
      profileByEmail.auth_id = authUser.id;
    }
  }

  return profileByEmail;
};

const inactiveProfileMessage = (profile) => (
  isArchivedPerson(profile)
    ? 'Your employee profile has been archived. Please contact HR if you need access restored.'
    : 'Your employee profile is not active. Please contact HR.'
);

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(
    () => ['invite', 'recovery'].includes(getAuthLinkType()),
  );

  const syncSession = useCallback(async (nextSession) => {
    setSession(nextSession);

    if (!nextSession?.user) {
      setUser(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setAuthError('');

    try {
      const employeeProfile = await getEmployeeProfile(nextSession.user);

      if (!employeeProfile) {
        setUser(null);
        setAuthError('Your login is not linked to an employee profile. Please contact HR.');
        await supabase.auth.signOut();
        return;
      }

      if (!isActivePerson(employeeProfile)) {
        setUser(null);
        setAuthError(inactiveProfileMessage(employeeProfile));
        await supabase.auth.signOut();
        return;
      }

      setUser(employeeProfile);
    } catch (error) {
      console.error('Unable to load employee profile:', error.message);
      setUser(null);
      setAuthError('Unable to load your employee profile. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;

      const authLinkType = getAuthLinkType();

      if (
        event === 'PASSWORD_RECOVERY'
        || (event === 'SIGNED_IN' && authLinkType === 'invite')
      ) {
        setIsPasswordRecovery(true);
      } else if (event === 'SIGNED_OUT') {
        setIsPasswordRecovery(false);
      }

      // Supabase advises keeping the auth callback synchronous. Run profile
      // loading immediately after the callback returns.
      window.setTimeout(() => {
        if (active) void syncSession(nextSession);
      }, 0);
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [syncSession]);

  const login = async (email, password) => {
    setAuthError('');

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      const message = error.message?.toLowerCase().includes('invalid login')
        ? 'Invalid email or password.'
        : error.message || 'Unable to sign in.';
      return { success: false, message };
    }

    try {
      const employeeProfile = await getEmployeeProfile(data.user);

      if (!employeeProfile) {
        await supabase.auth.signOut();
        return {
          success: false,
          message: 'Your login is not linked to an employee profile. Please contact HR.',
        };
      }

      if (!isActivePerson(employeeProfile)) {
        await supabase.auth.signOut();
        return {
          success: false,
          message: inactiveProfileMessage(employeeProfile),
        };
      }

      setSession(data.session);
      setUser(employeeProfile);
      setLoading(false);
      return { success: true };
    } catch (profileError) {
      await supabase.auth.signOut();
      return {
        success: false,
        message: profileError.message || 'Unable to load your employee profile.',
      };
    }
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) return { success: false, message: error.message };

    setSession(null);
    setUser(null);
    setIsPasswordRecovery(false);
    return { success: true };
  };

  const updateUser = (updatedFields) => {
    setUser((currentUser) => (
      currentUser ? { ...currentUser, ...updatedFields } : currentUser
    ));
  };

  const updatePassword = async ({ currentPassword, newPassword }) => {
    if (!session?.user || !user) {
      return { success: false, message: 'Not logged in.' };
    }

    if (!isPasswordRecovery) {
      const { error: verificationError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      if (verificationError) {
        return { success: false, message: 'Current password is incorrect.' };
      }
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { success: false, message: error.message };

    setIsPasswordRecovery(false);
    return { success: true };
  };

  const replaceTemporaryPassword = async ({ currentPassword, newPassword }) => {
    if (!session?.user || !user?.must_change_password) {
      return { success: false, message: 'A temporary-password change is not required.' };
    }

    const { data, error } = await supabase.functions.invoke('user-credentials', {
      body: {
        action: 'complete-temporary-password',
        currentPassword,
        newPassword,
      },
    });

    if (error) {
      let message = error.message || 'Unable to replace the temporary password.';
      try {
        const responseBody = await error.context?.json();
        message = responseBody?.error || message;
      } catch {
        // The Functions client may already have consumed a non-JSON response.
      }
      return { success: false, message };
    }

    if (data?.status !== 'password_changed') {
      return { success: false, message: 'The password change did not finish.' };
    }

    setUser((currentUser) => (
      currentUser ? { ...currentUser, must_change_password: false } : currentUser
    ));
    return { success: true };
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        authError,
        isPasswordRecovery,
        login,
        logout,
        updatePassword,
        replaceTemporaryPassword,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
