import useUnsavedSettings from '../hooks/useUnsavedSettings';
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { appDateKey, formatAppDate, formatAppDateTime } from '../utils/timezone';
import { effectiveCostingBaseline, latestCostingBaselines } from '../utils/costingSettings';
import '../pages/Workload.css';

const monthLabel = (month) => formatAppDate(`${month.slice(0, 7)}-01`, { day: undefined, month: 'long' });
export default function CostingSettings() {
  const currentMonth = appDateKey().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [historyLimit, setHistoryLimit] = useState(10);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = [];
      for (let offset = 0; ; offset += 500) {
        const result = await supabase.from('costing_baselines')
          .select('id,effective_month,monthly_hours,reason,created_at')
          .order('effective_month', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 499);
        if (result.error) throw result.error;
        rows.push(...result.data);
        if (result.data.length < 500) break;
      }
      setHistory(rows);
    } catch (failure) { setError(failure.message || 'Unable to load costing settings.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const baseline = effectiveCostingBaseline(history, month);
  const current = effectiveCostingBaseline(history, currentMonth);
  const scheduled = latestCostingBaselines(history).filter((entry) => entry.effective_month.slice(0, 7) > currentMonth);
  const dirty = editing && (Number(hours) !== Number(baseline.monthly_hours) || !!reason.trim());
  useUnsavedSettings(dirty, saving);
  const cancel = () => { if (!saving && (!dirty || window.confirm('Discard unsaved costing changes?'))) setEditing(false); };
  const save = async (event) => {
    event.preventDefault();
    if (saving || loading || Number(hours) === Number(baseline.monthly_hours)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await supabase.rpc('set_costing_baseline', {
        target_month: `${month}-01`, hours_per_month: Number(hours), change_reason: reason.trim(),
      });
      if (result.error) throw result.error;
      setEditing(false); setReason('');
      setNotice(`Saved ${hours} hours per person from ${monthLabel(month)}.`);
      await load();
    } catch (failure) { setError(failure.message || 'Unable to save the baseline.'); }
    finally { setSaving(false); }
  };
  return <section className="card work-setup-costing" aria-labelledby="costing-baseline-title">
    <header><div><h2 id="costing-baseline-title">Monthly hours for costing</h2><p>The hours per person used to calculate project cost allocations.</p></div>
      {!editing && <button type="button" className="btn btn-outline" disabled={loading || !!error} onClick={() => { setMonth(currentMonth); setHours(String(current.monthly_hours)); setReason(''); setEditing(true); }}>Edit</button>}
    </header>
    {error && <p role="alert" className="workload-error">{error} <button type="button" className="workload-text-button" onClick={load} disabled={saving}>Retry</button></p>}
    {notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Loading saved costing settings…</p> : !error && <>
      <div className="work-setup-baseline"><strong>{current.monthly_hours}<small> hours / person / month</small></strong><span>{current.effective_month ? `Effective from ${monthLabel(current.effective_month)}` : 'Default · 22 days × 8 hours'}</span></div>
      {scheduled.length > 0 && <div className="work-setup-scheduled"><h3>Scheduled changes</h3>{scheduled.slice().reverse().map((entry) => <p key={entry.id}>{monthLabel(entry.effective_month)} <strong>{entry.monthly_hours} hours / person</strong></p>)}</div>}
    </>}
    {editing && <form className="work-setup-costing-form" onSubmit={save}>
      <fieldset disabled={saving || loading}>
        <div className="work-setup-costing-fields"><label className="people-field"><span>Effective month</span><input type="month" min={currentMonth} required value={month} onChange={(e) => { setMonth(e.target.value); setHours(String(effectiveCostingBaseline(history, e.target.value).monthly_hours)); }} /></label>
        <label className="people-field"><span>Monthly hours per person</span><input type="number" min="0.01" max="744" step="0.01" required value={hours} onChange={(e) => setHours(e.target.value)} /></label></div>
        <p className="work-setup-help">Currently {baseline.monthly_hours} hours for {month ? monthLabel(month) : 'the selected month'}. This change applies from that month until the next scheduled change. Earlier months stay unchanged.</p>
        <label className="people-field"><span>Reason for change</span><input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Briefly explain the adjustment" /></label>
        <p className="work-setup-help">Current-month cost allocations remain provisional.</p>
        <div className="people-drawer-actions"><button type="button" className="btn btn-outline" onClick={cancel}>Cancel</button><button className="btn" disabled={!!error || !reason.trim() || Number(hours) === Number(baseline.monthly_hours)}>{saving ? 'Saving…' : 'Save changes'}</button></div>
      </fieldset>
    </form>}
    <details className="work-setup-history"><summary>Change history{!loading && ` (${history.length})`}</summary>
      {!loading && !history.length && <p>No changes recorded. The default applies.</p>}
      {history.slice(0, historyLimit).map((entry) => <article key={entry.id}><strong>{monthLabel(entry.effective_month)} · {entry.monthly_hours} hours</strong><p>{entry.reason}</p><small>Saved {formatAppDateTime(entry.created_at)}</small></article>)}
      {history.length > historyLimit && <button type="button" className="btn btn-outline" onClick={() => setHistoryLimit((value) => value + 20)}>Show more</button>}
    </details>
  </section>;
}
