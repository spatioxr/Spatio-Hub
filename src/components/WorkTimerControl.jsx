import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkSessionContext } from '../context/WorkSessionContext';
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

const WorkTimerControl = () => {
  const navigate = useNavigate();
  const [modalMode, setModalMode] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const {
    status,
    elapsedSeconds,
    contextLabel,
    taskDescription,
    loading,
    error,
  } = useContext(WorkSessionContext);

  const statusLabel = loading ? 'Restoring' : error || STATUS_LABELS[status];
  const isOut = status === 'out';
  const isWorking = status === 'working';

  useEffect(() => {
    if (!confirmation) return undefined;
    const timerId = window.setTimeout(() => setConfirmation(''), 4000);
    return () => window.clearTimeout(timerId);
  }, [confirmation]);

  return (
    <section className="work-timer" aria-label="Current work status">
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
      <button
        type="button"
        className="work-timer-action"
        onClick={() => {
          if (isOut) {
            setModalMode('start');
          } else if (isWorking) {
            setModalMode('switch');
          } else {
            navigate('/attendance');
          }
        }}
        disabled={loading}
      >
        <i
          className={isOut ? 'ri-play-fill' : isWorking ? 'ri-swap-line' : 'ri-arrow-right-line'}
          aria-hidden="true"
        />
        <span>{isOut ? 'Start work' : isWorking ? 'Switch' : 'View work'}</span>
      </button>
      {modalMode && (
        <WorkStartModal
          mode={modalMode}
          onClose={() => setModalMode(null)}
          onComplete={(label) => {
            if (modalMode === 'switch') setConfirmation(`Switched to ${label}`);
          }}
        />
      )}
      {confirmation && (
        <div className="work-timer-confirmation" role="status">
          <i className="ri-checkbox-circle-fill" aria-hidden="true" />
          {confirmation}
        </div>
      )}
    </section>
  );
};

export default WorkTimerControl;
