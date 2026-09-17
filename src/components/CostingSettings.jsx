import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { appDateKey, formatAppDateTime } from '../utils/timezone';
import '../pages/Workload.css';

const CostingSettings = () => {
  const currentMonth = appDateKey().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [hours, setHours] = useState('176');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await supabase
        .from('costing_baselines')
        .select('id,effective_month,monthly_hours,reason,created_at')
        .order('effective_month', { ascending: false })
        .order('id', { ascending: false })
        .limit(20);
      if (result.error) throw result.error;
      setHistory(result.data || []);
    } catch (failure) {
      setError(failure.message || 'Unable to load costing settings.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await supabase.rpc('set_costing_baseline', {
        target_month: `${month}-01`,
        hours_per_month: Number(hours),
        change_reason: reason.trim(),
      });
      if (result.error) throw result.error;
      setReason('');
      setNotice(
        `Saved ${hours} hours effective ${month}. Earlier months retain their baseline.`,
      );
      await load();
    } catch (failure) {
      setError(failure.message || 'Unable to save the baseline.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section
      className="card workload-section workload-settings"
      aria-labelledby="costing-baseline-title"
    >
      <h2 id="costing-baseline-title">Monthly costing allowance</h2>
      <p>
        Default: 176 hours per person (22 × 8). A change applies from its
        selected month until the next change. Past months cannot be changed
        here. Current-month allocations remain provisional.
      </p>
      {error && (
        <p className="workload-error" role="alert">
          {error}{' '}
          <button type="button" className="workload-text-button" onClick={load}>
            Retry
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={save}>
        <label className="people-field">
          <span>Effective month</span>
          <input
            type="month"
            min={currentMonth}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            required
            disabled={saving}
          />
        </label>
        <label className="people-field">
          <span>Monthly hours per person</span>
          <input
            type="number"
            min="0.01"
            max="744"
            step="0.01"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            required
            disabled={saving}
          />
        </label>
        <label className="people-field">
          <span>Reason</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            disabled={saving}
          />
        </label>
        <button
          className="btn"
          disabled={saving || loading || !!error || !reason.trim()}
        >
          {saving ? 'Saving…' : 'Save allowance'}
        </button>
      </form>
      <details style={{ marginTop: 20 }}>
        <summary>Recent changes</summary>
        {loading ? (
          <p>Loading…</p>
        ) : history.length ? (
          <ul>
            {history.map((entry) => (
              <li key={entry.id}>
                {entry.effective_month.slice(0, 7)} · {entry.monthly_hours}h ·{' '}
                {entry.reason} · {formatAppDateTime(entry.created_at)}
              </li>
            ))}
          </ul>
        ) : (
          <p>No changes recorded. The default 176 hours applies.</p>
        )}
      </details>
    </section>
  );
};
export default CostingSettings;
