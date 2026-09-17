import React, { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import useDialogFocus from '../hooks/useDialogFocus';
import { enableFeedbackAudio, playFeedbackSound } from '../utils/feedbackSound';
import WorkFeedbackForm from './WorkFeedbackForm';

export default function WeeklyWorkFeedback() {
  const { user } = useContext(AuthContext);
  const [prompt, setPrompt] = useState(null);
  const [busy, setBusy] = useState(false);
  const showing = useRef(false);
  const close = () => { showing.current = false; setPrompt(null); };
  const ref = useDialogFocus(!!prompt, close, { closeDisabled: busy });
  useEffect(() => enableFeedbackAudio(), []);
  useEffect(() => {
    if (!user || user.role === 'observer') return undefined;
    let active = true; let checking = false; let scheduled = false; let pending = null;
    let lastPulseCheck = 0;
    const show = () => { showing.current = true; setPrompt(pending); if (pending.sound) playFeedbackSound(); pending = null; };
    const available = () => document.visibilityState === 'visible' && !showing.current
      && !document.querySelector('[role="dialog"], [aria-modal="true"]')
      && !document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')
      && !document.querySelector('.feedback-compose textarea:not(:placeholder-shown), .feedback-compose input:checked');
    const check = async () => {
      if (!active || checking || !available()) return;
      if (pending) { show(); return; }
      checking = true;
      try {
        if (Date.now() - lastPulseCheck >= 30000) {
          lastPulseCheck = Date.now();
          const { data, error } = await supabase.rpc('claim_work_feedback_pulse');
          if (!error && data) {
            pending = { source: 'pulse', id: data, sound: false }; scheduled = false;
            try { const sound = await supabase.rpc('work_feedback_sound_enabled'); pending.sound = !sound.error && sound.data === true; } catch { /* Deliver even if audio settings fail. */ }
          }
          if (!pending && !scheduled) {
            const timed = await supabase.rpc('claim_scheduled_work_feedback', { after_end_day: false });
            if (!timed.error && timed.data) pending = { source: 'weekly', id: 'scheduled', sound: timed.data.sound, afterEndDay: timed.data.after_end_day };
          }
        }
        if (!pending && scheduled) {
          scheduled = false;
          const { data, error } = await supabase.rpc('claim_scheduled_work_feedback', { after_end_day: true });
          if (!error && data) pending = { source: 'weekly', id: 'scheduled', sound: data.sound, afterEndDay: data.after_end_day };
        }
        if (active && pending && available()) show();
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
      <p>{prompt.afterEndDay ? 'You’re done for the day. How did it feel?' : 'Take a moment to let us know.'}</p>
    </header>
    <WorkFeedbackForm compact key={prompt.id} onBusyChange={setBusy} source={prompt.source} pulseId={pulse ? prompt.id : undefined} onSkip={close} />
  </section></div>, document.body);
}
