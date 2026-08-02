import React, { useContext, useEffect, useState } from 'react';
import { WorkSessionContext } from '../context/WorkSessionContext';
import WorkEndDayModal from './WorkEndDayModal';
import WorkStartModal from './WorkStartModal';

const STATUS_LABELS = {
  out: 'Out',
  working: 'Working',
  break: 'Break',
};

const formatElapsed = (totalSeconds) => {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
};

const WorkTimerControl = ({ variant = 'compact' }) => {
  const [modalMode, setModalMode] = useState(null);
  const [endDayOpen, setEndDayOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [actionError, setActionError] = useState('');
  const [breakActionPending, setBreakActionPending] = useState(false);
  const {
    status,
    elapsedSeconds,
    contextLabel,
    taskDescription,
    loading,
    error,
    startBreak,
    resumeSession,
  } = useContext(WorkSessionContext);

  const statusLabel = loading ? 'Restoring' : error || STATUS_LABELS[status];
  const isOut = status === 'out';
  const isWorking = status === 'working';
  const isOnBreak = status === 'break';

  useEffect(() => {
    if (!confirmation) return undefined;
    const timerId = window.setTimeout(() => setConfirmation(''), 4000);
    return () => window.clearTimeout(timerId);
  }, [confirmation]);

  const handleBreakAction = async () => {
    setBreakActionPending(true);
    setActionError('');

    try {
      if (isOnBreak) {
        await resumeSession();
        setConfirmation('Work resumed');
      } else {
        await startBreak();
        setConfirmation('Break started');
      }
    } catch (breakError) {
      console.error(
        isOnBreak ? 'Unable to resume work:' : 'Unable to start break:',
        breakError.message,
      );
      setActionError(
        breakError.message
        || `Unable to ${isOnBreak ? 'resume work' : 'start break'}. Please try again.`,
      );
    } finally {
      setBreakActionPending(false);
    }
  };

  return (
    <section className={`work-timer work-timer--${variant}`} aria-label="Current work status">
      <div className="work-timer-summary">
        <div className="work-timer-state-row">
          <span className={`work-timer-dot work-timer-dot--${status}`} aria-hidden="true" />
          <span className="work-timer-state">{statusLabel}</span>
          <time className="work-timer-elapsed">{formatElapsed(elapsedSeconds)}</time>
        </div>
        <div
          className="work-timer-context"
          title={taskDescription ? `${contextLabel} — ${taskDescription}` : contextLabel}
        >
          {contextLabel}
        </div>
      </div>
      <div className="work-timer-actions">
        {isWorking && (
          <button
            type="button"
            className="work-timer-action work-timer-action--secondary"
            onClick={handleBreakAction}
            disabled={loading || breakActionPending}
            aria-label={breakActionPending ? 'Starting break' : 'Start break'}
          >
            <i className="ri-pause-circle-line" aria-hidden="true" />
            <span>{breakActionPending ? 'Starting…' : 'Start break'}</span>
          </button>
        )}
        <button
          type="button"
          className="work-timer-action"
          onClick={() => {
            setActionError('');
            if (isOut) {
              setModalMode('start');
            } else if (isWorking) {
              setModalMode('switch');
            } else {
              handleBreakAction();
            }
          }}
          disabled={loading || breakActionPending}
          aria-label={
            isOut
              ? 'Start work'
              : isWorking
                ? 'Switch work context'
                : breakActionPending ? 'Resuming work' : 'Resume work'
          }
        >
          <i
            className={isOut ? 'ri-play-fill' : isWorking ? 'ri-swap-line' : 'ri-play-circle-line'}
            aria-hidden="true"
          />
          <span>
            {isOut
              ? 'Start work'
              : isWorking
                ? 'Switch'
                : breakActionPending ? 'Resuming…' : 'Resume'}
          </span>
        </button>
        {isWorking && (
          <button
            type="button"
            className="work-timer-action work-timer-action--danger"
            onClick={() => {
              setActionError('');
              setEndDayOpen(true);
            }}
            disabled={loading || breakActionPending}
            aria-label="End work day"
          >
            <i className="ri-stop-circle-line" aria-hidden="true" />
            <span>End Day</span>
          </button>
        )}
      </div>
      {modalMode && (
        <WorkStartModal
          mode={modalMode}
          onClose={() => setModalMode(null)}
          onComplete={(label) => {
            if (modalMode === 'switch') setConfirmation(`Switched to ${label}`);
          }}
        />
      )}
      {endDayOpen && (
        <WorkEndDayModal
          onClose={() => setEndDayOpen(false)}
          onComplete={() => setConfirmation('Work day ended')}
        />
      )}
      {confirmation && (
        <div className="work-timer-confirmation" role="status">
          <i className="ri-checkbox-circle-fill" aria-hidden="true" />
          {confirmation}
        </div>
      )}
      {actionError && (
        <div className="work-timer-confirmation work-timer-confirmation--error" role="alert">
          <i className="ri-error-warning-fill" aria-hidden="true" />
          {actionError}
        </div>
      )}
    </section>
  );
};

export default WorkTimerControl;
