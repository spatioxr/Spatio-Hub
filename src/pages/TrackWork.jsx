import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AppState from '../components/AppState';
import Layout from '../components/Layout';
import WorkTimerControl from '../components/WorkTimerControl';
import { AuthContext } from '../context/AuthContext';
import { WorkSessionContext } from '../context/WorkSessionContext';
import { supabase } from '../utils/supabaseClient';
import {
  appDateKey,
  appDayRange,
  formatAppClock,
  formatAppDate,
} from '../utils/timezone';

const formatDuration = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
};

const TrackWork = () => {
  const { user } = useContext(AuthContext);
  const {
    status,
    session,
    contextLabel,
    taskDescription,
    elapsedSeconds,
  } = useContext(WorkSessionContext);
  const [entries, setEntries] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const today = appDateKey();

  const loadToday = useCallback(async () => {
    if (!user?.id) return;

    setLoading(true);
    setError('');
    const range = appDayRange(today, today);
    const [entriesResult, reportResult] = await Promise.all([
      supabase.rpc('scoped_timesheet_entries', {
        requested_start_at: range.start,
        requested_end_at: range.end,
        requested_scope: 'personal',
        requested_employee_id: user.id,
      }),
      supabase
        .from('daily_reports')
        .select('bos_report, eod_report, bos_submitted_at, eod_submitted_at')
        .eq('employee_id', user.id)
        .eq('date', today)
        .maybeSingle(),
    ]);

    const loadError = entriesResult.error || reportResult.error;
    if (loadError) {
      setError(loadError.message || 'Unable to load today’s workday.');
    } else {
      setEntries(entriesResult.data || []);
      setReport(reportResult.data || null);
    }
    setLoading(false);
  }, [today, user?.id]);

  useEffect(() => {
    void loadToday();
  }, [contextLabel, loadToday, session?.id, status]);

  const summary = useMemo(() => entries.reduce((result, entry) => ({
    workedSeconds: result.workedSeconds + Number(entry.worked_seconds || 0),
    breakSeconds: result.breakSeconds + Number(entry.break_seconds || 0),
  }), { workedSeconds: 0, breakSeconds: 0 }), [entries]);

  const statusCopy = status === 'working'
    ? 'Working'
    : status === 'break' ? 'On break' : 'Not working';

  return (
    <Layout
      title="Track Work"
      eyebrow="My workday"
      heading="Track Work"
      description="Start, pause, switch and finish today’s work from one focused place."
      showTimer={false}
    >
      <section className="card track-work-hero" aria-labelledby="track-work-status-title">
        <div className="track-work-hero-copy">
          <span className={`track-work-state track-work-state--${status}`}>
            <span aria-hidden="true" />
            {statusCopy}
          </span>
          <div>
            <span className="page-eyebrow">Current work</span>
            <h2 id="track-work-status-title">{contextLabel}</h2>
            <p>{taskDescription || 'Choose a project or internal activity when you start work.'}</p>
          </div>
          <div className="track-work-current-total">
            <span>Current session</span>
            <strong>{formatDuration(elapsedSeconds)}</strong>
          </div>
        </div>
        <WorkTimerControl variant="page" />
      </section>

      {error && (
        <AppState
          compact
          type="error"
          title="Today’s workday could not be refreshed"
          message={error}
          action={<button type="button" className="btn btn-outline" onClick={loadToday}>Try again</button>}
        />
      )}

      <section className="track-work-summary-grid" aria-label="Today’s work summary">
        <article className="card track-work-summary-card">
          <span className="track-work-summary-icon"><i className="ri-time-line" /></span>
          <div><span>Worked today</span><strong>{formatDuration(summary.workedSeconds)}</strong></div>
        </article>
        <article className="card track-work-summary-card">
          <span className="track-work-summary-icon track-work-summary-icon--break"><i className="ri-cup-line" /></span>
          <div><span>Breaks today</span><strong>{formatDuration(summary.breakSeconds)}</strong></div>
        </article>
        <article className="card track-work-summary-card">
          <span className="track-work-summary-icon track-work-summary-icon--sessions"><i className="ri-stack-line" /></span>
          <div><span>Work sessions</span><strong>{entries.length}</strong></div>
        </article>
      </section>

      <div className="track-work-grid">
        <section className="card track-work-timeline" aria-labelledby="today-timeline-title">
          <div className="track-work-section-heading">
            <div>
              <span className="page-eyebrow">{formatAppDate(today, { weekday: 'long', month: 'long' })}</span>
              <h2 id="today-timeline-title">Today’s timeline</h2>
            </div>
            <span>{formatDuration(summary.workedSeconds)} tracked</span>
          </div>

          {loading && entries.length === 0 ? (
            <AppState compact type="loading" title="Loading today" message="Collecting your work sessions and breaks." />
          ) : entries.length === 0 ? (
            <AppState compact type="empty" title="No work recorded yet" message="Start work to create today’s first session." />
          ) : (
            <ol className="track-work-entry-list">
              {entries.map((entry) => (
                <li key={entry.work_entry_id}>
                  <span className={`track-work-entry-icon track-work-entry-icon--${entry.context_type}`}>
                    <i className={entry.context_type === 'project' ? 'ri-folder-3-line' : 'ri-flashlight-line'} />
                  </span>
                  <div className="track-work-entry-copy">
                    <span>{entry.context_type === 'project' ? 'Project' : 'Internal activity'}</span>
                    <strong>{entry.context_label}</strong>
                    <p>{entry.task_description}</p>
                    {(entry.breaks || []).length > 0 && (
                      <small>{entry.breaks.length} {entry.breaks.length === 1 ? 'break' : 'breaks'} · {formatDuration(entry.break_seconds)}</small>
                    )}
                  </div>
                  <div className="track-work-entry-time">
                    <strong>{formatDuration(entry.worked_seconds)}</strong>
                    <span>{formatAppClock(entry.started_at)} – {entry.ended_at ? formatAppClock(entry.ended_at) : 'Now'}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card track-work-checkins" aria-labelledby="workday-checkins-title">
          <div className="track-work-section-heading">
            <div>
              <span className="page-eyebrow">Workday check-ins</span>
              <h2 id="workday-checkins-title">Plan and summary</h2>
            </div>
          </div>
          <article>
            <span className="track-work-checkin-label"><i className="ri-sun-line" /> Start-of-day plan</span>
            <p>{report?.bos_report || 'Submitted with your first work session when required.'}</p>
            {report?.bos_submitted_at && <time>{formatAppClock(report.bos_submitted_at)}</time>}
          </article>
          <article>
            <span className="track-work-checkin-label"><i className="ri-moon-line" /> End-of-day summary</span>
            <p>{report?.eod_report || 'Submitted when you finish your workday when required.'}</p>
            {report?.eod_submitted_at && <time>{formatAppClock(report.eod_submitted_at)}</time>}
          </article>
          <div className="track-work-checkins-note">
            These are one workday plan and one workday summary—not individual timesheet entries.
          </div>
        </section>
      </div>
    </Layout>
  );
};

export default TrackWork;
