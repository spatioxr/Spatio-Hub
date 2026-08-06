import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabaseClient';

const DailyReportSettings = ({ onSaved }) => {
  const [employees, setEmployees] = useState([]);
  const [settings, setSettings] = useState({});
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkTaskDescriptionRequired, setBulkTaskDescriptionRequired] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      setLoading(true);
      setError('');

      const [
        { data: employeeRows, error: employeeError },
        { data: settingRows, error: settingsError },
      ] = await Promise.all([
        supabase
          .from('employees')
          .select('id, emp_code, name')
          .eq('status', 'Active')
          .order('name'),
        supabase
          .from('employee_work_settings')
          .select('employee_id, bos_required, eod_required, task_description_required, updated_at'),
      ]);

      if (cancelled) return;
      if (employeeError || settingsError) {
        setError('Unable to load work requirements.');
        setLoading(false);
        return;
      }

      const nextSettings = Object.fromEntries(
        (settingRows || []).map((row) => [row.employee_id, row]),
      );
      setEmployees(employeeRows || []);
      setSettings(nextSettings);
      setBulkTaskDescriptionRequired(
        !employeeRows?.length
          || !employeeRows.every(
            (employee) => nextSettings[employee.id]?.task_description_required === false,
          ),
      );
      setSelectedEmployeeId((current) => current || employeeRows?.[0]?.id || '');
      setLoading(false);
    };

    loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedEmployeeId),
    [employees, selectedEmployeeId],
  );
  const selectedSettings = settings[selectedEmployeeId] || {
    employee_id: selectedEmployeeId,
    bos_required: true,
    eod_required: true,
    task_description_required: true,
  };
  const taskDescriptionSummary = useMemo(() => {
    const requiredCount = employees.filter(
      (employee) => settings[employee.id]?.task_description_required ?? true,
    ).length;

    if (requiredCount === employees.length) return 'Required for every active employee';
    if (requiredCount === 0) return 'Optional for every active employee';
    return `Mixed requirements · ${requiredCount} of ${employees.length} required`;
  }, [employees, settings]);

  const updateSelected = (field, value) => {
    setMessage('');
    setSettings((current) => ({
      ...current,
      [selectedEmployeeId]: {
        ...selectedSettings,
        [field]: value,
      },
    }));
  };

  const handleSave = async () => {
    if (!selectedEmployeeId || saving) return;

    setSaving(true);
    setError('');
    setMessage('');
    const { data, error: saveError } = await supabase.rpc(
      'set_employee_work_requirements',
      {
        target_employee_id: selectedEmployeeId,
        require_bos: selectedSettings.bos_required,
        require_eod: selectedSettings.eod_required,
        require_task_description: selectedSettings.task_description_required,
      },
    );

    if (saveError) {
      setError(saveError.message || 'Unable to save work requirements.');
      setSaving(false);
      return;
    }

    const saved = Array.isArray(data) ? data[0] : data;
    if (saved) {
      setSettings((current) => ({
        ...current,
        [selectedEmployeeId]: saved,
      }));
    }
    window.dispatchEvent(new CustomEvent('hrms:work-settings-changed', {
      detail: { employeeId: selectedEmployeeId },
    }));
    await onSaved?.(selectedEmployeeId);
    setMessage(`Requirements saved for ${selectedEmployee?.name || 'employee'}.`);
    setSaving(false);
  };

  const handleBulkTaskDescriptionSave = async () => {
    if (loading || saving || bulkSaving) return;

    setBulkSaving(true);
    setError('');
    setMessage('');
    const { data, error: saveError } = await supabase.rpc(
      'set_task_description_requirement_for_all',
      { require_task_description: bulkTaskDescriptionRequired },
    );

    if (saveError) {
      setError(saveError.message || 'Unable to update task descriptions for everyone.');
      setBulkSaving(false);
      return;
    }

    setSettings((current) => ({
      ...current,
      ...Object.fromEntries((data || []).map((row) => [row.employee_id, row])),
    }));
    window.dispatchEvent(new CustomEvent('hrms:work-settings-changed', {
      detail: {},
    }));
    await onSaved?.();
    setMessage(
      `Task descriptions are now ${bulkTaskDescriptionRequired ? 'required' : 'optional'} for every active employee.`,
    );
    setBulkSaving(false);
  };

  return (
    <div className="card" data-testid="daily-report-settings">
      <div className="flex justify-between items-center mb-4" style={{ gap: '1rem' }}>
        <div>
          <h3 className="font-bold" style={{ fontSize: '1.125rem', color: 'var(--text-main)' }}>
            Work requirements
          </h3>
          <p className="text-muted text-sm mt-1">
            Set task descriptions for everyone at once, or customise any employee below.
          </p>
        </div>
        <i className="ri-settings-3-line" style={{ color: '#006742', fontSize: '1.5rem' }} />
      </div>

      {loading ? (
        <p className="text-muted text-sm">Loading requirements…</p>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <section
            aria-labelledby="all-employees-requirement-title"
            style={{
              display: 'grid',
              gap: '0.75rem',
              padding: '1rem',
              border: '1px solid #D5E9E1',
              borderRadius: '12px',
              background: '#F6FBF9',
            }}
          >
            <div>
              <h4 id="all-employees-requirement-title" className="font-medium">
                Task descriptions for everyone
              </h4>
              <p className="text-muted text-sm mt-1">{taskDescriptionSummary}</p>
            </div>
            <div
              className="flex justify-between items-end"
              style={{ gap: '0.75rem', flexWrap: 'wrap' }}
            >
              <label style={{ display: 'grid', gap: '0.35rem', flex: '1 1 15rem' }}>
                <span className="text-sm font-medium">Apply to every active employee</span>
                <select
                  className="salary-input"
                  value={bulkTaskDescriptionRequired ? 'required' : 'optional'}
                  onChange={(event) => {
                    setBulkTaskDescriptionRequired(event.target.value === 'required');
                    setMessage('');
                    setError('');
                  }}
                  disabled={saving || bulkSaving}
                  style={{ margin: 0, width: '100%' }}
                >
                  <option value="required">Required</option>
                  <option value="optional">Optional</option>
                </select>
              </label>
              <button
                type="button"
                className="btn-teal"
                onClick={handleBulkTaskDescriptionSave}
                disabled={saving || bulkSaving || employees.length === 0}
              >
                {bulkSaving ? 'Applying…' : 'Apply to everyone'}
              </button>
            </div>
            <small className="text-muted">
              This replaces the task-description choice for all active employees. You can still
              change one person afterwards.
            </small>
          </section>

          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span className="text-sm font-medium">Employee</span>
            <select
              className="salary-input"
              value={selectedEmployeeId}
              onChange={(event) => {
                setSelectedEmployeeId(event.target.value);
                setMessage('');
                setError('');
              }}
              style={{ margin: 0, width: '100%' }}
            >
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} ({employee.emp_code})
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'grid', gap: '0.65rem' }}>
            {[
              ['bos_required', 'Start-of-day plan', 'Requested on the first work start.'],
              ['eod_required', 'End-of-day summary', 'Requested before the final End Day.'],
              [
                'task_description_required',
                'Task description',
                'Requested when starting work or switching context.',
              ],
            ].map(([field, label, description]) => (
              <label
                key={field}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  padding: '0.8rem',
                  border: '1px solid #E8E8E8',
                  borderRadius: '10px',
                  cursor: 'pointer',
                }}
              >
                <span>
                  <span className="font-medium text-sm" style={{ display: 'block' }}>{label}</span>
                  <span className="text-muted" style={{ fontSize: '0.75rem' }}>{description}</span>
                </span>
                <input
                  type="checkbox"
                  checked={selectedSettings[field]}
                  onChange={(event) => updateSelected(field, event.target.checked)}
                  disabled={saving || bulkSaving}
                  aria-label={`Require ${label}`}
                  style={{ width: '1.15rem', height: '1.15rem', accentColor: '#006742' }}
                />
              </label>
            ))}
          </div>

          <div className="flex justify-between items-center" style={{ gap: '1rem', flexWrap: 'wrap' }}>
            <span
              className="text-sm"
              role={error ? 'alert' : 'status'}
              style={{ color: error ? '#B42318' : '#006742' }}
            >
              {error || message}
            </span>
            <button
              type="button"
              className="btn-teal"
              onClick={handleSave}
              disabled={!selectedEmployeeId || saving || bulkSaving}
            >
              {saving ? 'Saving…' : 'Save requirements'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DailyReportSettings;
