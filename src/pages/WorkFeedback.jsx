import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import WorkFeedbackSettings from '../components/WorkFeedbackSettings';
import WorkFeedbackForm from '../components/WorkFeedbackForm';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { FEEDBACK_OPTIONS, FEEDBACK_STATUS, feedbackError } from '../utils/workFeedback';
import { formatAppDateTime } from '../utils/timezone';
import './WorkFeedback.css';

export default function WorkFeedback() {
  const { user } = useContext(AuthContext);
  const [view, setView] = useState('share');
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(null);
  const [notice, setNotice] = useState('');
  const [formVersion, setFormVersion] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const request = useRef(0);
  const load = useCallback(async ({ quiet = false } = {}) => {
    const seq = ++request.current;
    if (view !== 'inbox') return;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const { data, error: failure } = await supabase.rpc('list_work_feedback', { status_filter: filter || null, page_offset: page * 50 });
      if (failure) throw failure;
      if (seq === request.current) { setRows(data || []); setHasMore(data?.length === 50); }
    } catch (failure) { if (seq === request.current) { setRows([]); setError(feedbackError(failure)); } }
    finally { if (seq === request.current) setLoading(false); }
  }, [view, filter, page]);
  useEffect(() => { load(); return () => { request.current++; }; }, [load]);
  const changeView = (next) => { if (next === view) return; setView(next); setPage(0); setFilter(''); setRows([]); setError(''); setNotice(''); setSubmitted(false); };
  const advance = async (row) => {
    setSaving(row.id); setError(''); setNotice('');
    try {
      const { error: failure } = await supabase.rpc('advance_work_feedback', { target_id: row.id, expected_status: row.status });
      if (failure) throw failure;
      const nextStatus = row.status === 'new' ? 'acknowledged' : 'followed_up';
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, status: nextStatus } : item)
        .filter((item) => !filter || item.status === filter));
      setNotice(nextStatus === 'acknowledged' ? 'Feedback acknowledged.' : 'Marked as followed up.');
      if (filter) {
        if (rows.length === 1 && page > 0) setPage((current) => current - 1);
        else await load({ quiet: true });
      }
    } catch (failure) { setError(feedbackError(failure)); }
    finally { setSaving(null); }
  };
  return <Layout title="Work feedback" heading={view === 'settings' ? 'Feedback settings' : view === 'inbox' ? 'Team feedback' : 'Make work better'} description={view === 'settings' ? 'Choose when to check in with your team.' : view === 'inbox' ? 'Read, acknowledge, and follow up. Visible only to superadmins.' : 'Tell us how things are going.'}>
    {user.role === 'superadmin' && <div className="feedback-tabs" role="group" aria-label="Feedback views">
      <button className="btn btn-secondary" aria-pressed={view === 'share'} disabled={!!saving} onClick={() => changeView('share')}>Share feedback</button>
      {user.role === 'superadmin' && <button className="btn btn-secondary" aria-pressed={view === 'inbox'} disabled={!!saving} onClick={() => changeView('inbox')}>Team inbox</button>}
      <button className="btn btn-secondary" aria-pressed={view === 'settings'} disabled={!!saving} onClick={() => changeView('settings')}>Settings</button>
    </div>}
    {view === 'settings' ? <WorkFeedbackSettings /> : view === 'share' ? <section className="feedback-card feedback-compose"><WorkFeedbackForm key={formVersion} onSubmitted={() => setSubmitted(true)} />
      {submitted && <button className="feedback-new" onClick={() => { setSubmitted(false); setFormVersion((v) => v + 1); }}>Share another response</button>}
    </section> : <section className="feedback-list" aria-label="Team feedback inbox">
      <div className="feedback-inbox-toolbar">
        <div className="feedback-status-filters" role="group" aria-label="Filter feedback by status">
          {Object.entries({ '': 'All', ...FEEDBACK_STATUS }).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value}
            disabled={!!saving} onClick={() => { if (value === filter) return; setFilter(value); setPage(0); setRows([]); setNotice(''); }}>{label}</button>)}
        </div>
        <button className="feedback-refresh" type="button" onClick={() => load()} disabled={loading || !!saving}>
          <i className="ri-refresh-line" aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {notice && <p className="feedback-inbox-notice" role="status">{notice}</p>}
      {error && <p role="alert" className="feedback-error feedback-inbox-error">{error} <button type="button" onClick={() => load()}>Try again</button></p>}
      <div className="feedback-inbox-content" aria-busy={loading}>
      {loading ? <div className="feedback-inbox-empty" role="status">Loading feedback…</div> : !error && !rows.length ? <div className="feedback-inbox-empty">
        <i className="ri-chat-smile-2-line" aria-hidden="true" />
        <h2>{filter ? `No ${FEEDBACK_STATUS[filter].toLowerCase()} feedback` : 'No feedback yet'}</h2>
        <p>{filter ? 'Responses with this status will appear here.' : 'When someone shares how work is going, their response will appear here.'}</p>
        {filter && <button type="button" className="feedback-empty-reset" onClick={() => { setFilter(''); setPage(0); }}>View all feedback</button>}
      </div> : !loading && rows.map((row) => {
        const mood = FEEDBACK_OPTIONS.find((option) => option.value === row.mood);
        return <article key={row.id} className="feedback-inbox-row">
          <div className="feedback-row-heading">
            <div><h2>{row.employee_name}</h2><p className="feedback-meta">{formatAppDateTime(row.created_at)} · {row.source === 'pulse' ? 'Quick pulse' : row.source === 'weekly' ? 'Scheduled check-in' : 'Shared feedback'}</p></div>
            <span className="feedback-mood"><span aria-hidden="true">{mood?.emoji}</span> {mood?.label}</span>
          </div>
          {row.comment && <p className="feedback-message">{row.comment}</p>}
          <div className="feedback-row-footer">
            <div className="feedback-row-tags"><span className={`feedback-status feedback-status--${row.status}`}>{FEEDBACK_STATUS[row.status]}</span>
              {row.wants_follow_up && row.status !== 'followed_up' && <span className="feedback-followup-note"><i className="ri-chat-1-line" aria-hidden="true" /> Follow-up requested</span>}
            </div>
            {row.status !== 'followed_up' && <button className="btn btn-secondary" disabled={!!saving} onClick={() => advance(row)}
              title={row.status === 'acknowledged' ? 'Mark this after following up with the person' : undefined}>
              {saving === row.id ? 'Saving…' : row.status === 'new' ? 'Acknowledge' : 'Mark followed up'}
            </button>}
          </div>
        </article>;
      })}
      </div>
      {!error && (page > 0 || hasMore) && <div className="feedback-actions feedback-pagination"><button className="btn btn-secondary" disabled={page === 0 || loading || !!saving} onClick={() => setPage((v) => v - 1)}>Previous</button><span>Page {page + 1}</span><button className="btn btn-secondary" disabled={!hasMore || loading || !!saving} onClick={() => setPage((v) => v + 1)}>Next</button></div>}
    </section>}
  </Layout>;
}
