import React, { useId } from 'react';
import { workloadHours } from '../utils/workload';

// Keep tables numeric; disclose the allocation status on hover or keyboard focus.
export default function CostingAmount({ value, pendingReview, pendingTimer }) {
  const descriptionId = useId();
  const pending = pendingReview || pendingTimer;
  if (!pending) return <strong>{workloadHours(value)}</strong>;
  const reasons = [pendingReview && 'time awaiting review', pendingTimer && 'running timers'].filter(Boolean).join(' and ');
  const description = `${Number(value) > 0 ? 'Provisional allocation' : 'No allocation yet'}. Excludes ${reasons}.`;
  return (
    <span className={`costing-amount ${pendingReview ? 'costing-amount--review' : 'costing-amount--live'}`}
      tabIndex={0} aria-describedby={descriptionId}>
      <strong>{workloadHours(value)}</strong><span className="costing-amount-marker" aria-hidden="true">ⓘ</span>
      <span className="costing-amount-tooltip" role="tooltip" id={descriptionId}>{description}</span>
    </span>
  );
}
