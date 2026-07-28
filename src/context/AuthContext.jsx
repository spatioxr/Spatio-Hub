import React, { createContext, useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';

export const AuthContext = createContext();

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

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

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

      if (event === 'PASSWORD_RECOVERY') {
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
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
