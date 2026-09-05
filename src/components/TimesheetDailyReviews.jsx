import React, { useEffect } from 'react';
import AppState from './AppState';
import useDialogFocus from '../hooks/useDialogFocus';
import { formatAppDate, formatAppDateTime } from '../utils/timezone';
import { reportSubmissionStatus } from '../utils/dailyReviews';
import { ReportText } from './TimesheetReportEvent';

export default function TimesheetDailyReviews({ open, onClose, current, rows, retry, startDate, endDate, onOpenDay }) {
  const dialogRef = useDialogFocus(open, onClose);
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="timesheet-editor-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="timesheet-editor daily-review-drawer" role="dialog" aria-modal="true" aria-labelledby="period-review-title" ref={dialogRef} tabIndex={-1}>
        <header className="timesheet-editor-header">
          <div><h2 id="period-review-title">Period review</h2><p>{formatAppDate(startDate)} – {formatAppDate(endDate)}</p></div>
          <button type="button" className="timesheet-editor-close" aria-label="Close period review" onClick={onClose}><i className="ri-close-line" aria-hidden="true" /></button>
        </header>
        <div className="daily-review-drawer-body">
          <p className="daily-reviews-note">Daily plans and summaries for the selected people and department. Project and activity filters apply only to tasks. Exemptions reflect current settings.</p>
          {!current ? <AppState type="loading" title="Loading daily reports" compact />
            : current.error ? <AppState type="error" title="Daily reports unavailable" message={current.error} action={<button type="button" className="btn btn-outline" onClick={retry}>Try again</button>} compact />
              : rows.length === 0 ? <AppState type="empty" title="No recorded workdays" message="No work or reports were recorded for this selection." compact />
                : <div className="daily-reviews-list">
                  {rows.map((report) => (
                    <article className="daily-review" key={`${report.employee_id}:${report.report_date}`}>
                      <header>
                        <div><strong>{report.employee_name}</strong><small>{report.employee_code} · {formatAppDate(report.report_date, { weekday: 'short' })}</small></div>
                        <button type="button" className="btn btn-outline" aria-label={`View day for ${report.employee_name} on ${formatAppDate(report.report_date)}`} onClick={() => { onClose(); onOpenDay(report); }}>View day</button>
                      </header>
                      <div className="daily-review-reports">
                        {['bos', 'eod'].map((kind) => (
                          <section key={kind}>
                            <h4>{kind === 'bos' ? 'Start-of-day plan' : 'End-of-day summary'}</h4>
                            <span className={`badge ${reportSubmissionStatus(report, kind) === 'Submitted' ? 'success' : ''}`}>{reportSubmissionStatus(report, kind)}</span>
                            <ReportText text={report[`${kind}_report`] || 'No report submitted.'} />
                            {report[`${kind}_submitted_at`] && <time dateTime={report[`${kind}_submitted_at`]}>{formatAppDateTime(report[`${kind}_submitted_at`])} IST</time>}
                          </section>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>}
        </div>
      </aside>
    </div>
  );
}
