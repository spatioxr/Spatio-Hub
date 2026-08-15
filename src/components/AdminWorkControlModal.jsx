import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import useDialogFocus from '../hooks/useDialogFocus';
import { supabase } from '../utils/supabaseClient';
import WorkEndDayModal from './WorkEndDayModal';
import WorkStartModal from './WorkStartModal';

const firstRow = (data) => (Array.isArray(data) ? data[0] : data) || null;

const AdminWorkControlModal = ({ employee, onClose, onChanged }) => {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState('');
  const [childModal, setChildModal] = useState(null);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const dialogRef = useDialogFocus(!childModal, onClose, { closeDisabled: Boolean(pendingAction) });

  const loadState = useCallback(async () => {
    setLoading(true);
    const { data, error: stateError } = await supabase.rpc('admin_employee_work_state', {
      target_employee_id: employee.employee_id,
    });
    if (stateError) {
      setError(stateError.message || 'Unable to load this work status.');
      setLoading(false);
      return;
    }
    setState(firstRow(data));
    setError('');
    setLoading(false);
  }, [employee.employee_id]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const dayState = state ? {
    bosRequired: state.bos_required,
    eodRequired: state.eod_required,
    bosSubmitted: state.bos_submitted,
    eodSubmitted: state.eod_submitted,
    hasWorkToday: state.has_work_today,
  } : null;
  const session = state?.work_entry_id ? {
    id: state.work_entry_id,
    project_id: state.project_id,
    activity_id: state.activity_id,
    task_description: state.task_description,
  } : null;
  const subject = { id: employee.employee_id, name: employee.employee_name };

  const finishAction = async (message) => {
    setConfirmation(message);
    await loadState();
    onChanged?.();
  };

  const startSession = async ({ projectId, activityId, bosReport, workMode }) => {
    const { error: actionError } = await supabase.rpc('admin_start_work_day', {
      target_employee_id: employee.employee_id,
      target_project_id: projectId,
      target_activity_id: activityId,
      beginning_of_day_report: bosReport || null,
      declared_work_mode: workMode || state?.work_mode || 'office',
    });
    if (actionError) throw actionError;
  };

  const switchSession = async ({ projectId, activityId, taskDescription }) => {
    const { error: actionError } = await supabase.rpc('admin_switch_work_session', {
      target_employee_id: employee.employee_id,
      target_project_id: projectId,
      target_activity_id: activityId,
      session_task_description: taskDescription,
    });
    if (actionError) throw actionError;
  };

  const endDay = async ({ eodReport }) => {
    const { error: actionError } = await supabase.rpc('admin_end_work_day', {
      target_employee_id: employee.employee_id,
      target_work_entry_id: state.work_entry_id,
      end_of_day_report: eodReport || null,
    });
    if (actionError) throw actionError;
  };

  const runImmediateAction = async (action) => {
    setPendingAction(action);
    setError('');
    try {
      const functionName = action === 'break'
        ? 'admin_start_work_break'
        : 'admin_resume_work_session';
      const { error: actionError } = await supabase.rpc(functionName, {
        target_employee_id: employee.employee_id,
      });
      if (actionError) throw actionError;
      await finishAction(action === 'break' ? 'Break started' : 'Work resumed');
    } catch (actionError) {
      setError(actionError.message || `Unable to ${action === 'break' ? 'start break' : 'resume work'}.`);
    } finally {
      setPendingAction('');
    }
  };

  if (childModal === 'start' || childModal === 'switch') {
    return (
      <WorkStartModal
        mode={childModal}
        subject={subject}
        session={session}
        dayState={dayState}
        startSession={startSession}
        switchSession={switchSession}
        onClose={() => setChildModal(null)}
        onComplete={async () => {
          await finishAction(childModal === 'switch' ? 'Work context switched' : state.has_work_today ? 'Work day reopened' : 'Work started');
        }}
      />
    );
  }

  if (childModal === 'end') {
    return (
      <WorkEndDayModal
        subject={subject}
        dayState={dayState}
        endDay={endDay}
        onClose={() => setChildModal(null)}
        onComplete={async () => finishAction('Work day ended')}
      />
    );
  }

  return createPortal(
    <div className="work-start-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pendingAction) onClose();
    }}>
      <section
        ref={dialogRef}
        className="work-start-modal admin-work-control-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-work-control-title"
        tabIndex="-1"
      >
        <div className="work-start-header">
          <div>
            <span className="work-start-eyebrow">Act on behalf of employee</span>
            <h2 id="admin-work-control-title">{employee.employee_name}</h2>
            <p>Choose the same live work action available on the employee’s own timer.</p>
          </div>
          <button type="button" className="work-start-close" onClick={onClose} disabled={Boolean(pendingAction)} aria-label="Close employee work controls">
            <i className="ri-close-line" aria-hidden="true" />
          </button>
        </div>

        <div className="admin-work-control-body">
          {loading ? (
            <div className="live-status-empty">Loading current status…</div>
          ) : state ? (
            <>
              <div className="admin-work-control-summary">
                <span className={`live-status-pill ${state.work_status.toLowerCase()}`}>{state.work_status}</span>
                <div>
                  <strong>{state.context_label || 'Not working'}</strong>
                  <span>{state.work_mode === 'wfh' ? 'Working from home' : state.has_work_today ? 'Office workday' : 'No work recorded today'}</span>
                </div>
              </div>
              <div className="admin-work-control-actions">
                {state.work_status === 'Out' && (
                  <button type="button" className="work-timer-action" onClick={() => setChildModal('start')}>
                    <i className={state.has_work_today ? 'ri-restart-line' : 'ri-play-fill'} aria-hidden="true" />
                    {state.has_work_today ? 'Reopen day' : 'Start work'}
                  </button>
                )}
                {state.work_status === 'In' && (
                  <>
                    <button type="button" className="work-timer-action work-timer-action--secondary" onClick={() => runImmediateAction('break')} disabled={Boolean(pendingAction)}>
                      <i className="ri-pause-circle-line" aria-hidden="true" />
                      {pendingAction === 'break' ? 'Starting…' : 'Start break'}
                    </button>
                    <button type="button" className="work-timer-action" onClick={() => setChildModal('switch')} disabled={Boolean(pendingAction)}>
                      <i className="ri-swap-line" aria-hidden="true" />
                      Switch
                    </button>
                    <button type="button" className="work-timer-action work-timer-action--danger" onClick={() => setChildModal('end')} disabled={Boolean(pendingAction)}>
                      <i className="ri-stop-circle-line" aria-hidden="true" />
                      End Day
                    </button>
                  </>
                )}
                {state.work_status === 'Break' && (
                  <button type="button" className="work-timer-action" onClick={() => runImmediateAction('resume')} disabled={Boolean(pendingAction)}>
                    <i className="ri-play-circle-line" aria-hidden="true" />
                    {pendingAction === 'resume' ? 'Resuming…' : 'Resume work'}
                  </button>
                )}
              </div>
            </>
          ) : !error ? (
            <div className="live-status-empty">This employee is no longer active.</div>
          ) : null}
          {error && <div className="work-start-error" role="alert">{error}</div>}
          {confirmation && <div className="work-timer-confirmation" role="status">{confirmation}</div>}
        </div>
      </section>
    </div>,
    document.body,
  );
};

export default AdminWorkControlModal;
