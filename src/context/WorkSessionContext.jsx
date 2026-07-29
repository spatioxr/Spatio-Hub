import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AuthContext } from './AuthContext';
import { supabase } from '../utils/supabaseClient';

export const WorkSessionContext = createContext({
  status: 'out',
  dayState: {
    bosRequired: true,
    eodRequired: true,
    bosSubmitted: false,
    eodSubmitted: false,
    hasWorkToday: false,
  },
  elapsedSeconds: 0,
  contextLabel: 'No active work',
  taskDescription: '',
  loading: false,
  error: '',
  refresh: async () => {},
  startSession: async () => {},
  switchSession: async () => {},
  startBreak: async () => {},
  resumeSession: async () => {},
  endDay: async () => {},
});

const firstRow = (data) => (Array.isArray(data) ? data[0] : data) || null;

const emptyDayState = {
  bosRequired: true,
  eodRequired: true,
  bosSubmitted: false,
  eodSubmitted: false,
  hasWorkToday: false,
};

const normaliseDayState = (data) => {
  const state = firstRow(data);
  if (!state) return emptyDayState;

  return {
    reportDate: state.report_date,
    bosRequired: state.bos_required,
    eodRequired: state.eod_required,
    bosSubmitted: state.bos_submitted,
    eodSubmitted: state.eod_submitted,
    hasWorkToday: state.has_work_today,
  };
};

const loadContextLabel = async (session) => {
  if (session.project_id) {
    const { data, error } = await supabase
      .from('projects')
      .select('code, name')
      .eq('id', session.project_id)
      .maybeSingle();

    if (error) throw error;
    return data ? `${data.code} · ${data.name}` : 'Project';
  }

  if (session.activity_id) {
    const { data, error } = await supabase
      .from('activities')
      .select('name')
      .eq('id', session.activity_id)
      .maybeSingle();

    if (error) throw error;
    return data?.name || 'Internal activity';
  }

  return 'Active work';
};

export const WorkSessionProvider = ({ children }) => {
  const { user } = useContext(AuthContext);
  const [snapshot, setSnapshot] = useState({
    session: null,
    breakEntry: null,
    workedSeconds: 0,
    syncedAt: Date.now(),
    contextLabel: 'No active work',
    dayState: emptyDayState,
  });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!user) {
      setSnapshot({
        session: null,
        breakEntry: null,
        workedSeconds: 0,
        syncedAt: Date.now(),
        contextLabel: 'No active work',
        dayState: emptyDayState,
      });
      setElapsedSeconds(0);
      setError('');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [
        { data: sessionData, error: sessionError },
        { data: dayData, error: dayError },
      ] = await Promise.all([
        supabase.rpc('current_work_session'),
        supabase.rpc('current_work_day_requirements'),
      ]);
      if (sessionError) throw sessionError;
      if (dayError) throw dayError;

      const session = firstRow(sessionData);
      const dayState = normaliseDayState(dayData);
      if (!session) {
        setSnapshot({
          session: null,
          breakEntry: null,
          workedSeconds: 0,
          syncedAt: Date.now(),
          contextLabel: 'No active work',
          dayState,
        });
        setElapsedSeconds(0);
        return;
      }

      const [
        { data: breakData, error: breakError },
        { data: workedData, error: workedError },
        contextLabel,
      ] = await Promise.all([
        supabase.rpc('current_work_break'),
        supabase.rpc('work_entry_worked_seconds', { target_work_entry_id: session.id }),
        loadContextLabel(session),
      ]);

      if (breakError) throw breakError;
      if (workedError) throw workedError;

      const workedSeconds = Math.max(0, Math.floor(Number(workedData) || 0));
      setSnapshot({
        session,
        breakEntry: firstRow(breakData),
        workedSeconds,
        syncedAt: Date.now(),
        contextLabel,
        dayState,
      });
      setElapsedSeconds(workedSeconds);
    } catch (refreshError) {
      console.error('Unable to restore the current work session:', refreshError.message);
      setError('Work status unavailable');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const startSession = useCallback(async ({
    projectId,
    activityId,
    taskDescription: nextTaskDescription,
    bosReport,
  }) => {
    const { error: startError } = await supabase.rpc('start_work_day', {
      target_project_id: projectId,
      target_activity_id: activityId,
      session_task_description: nextTaskDescription,
      beginning_of_day_report: bosReport || null,
    });

    if (startError) throw startError;
    await refresh();
  }, [refresh]);

  const switchSession = useCallback(async ({
    projectId,
    activityId,
    taskDescription: nextTaskDescription,
  }) => {
    const { error: switchError } = await supabase.rpc('switch_work_session', {
      target_project_id: projectId,
      target_activity_id: activityId,
      session_task_description: nextTaskDescription,
    });

    if (switchError) throw switchError;
    await refresh();
  }, [refresh]);

  const startBreak = useCallback(async () => {
    const { error: breakError } = await supabase.rpc('start_work_break');

    if (breakError) throw breakError;
    await refresh();
  }, [refresh]);

  const resumeSession = useCallback(async () => {
    const { error: resumeError } = await supabase.rpc('resume_work_session');

    if (resumeError) throw resumeError;
    await refresh();
  }, [refresh]);

  const endDay = useCallback(async ({ eodReport }) => {
    if (!snapshot.session) throw new Error('Open work session not found');

    const { error: endError } = await supabase.rpc('end_work_day', {
      target_work_entry_id: snapshot.session.id,
      end_of_day_report: eodReport || null,
    });

    if (endError) throw endError;
    await refresh();
  }, [refresh, snapshot.session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const handleSettingsChange = (event) => {
      if (!event.detail?.employeeId || event.detail.employeeId === user?.id) {
        refresh();
      }
    };

    window.addEventListener('focus', refresh);
    window.addEventListener('hrms:work-settings-changed', handleSettingsChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('hrms:work-settings-changed', handleSettingsChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh, user?.id]);

  useEffect(() => {
    if (!user?.id) return undefined;

    const channel = supabase
      .channel(`employee-work-settings-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'employee_work_settings',
          filter: `employee_id=eq.${user.id}`,
        },
        () => refresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh, user?.id]);

  useEffect(() => {
    if (!snapshot.session || snapshot.breakEntry) {
      setElapsedSeconds(snapshot.workedSeconds);
      return undefined;
    }

    const updateElapsed = () => {
      const sinceSync = Math.floor((Date.now() - snapshot.syncedAt) / 1000);
      setElapsedSeconds(snapshot.workedSeconds + Math.max(0, sinceSync));
    };

    updateElapsed();
    const timerId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timerId);
  }, [snapshot]);

  const value = useMemo(() => ({
    status: !snapshot.session ? 'out' : snapshot.breakEntry ? 'break' : 'working',
    session: snapshot.session,
    dayState: snapshot.dayState,
    elapsedSeconds,
    contextLabel: snapshot.contextLabel,
    taskDescription: snapshot.session?.task_description || '',
    loading,
    error,
    refresh,
    startSession,
    switchSession,
    startBreak,
    resumeSession,
    endDay,
  }), [
    elapsedSeconds,
    endDay,
    error,
    loading,
    refresh,
    snapshot,
    startBreak,
    startSession,
    resumeSession,
    switchSession,
  ]);

  return (
    <WorkSessionContext.Provider value={value}>
      {children}
    </WorkSessionContext.Provider>
  );
};
