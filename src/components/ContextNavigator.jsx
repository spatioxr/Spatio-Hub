import React from 'react';

const ContextNavigator = ({
  ariaLabel,
  previousLabel,
  nextLabel,
  positionLabel,
  onPrevious,
  onNext,
  previousDisabled = false,
  nextDisabled = false,
  disabled = false,
  compact = false,
}) => (
  <div
    className={`context-navigator${compact ? ' context-navigator--compact' : ''}`}
    role="group"
    aria-label={ariaLabel}
  >
    <button
      type="button"
      className="context-navigator-button"
      onClick={onPrevious}
      disabled={disabled || previousDisabled}
      aria-label={previousLabel}
      title={previousLabel}
    >
      <i className="ri-arrow-left-s-line" aria-hidden="true" />
    </button>
    {positionLabel && (
      <span className="context-navigator-position" aria-live="polite">
        {positionLabel}
      </span>
    )}
    <button
      type="button"
      className="context-navigator-button"
      onClick={onNext}
      disabled={disabled || nextDisabled}
      aria-label={nextLabel}
      title={nextLabel}
    >
      <i className="ri-arrow-right-s-line" aria-hidden="true" />
    </button>
  </div>
);

export default ContextNavigator;
