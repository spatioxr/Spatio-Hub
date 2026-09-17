import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../utils/supabaseClient';
import AppState from './AppState';
import SortableTable from './SortableTable';
import useDialogFocus from '../hooks/useDialogFocus';
import useUnsavedSettings from '../hooks/useUnsavedSettings';
import { checkInRequirements, hasCheckInException, checkInSettingsChanged } from '../utils/checkInSettings';
import './DailyReportSettings.css';

function CheckInEditor({ employee, saved, onClose, onSave }) {
  const [draft, setDraft] = useState(() => checkInRequirements(saved));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const dirty = checkInSettingsChanged(saved, draft);
  const close = () => { if (!savingRef.current && (!dirty || window.confirm('Discard unsaved check-in changes?'))) onClose(); };
  useEffect(() => {
    const root = document.getElementById('root');
    const wasInert = root?.inert;
    const overflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = 'hidden';
    return () => { if (root) root.inert = wasInert; document.body.style.overflow = overflow; };
  }, []);
  const dialogRef = useDialogFocus(true, close, { closeDisabled: saving });
  useUnsavedSettings(dirty, saving);
  const save = async (event) => {
    event.preventDefault();
    if (!dirty || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const { data, error: failure } = await supabase.rpc('set_daily_report_requirements', {
        target_employee_id: employee.id, require_bos: draft.bos_required, require_eod: draft.eod_required,
      });
      if (failure) throw failure;
      const row = Array.isArray(data) ? data[0] : data;
      onSave(employee, row || { employee_id: employee.id, ...draft });
    } catch (failure) { setError(failure.message || 'Unable to save check-ins. Your changes are still here; try again.'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return createPortal(<div className="drawer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <aside className="drawer check-in-editor" role="dialog" aria-modal="true" aria-labelledby="check-in-editor-title" ref={dialogRef} tabIndex={-1}>
      <div className="people-drawer-header"><div><span className="page-eyebrow">Check-in requirements</span><h2 id="check-in-editor-title">{employee.name}</h2><p>Employee ID {employee.emp_code}</p></div><button type="button" className="people-icon-button" disabled={saving} onClick={close} aria-label="Close check-in editor">×</button></div>
      <form onSubmit={save} className="check-in-editor-form">
        <div className="check-in-editor-options">{[
          ['bos_required', 'Start-of-day plan', 'Before the first work session of the day.'],
          ['eod_required', 'End-of-day summary', 'Before ending the workday.'],
        ].map(([field, title, description]) => <fieldset key={field} disabled={saving}>
          <legend>{title}</legend><p>{description}</p>
          <div className="check-in-choice">{[true, false].map((required) => <label key={String(required)} className={draft[field] === required ? 'selected' : ''}><input type="radio" name={field} checked={draft[field] === required} onChange={() => setDraft((current) => ({ ...current, [field]: required }))} /><span>{required ? 'Required' : 'Optional'}</span></label>)}</div>
        </fieldset>)}</div>
        <p className="check-in-help">Optional means the employee can start or end their workday without submitting that check-in.</p>
        {hasCheckInException(draft) && <button type="button" className="check-in-reset" disabled={saving} onClick={() => setDraft(checkInRequirements())}>Make both required</button>}
        {error && <p role="alert" className="people-feedback people-feedback--error">{error}</p>}
        <div className="people-drawer-actions"><button type="button" className="btn btn-outline" disabled={saving} onClick={close}>Cancel</button><button type="submit" className="btn" disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save changes'}</button></div>
      </form>
    </aside>
  </div>, document.body);
}

async function allRows(query) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query().range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
}

export default function DailyReportSettings({ onSaved }) {
  const [employees, setEmployees] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError('');
    try {
      const [people, preferences] = await Promise.all([
        allRows(() => supabase.from('employees').select('id, emp_code, name').eq('status', 'Active').order('name').order('id')),
        allRows(() => supabase.from('employee_work_settings').select('employee_id, bos_required, eod_required, updated_at').order('employee_id')),
      ]);
      if (id !== request.current) return;
      setEmployees(people);
      setSettings(Object.fromEntries(preferences.map((row) => [row.employee_id, row])));
    } catch (failure) { if (id === request.current) setError(failure.message || 'Unable to load check-in requirements.'); }
    finally { if (id === request.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => { request.current += 1; }; }, [load]);
  useEffect(() => { if (!message) return undefined; const timer = setTimeout(() => setMessage(''), 5000); return () => clearTimeout(timer); }, [message]);
  const exceptions = employees.filter((person) => hasCheckInException(settings[person.id])).length;
  const visible = useMemo(() => employees.filter((person) => (
    `${person.name} ${person.emp_code}`.toLowerCase().includes(search.trim().toLowerCase())
    && (filter === 'all' || hasCheckInException(settings[person.id]))
  )), [employees, settings, search, filter]);
  const saved = (employee, row) => {
    setSettings((current) => ({ ...current, [employee.id]: row }));
    setEditing(null);
    setMessage(`Check-in requirements saved for ${employee.name}.`);
    window.dispatchEvent(new CustomEvent('hrms:work-settings-changed', { detail: { employeeId: employee.id } }));
    Promise.resolve().then(() => onSaved?.(employee.id)).catch(() => setMessage(`Saved for ${employee.name}. Refresh related views if they have not updated.`));
  };
  return <div className="check-in-settings" data-testid="daily-report-settings">
    <p className="check-in-default"><strong>Both check-ins are required by default.</strong> Make either optional for individual employees. Only active employees are listed.</p>
    {message && <p className="people-feedback people-feedback--success" role="status">{message}</p>}
    <section className="card check-in-list" aria-label="Employee check-in requirements">
      <div className="check-in-toolbar"><label className="people-search"><i className="ri-search-line" aria-hidden="true" /><input type="search" aria-label="Search employees" placeholder="Search name or employee ID" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <div className="app-tabs" role="group" aria-label="Check-in filter">{[['all', 'All employees', employees.length], ['exceptions', 'Exceptions', exceptions]].map(([value, label, count]) => <button type="button" key={value} className={`app-tab${filter === value ? ' active' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label} ({loading || error ? '…' : count})</button>)}</div>
      </div>
      {loading ? <AppState type="loading" title="Loading check-in requirements" /> : error ? <AppState type="error" title="Unable to load requirements" message={error} action={<button type="button" className="btn btn-outline" onClick={load}>Try again</button>} /> : !visible.length ? <AppState type="empty" title={search ? 'No matching employees' : filter === 'exceptions' ? 'Everyone has both check-ins required' : 'No active employees'} message={search ? 'Try a different name or employee ID.' : filter === 'exceptions' ? 'Employees with an optional plan or summary will appear here.' : undefined} /> : <div className="table-wrap"><SortableTable sortId="checkIns" className="check-in-table">
        <thead><tr><th>Employee ID</th><th>Person</th><th>Start-of-day plan</th><th>End-of-day summary</th><th aria-label="Actions" /></tr></thead>
        <tbody>{visible.map((employee) => { const value = checkInRequirements(settings[employee.id]); return <tr key={employee.id}>
          <td data-label="Employee ID">{employee.emp_code}</td><td data-label="Person"><strong>{employee.name}</strong></td>
          {['bos_required', 'eod_required'].map((field) => <td key={field} data-label={field === 'bos_required' ? 'Start-of-day plan' : 'End-of-day summary'}><span className={`check-in-status${value[field] ? '' : ' check-in-status--optional'}`}>{value[field] ? 'Required' : 'Optional'}</span></td>)}
          <td><button type="button" className="people-action-button" aria-label={`Edit check-ins for ${employee.name}`} onClick={() => { setMessage(''); setEditing(employee); }}>Edit</button></td>
        </tr>; })}</tbody>
      </SortableTable></div>}
    </section>
    {editing && <CheckInEditor key={editing.id} employee={editing} saved={settings[editing.id]} onClose={() => setEditing(null)} onSave={saved} />}
  </div>;
}
