import React, { useContext, useState } from 'react';
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
  const [startModalOpen, setStartModalOpen] = useState(false);
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
            setStartModalOpen(true);
          } else {
            navigate('/attendance');
          }
        }}
        disabled={loading}
      >
        <i className={isOut ? 'ri-play-fill' : 'ri-arrow-right-line'} aria-hidden="true" />
        <span>{isOut ? 'Start work' : 'View work'}</span>
      </button>
      {startModalOpen && <WorkStartModal onClose={() => setStartModalOpen(false)} />}
    </section>
  );
};

export default WorkTimerControl;
