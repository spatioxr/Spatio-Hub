import React, { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { WorkSessionContext } from '../context/WorkSessionContext';
import useDialogFocus from '../hooks/useDialogFocus';

const WorkEndDayModal = ({ onClose, onComplete }) => {
  const { dayState, endDay } = useContext(WorkSessionContext);
  const [eodReport, setEodReport] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const needsEod = dayState.eodRequired && !dayState.eodSubmitted;
  const canSubmit = (!needsEod || Boolean(eodReport.trim())) && !submitting;
  const dialogRef = useDialogFocus(true, onClose, { closeDisabled: submitting });

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError('');

    try {
      await endDay({ eodReport: needsEod ? eodReport.trim() : null });
      onComplete?.();
      onClose();
    } catch (submitError) {
      console.error('Unable to end the work day:', submitError.message);
      setError(submitError.message || 'Unable to end the work day. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="work-start-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="work-start-modal work-end-day-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="work-end-day-title"
        tabIndex="-1"
      >
        <div className="work-start-header">
          <div>
            <span className="work-start-eyebrow">Final clock-out</span>
            <h2 id="work-end-day-title">End your work day?</h2>
            <p>
              {needsEod
                ? 'Submit today’s final summary to close your active session.'
                : 'Your profile is exempt from a required end-of-day summary.'}
            </p>
          </div>
          <button
            type="button"
            className="work-start-close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close End Day"
          >
            <i className="ri-close-line" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {needsEod && (
            <label className="work-start-task">
              <span className="work-start-label">
                End-of-day summary <b aria-hidden="true">*</b>
              </span>
              <textarea
                value={eodReport}
                onChange={(event) => {
                  setEodReport(event.target.value);
                  setError('');
                }}
                placeholder="What did you complete today?"
                rows="5"
                required
                autoFocus
              />
              <small>This report is submitted once for the entire work day.</small>
            </label>
          )}

          {error && <div className="work-start-error" role="alert">{error}</div>}

          <div className="work-start-footer">
            <span>You can cancel and continue working.</span>
            <button
              type="submit"
              className="work-start-submit work-end-day-submit"
              disabled={!canSubmit}
            >
              <i className="ri-stop-circle-line" aria-hidden="true" />
              {submitting ? 'Ending…' : 'End Day'}
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
};

export default WorkEndDayModal;
