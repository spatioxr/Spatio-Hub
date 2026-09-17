import React, { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import useDialogFocus from '../hooks/useDialogFocus';
import WorkFeedbackForm from './WorkFeedbackForm';

export default function WeeklyWorkFeedback() {
  const { user } = useContext(AuthContext);
  const [prompt, setPrompt] = useState(null);
  const [busy, setBusy] = useState(false);
  const showing = useRef(false);
  const close = () => { showing.current = false; setPrompt(null); };
  const ref = useDialogFocus(!!prompt, close, { closeDisabled: busy });
  useEffect(() => {
    if (!user || user.role === 'observer') return undefined;
    let active = true; let checking = false; let scheduled = false; let pending = null;
    let lastPulseCheck = 0;
    const available = () => document.visibilityState === 'visible' && !showing.current
      && !document.querySelector('[role="dialog"], [aria-modal="true"]')
      && !document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')
      && !document.querySelector('.feedback-compose textarea:not(:placeholder-shown), .feedback-compose input:checked');
    const check = async () => {
      if (!active || checking || !available()) return;
      if (pending) { showing.current = true; setPrompt(pending); pending = null; return; }
      checking = true;
      try {
        if (Date.now() - lastPulseCheck >= 30000) {
          lastPulseCheck = Date.now();
          const { data, error } = await supabase.rpc('claim_work_feedback_pulse');
          if (!error && data) { pending = { source: 'pulse', id: data }; scheduled = false; }
        }
        if (!pending && scheduled) {
          scheduled = false;
          const { data, error } = await supabase.rpc('claim_work_feedback_prompt');
          if (!error && data) pending = { source: 'weekly', id: 'scheduled' };
        }
        if (active && pending && available()) { showing.current = true; setPrompt(pending); pending = null; }
      } catch { /* Optional feedback must never interfere with work. */ }
      finally { checking = false; }
    };
    const afterEndDay = () => { scheduled = true; check(); };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('workday-ended-feedback', afterEndDay);
    document.addEventListener('visibilitychange', onVisible);
    // Check UI availability frequently, but poll Supabase at most every 30 seconds.
    const interval = window.setInterval(check, 5000);
    check();
    return () => { active = false; window.clearInterval(interval); window.removeEventListener('workday-ended-feedback', afterEndDay); document.removeEventListener('visibilitychange', onVisible); };
  }, [user]);
  if (!prompt) return null;
  const pulse = prompt.source === 'pulse';
  return createPortal(<div className="feedback-backdrop"><section className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="weekly-feedback-title" ref={ref} tabIndex={-1}>
    <header className="feedback-dialog-header">
      <button type="button" className="feedback-dialog-close" aria-label="Close check-in" disabled={busy} onClick={close}>×</button>
      <h2 id="weekly-feedback-title">How’s work going?</h2>
      <p>{pulse ? 'Take a moment to let us know.' : 'You’re done for the day. How did it feel?'}</p>
    </header>
    <WorkFeedbackForm compact key={prompt.id} onBusyChange={setBusy} source={prompt.source} pulseId={pulse ? prompt.id : undefined} onSkip={close} />
  </section></div>, document.body);
}
