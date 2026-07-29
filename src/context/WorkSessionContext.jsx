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
  elapsedSeconds: 0,
  contextLabel: 'No active work',
  taskDescription: '',
  loading: false,
  error: '',
  refresh: async () => {},
  startSession: async () => {},
});

const firstRow = (data) => (Array.isArray(data) ? data[0] : data) || null;

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
      });
      setElapsedSeconds(0);
      setError('');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data: sessionData, error: sessionError } = await supabase.rpc('current_work_session');
      if (sessionError) throw sessionError;

      const session = firstRow(sessionData);
      if (!session) {
        setSnapshot({
          session: null,
          breakEntry: null,
          workedSeconds: 0,
          syncedAt: Date.now(),
          contextLabel: 'No active work',
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
  }) => {
    const { error: startError } = await supabase.rpc('start_work_session', {
      target_project_id: projectId,
      target_activity_id: activityId,
      session_task_description: nextTaskDescription,
    });

    if (startError) throw startError;
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh]);

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
    elapsedSeconds,
    contextLabel: snapshot.contextLabel,
    taskDescription: snapshot.session?.task_description || '',
    loading,
    error,
    refresh,
    startSession,
  }), [elapsedSeconds, error, loading, refresh, snapshot, startSession]);

  return (
    <WorkSessionContext.Provider value={value}>
      {children}
    </WorkSessionContext.Provider>
  );
};
