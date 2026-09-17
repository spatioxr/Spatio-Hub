import React, { useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { feedbackError } from '../utils/workFeedback';
import { formatAppDateTime } from '../utils/timezone';

export default function WorkFeedbackSettings() {
  const [settings, setSettings] = useState(null);
  const [audiences, setAudiences] = useState(null);
  const [audience, setAudience] = useState('everyone');
  const [target, setTarget] = useState('');
  const selectedAudience = audiences?.find((item) => item.type === audience && item.key === target);
  const loadAudiences = async () => {
    const { data, error: failure } = await supabase.rpc('work_feedback_audiences');
    if (failure) throw failure;
    setAudiences(data || []);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmPulse, setConfirmPulse] = useState(false);
  const run = async (action) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const { data, error: failure } = await supabase.rpc(action === 'launch' ? 'launch_work_feedback_pulse' : action === 'save' ? 'save_work_feedback_schedule' : 'manage_work_feedback', action === 'launch' ? { audience, target: target || null } : action === 'save' ? { automatic: settings.enabled, cadence: settings.frequency, preferred_day: settings.weekday, timing: settings.time_mode || 'end_day', minutes: settings.time_minutes ?? 600, sound: settings.sound_enabled ?? true } : { action });
      if (failure) throw failure;
      if (action === 'get') await loadAudiences();
      setSettings((current) => action === 'launch' || action === 'close' ? { ...current, pulse: data.pulse } : data); setConfirmPulse(false);
      setNotice({ save: 'Schedule saved.', launch: 'Pulse is open. Employees will see it when the hub checks for new prompts.', close: 'Pulse closed. No new prompts will appear.' }[action] || '');
    } catch (failure) { setError(feedbackError(failure)); }
    finally { setBusy(false); }
  };
  useEffect(() => { let active = true;
    Promise.all([supabase.rpc('manage_work_feedback', { action: 'get' }), supabase.rpc('work_feedback_audiences')]).then(([schedule, choices]) => {
      if (!active) return;
      if (schedule.error) setError(feedbackError(schedule.error));
      else setSettings(schedule.data);
      if (choices.error) setError('Pulse audiences are not available yet. The database update needs to be applied.');
      else setAudiences(choices.data || []);
    }).catch((failure) => { if (active) setError(feedbackError(failure)); });
    return () => { active = false; };
  }, []);
  const pulse = settings?.pulse && new Date(settings.pulse.expires_at) > new Date() ? settings.pulse : null;
  return <section className="feedback-settings">
    {error && <p role="alert" className="feedback-error">{error} {!settings && <button onClick={() => run('get')} disabled={busy}>Retry</button>}</p>}
    {notice && <p role="status" className="feedback-inbox-notice">{notice}</p>}
    {!settings ? !error && <p role="status">Loading settings…</p> : <>
      <form className="feedback-card" onSubmit={(event) => { event.preventDefault(); run('save'); }}>
        <h2>Regular check-ins</h2><p>Choose when to ask the team how work is going.</p>
        <fieldset disabled={busy}>
          <label className="feedback-followup"><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />Ask automatically</label>
          <div className="feedback-schedule-fields">
            <label>Frequency<select disabled={!settings.enabled} value={settings.frequency} onChange={(event) => setSettings({ ...settings, frequency: event.target.value })}><option value="weekly">Weekly</option><option value="fortnightly">Every two weeks</option><option value="monthly">Monthly</option></select></label>
            <label>Preferred day<select disabled={!settings.enabled} value={settings.weekday} onChange={(event) => setSettings({ ...settings, weekday: Number(event.target.value) })}><option value={0}>Random weekday</option>{['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>
          </div>
          <div className="feedback-schedule-fields">
            <label>Time<select disabled={!settings.enabled} value={settings.time_mode || 'end_day'} onChange={(event) => setSettings({ ...settings, time_mode: event.target.value })}>
              <option value="end_day">After End Day</option><option value="fixed">At a specific time</option><option value="random">Random time · 10 AM–5 PM</option>
            </select></label>
            {settings.time_mode === 'fixed' && <label>Time (India)<input type="time" required disabled={!settings.enabled} value={`${String(Math.floor((settings.time_minutes ?? 600) / 60)).padStart(2, '0')}:${String((settings.time_minutes ?? 600) % 60).padStart(2, '0')}`} onChange={(event) => { if (event.target.value) { const [hours, minutes] = event.target.value.split(':').map(Number); setSettings({ ...settings, time_minutes: hours * 60 + minutes }); } }} /></label>}
          </div>
          <p className="feedback-meta">{settings.weekday === 0 ? 'A different weekday is chosen for each person each period.' : settings.frequency === 'monthly' ? 'The first selected weekday each month.' : 'On the selected weekday.'} {settings.time_mode === 'random' ? 'A different time is chosen per person, between 10 AM and 5 PM on weekdays.' : settings.time_mode === 'fixed' ? 'Appears when the hub is open at or after this time.' : 'Appears after their next End Day on or after the chosen day.'} One prompt per period, in India time. Missed prompts expire at the end of the period.</p>
          <label className="feedback-followup"><input type="checkbox" checked={settings.sound_enabled ?? true} onChange={(event) => setSettings({ ...settings, sound_enabled: event.target.checked })} />Play a gentle sound when a check-in or pulse appears</label>
          <p className="feedback-meta">Sound plays after the employee has interacted with the hub, if their browser allows audio.</p>
          <div className="feedback-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Please wait…' : 'Save schedule'}</button></div>
        </fieldset>
      </form>
      <section className="feedback-card"><h2>Quick pulse</h2><p>Ask the team how work is going, whenever you need a check-in.</p>
        {pulse ? <><p className="feedback-pulse-audience"><strong>{pulse.audience_label || 'Everyone'}</strong>{pulse.recipient_count != null && <> · {pulse.recipient_count} {pulse.recipient_count === 1 ? 'person' : 'people'}</>}</p><p className="feedback-pulse-active">Pulse open until {formatAppDateTime(pulse.expires_at)}</p><p className="feedback-meta">Each person sees it once. People can still finish a response they already opened.</p><button className="btn btn-secondary" disabled={busy} onClick={() => run('close')}>Close pulse</button></> : <>
          <p className="feedback-meta">Appears within about 30 seconds in an open hub, or when someone returns within 24 hours. It waits while they’re typing or using another dialog. Your own account is excluded.</p>
          <div className="feedback-schedule-fields">
            <label>Send to<select value={audience} disabled={busy} onChange={(event) => { setAudience(event.target.value); setTarget(''); setConfirmPulse(false); }}>
              <option value="everyone">Everyone</option><option value="project">Project members</option><option value="department">Department</option><option value="person">One person</option>
            </select></label>
            {audience !== 'everyone' && <label>{audience === 'project' ? 'Project' : audience === 'department' ? 'Department' : 'Person'}<select value={target} disabled={busy} onChange={(event) => { setTarget(event.target.value); setConfirmPulse(false); }}>
              <option value="">Choose {audience === 'person' ? 'a person' : audience === 'project' ? 'a project' : 'a department'}…</option>
              {(audiences || []).filter((item) => item.type === audience).map((item) => <option key={item.key} value={item.key} disabled={item.count === 0}>{item.label}{audience !== 'person' ? ` (${item.count})` : ''}</option>)}
            </select></label>}
          </div>
          <p className="feedback-meta" aria-live="polite">{selectedAudience ? `${selectedAudience.count} ${selectedAudience.count === 1 ? 'person' : 'people'} will receive this pulse. Your own account is excluded.` : 'Choose an audience to see who will receive the pulse.'}{audience === 'project' && ' Includes assigned members and project managers.'}</p>
          {confirmPulse ? <div className="feedback-pulse-confirm"><p>Send to <strong>{selectedAudience?.label}</strong> — {selectedAudience?.count} {selectedAudience?.count === 1 ? 'person' : 'people'}? The pulse stays open for 24 hours. They can answer or skip.</p><div className="feedback-actions"><button className="btn btn-secondary" disabled={busy} onClick={() => setConfirmPulse(false)}>Cancel</button><button className="btn btn-primary" disabled={busy || !selectedAudience?.count} onClick={() => run('launch')}>{busy ? 'Opening…' : 'Send pulse'}</button></div></div> : <button className="btn btn-primary" disabled={busy || !selectedAudience?.count} onClick={() => setConfirmPulse(true)}>Send pulse now</button>}
        </>}
      </section>
    </>}
  </section>;
}
