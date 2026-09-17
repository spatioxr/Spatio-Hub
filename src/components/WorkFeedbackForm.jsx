import React, { useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { FEEDBACK_OPTIONS, feedbackError } from '../utils/workFeedback';
import '../pages/WorkFeedback.css';

export default function WorkFeedbackForm({ source = 'anytime', pulseId, compact = false, onSubmitted, onSkip, onBusyChange }) {
  const [rating, setRating] = useState(null);
  const [message, setMessage] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [recipients, setRecipients] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError(''); setRecipients(null);
    supabase.rpc('work_feedback_recipients').then(({ data, error: failure }) => {
      if (!active) return;
      if (failure) setError(feedbackError(failure));
      else setRecipients(data || []);
    }).catch(() => { if (active) setError('Unable to load recipients. Please try again.'); });
    return () => { active = false; };
  }, [retry]);
  const submit = async (event) => {
    event.preventDefault();
    if (!rating || busy || sent || !recipients?.length) return;
    setBusy(true); onBusyChange?.(true); setError('');
    try {
      const { error: failure } = await supabase.rpc('submit_work_feedback', {
        request_id: requestId, rating, message: message.trim(), follow_up: followUp, submission_source: source, ...(pulseId ? { pulse_request: pulseId } : {}),
      });
      if (failure) throw failure;
      setSent(true); onSubmitted?.();
    } catch (failure) { setError(feedbackError(failure)); }
    finally { setBusy(false); onBusyChange?.(false); }
  };
  if (sent) return <div className="feedback-success" role="status"><h3>Thank you for sharing.</h3><p>Your feedback has been sent.</p>{onSkip && <button className="btn btn-primary" onClick={onSkip}>Done</button>}</div>;
  return <form className={`feedback-form${compact ? ' feedback-form-compact' : ''}`} onSubmit={submit}>
    {error && <p role="alert" className="feedback-error">{error} {!recipients && <button type="button" onClick={() => setRetry((v) => v + 1)}>Retry</button>}</p>}
    <fieldset disabled={busy || !recipients?.length}>
      <legend className={compact ? 'feedback-visually-hidden' : undefined}>How’s work going?</legend>
      <div className="feedback-options">{FEEDBACK_OPTIONS.map((option) => <label key={option.value} className={rating === option.value ? 'selected' : ''}>
        <input type="radio" name="work-feedback-mood" value={option.value} checked={rating === option.value} onChange={() => setRating(option.value)} required />
        <span aria-hidden="true" className="feedback-emoji">{option.emoji}</span><span>{option.label}</span>
      </label>)}</div>
      <div className={compact ? `feedback-note-reveal${rating ? ' is-open' : ''}` : undefined} aria-hidden={compact && !rating ? true : undefined}>
        <label className="feedback-comment"><span className="feedback-comment-label">Anything you’d like to share? <span>Optional</span></span>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={compact ? 2 : 3} placeholder="What’s going well, or what could be better?" />
        </label>
        {message.length > 1800 && <small>{2000 - message.length} characters remaining</small>}
      </div>
      <label className="feedback-followup"><input type="checkbox" checked={followUp} onChange={(event) => setFollowUp(event.target.checked)} />{compact ? 'I’d like someone to check in with me' : 'I’d like someone to follow up with me.'}</label>
    </fieldset>
    <div className="feedback-footer">
      <div className="feedback-disclosure">
        <p className="feedback-privacy">Sent with your name. Only superadmins can read it.</p>
        <details className="feedback-recipients"><summary>Who receives this?</summary>
          <p>{recipients === null ? 'Loading recipients…' : recipients.length ? `${recipients.map((r) => r.name).join(', ')}. Access is limited to whoever holds the superadmin role.` : 'No superadmin is available to receive feedback yet.'}</p>
        </details>
      </div>
      <div className="feedback-actions">{onSkip && <button type="button" className="btn btn-secondary" onClick={onSkip} disabled={busy}>Skip for now</button>}<button className="btn btn-primary" type="submit" disabled={!rating || busy || !recipients?.length}>{busy ? 'Sending…' : 'Send feedback'}</button></div>
    </div>
  </form>;
}
