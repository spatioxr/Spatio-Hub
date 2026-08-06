import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabaseClient';

const defaultSettings = (employeeId = '') => ({
  employee_id: employeeId,
  bos_required: true,
  eod_required: true,
});

const DailyReportSettings = ({ onSaved }) => {
  const [employees, setEmployees] = useState([]);
  const [settings, setSettings] = useState({});
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      setLoading(true);
      setError('');

      const [employeeResult, settingsResult] = await Promise.all([
        supabase
          .from('employees')
          .select('id, emp_code, name')
          .eq('status', 'Active')
          .order('name'),
        supabase
          .from('employee_work_settings')
          .select('employee_id, bos_required, eod_required, updated_at'),
      ]);

      if (cancelled) return;
      if (employeeResult.error || settingsResult.error) {
        console.error(
          'Unable to load workday check-ins:',
          employeeResult.error?.message || settingsResult.error?.message,
        );
        setError('Unable to load workday check-ins. Please refresh and try again.');
        setLoading(false);
        return;
      }

      const employeeRows = employeeResult.data || [];
      setEmployees(employeeRows);
      setSettings(Object.fromEntries(
        (settingsResult.data || []).map((row) => [row.employee_id, row]),
      ));
      setSelectedEmployeeId((current) => current || employeeRows[0]?.id || '');
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
  const selectedSettings = settings[selectedEmployeeId]
    || defaultSettings(selectedEmployeeId);

  const updateSelected = (field, value) => {
    setMessage('');
    setError('');
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
      'set_daily_report_requirements',
      {
        target_employee_id: selectedEmployeeId,
        require_bos: selectedSettings.bos_required,
        require_eod: selectedSettings.eod_required,
      },
    );

    if (saveError) {
      console.error('Unable to save workday check-ins:', saveError.message);
      setError(saveError.message || 'Unable to save workday check-ins.');
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
    setMessage(`Check-ins saved for ${selectedEmployee?.name || 'employee'}.`);
    setSaving(false);
  };

  return (
    <div className="card workday-check-ins-card" data-testid="daily-report-settings">
      <div className="workday-check-ins-header">
        <div>
          <h3>Workday check-ins</h3>
          <p>Choose whether each employee submits a plan at the start and a summary at the end.</p>
        </div>
        <span className="workday-check-ins-icon" aria-hidden="true">
          <i className="ri-sun-line" />
        </span>
      </div>

      {loading ? (
        <p className="workday-check-ins-state">Loading check-ins…</p>
      ) : error && employees.length === 0 ? (
        <p className="workday-check-ins-message error" role="alert">{error}</p>
      ) : employees.length === 0 ? (
        <p className="workday-check-ins-state">No active employees found.</p>
      ) : (
        <div className="workday-check-ins-form">
          <label className="workday-check-ins-employee">
            <span>Employee</span>
            <select
              value={selectedEmployeeId}
              onChange={(event) => {
                setSelectedEmployeeId(event.target.value);
                setMessage('');
                setError('');
              }}
              disabled={saving}
            >
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} ({employee.emp_code})
                </option>
              ))}
            </select>
          </label>

          <div className="workday-check-ins-options">
            {[
              {
                field: 'bos_required',
                icon: 'ri-sunrise-line',
                label: 'Start-of-day plan',
                description: 'Ask for a plan before the first work session of the day.',
              },
              {
                field: 'eod_required',
                icon: 'ri-sunset-line',
                label: 'End-of-day summary',
                description: 'Ask for a summary before the employee ends the workday.',
              },
            ].map((option) => (
              <label className="workday-check-ins-option" key={option.field}>
                <span className="workday-check-ins-option-icon" aria-hidden="true">
                  <i className={option.icon} />
                </span>
                <span className="workday-check-ins-option-copy">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                <input
                  type="checkbox"
                  checked={selectedSettings[option.field]}
                  onChange={(event) => updateSelected(option.field, event.target.checked)}
                  disabled={saving}
                  aria-label={`Require ${option.label}`}
                />
              </label>
            ))}
          </div>

          <div className="workday-check-ins-footer">
            <span
              className={error ? 'workday-check-ins-message error' : 'workday-check-ins-message'}
              role={error ? 'alert' : 'status'}
            >
              {error || message}
            </span>
            <button
              type="button"
              className="btn-teal workday-check-ins-save"
              onClick={handleSave}
              disabled={!selectedEmployeeId || saving}
            >
              {saving ? 'Saving…' : 'Save check-ins'}
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default DailyReportSettings;
