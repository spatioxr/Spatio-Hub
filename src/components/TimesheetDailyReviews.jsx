import React, { useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import AppState from './AppState';
import { formatAppDate, formatAppDateTime } from '../utils/timezone';
import { filterDailyReviews, reportSubmissionStatus } from '../utils/dailyReviews';

export default function TimesheetDailyReviews({
  scope, employeeId, department, startDate, endDate, selectedDate,
  refreshKey, onOpenDay,
}) {
  const [mode, setMode] = useState('day');
  const [result, setResult] = useState(null);
  const [retry, setRetry] = useState(0);
  const requestKey = JSON.stringify([scope, employeeId, startDate, endDate, retry]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = [];
        // Organisation months can exceed the API's default row limit.
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await supabase.rpc('scoped_daily_reviews', {
            requested_start_date: startDate,
            requested_end_date: endDate,
            requested_scope: scope,
            requested_employee_id: employeeId === 'all' ? null : employeeId,
          }).range(offset, offset + 499);
          if (cancelled) return;
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < 500) break;
        }
        setResult({ key: requestKey, refreshKey, rows });
      } catch (error) {
        if (!cancelled) setResult({ key: requestKey, refreshKey, error: error.message || 'Unable to load daily reports.' });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [requestKey, refreshKey, scope, employeeId, startDate, endDate]);

  const current = result?.key === requestKey && result.refreshKey === refreshKey ? result : null;
  const rows = filterDailyReviews(current?.rows || [], {
    employeeId, department, date: mode === 'day' ? selectedDate : null,
  });

  return (
    <section className="surface daily-reviews" aria-label="Daily plans and summaries">
      <div className="daily-reviews-heading">
        <div>
          <span className="page-eyebrow">Workday reports</span>
          <h3>Plans and summaries</h3>
          <p>{mode === 'day' ? formatAppDate(selectedDate) : `${formatAppDate(startDate)} – ${formatAppDate(endDate)}`}</p>
        </div>
        <div className="app-tabs" aria-label="Report review range">
          <button type="button" className={`app-tab${mode === 'day' ? ' active' : ''}`} aria-pressed={mode === 'day'} onClick={() => setMode('day')}>Selected day</button>
          <button type="button" className={`app-tab${mode === 'period' ? ' active' : ''}`} aria-pressed={mode === 'period'} onClick={() => setMode('period')}>Period review</button>
        </div>
      </div>
      <p className="daily-reviews-note">Whole-day reports follow the person and department filters. Project and activity filters apply to the task timeline below. Exemptions reflect current settings; pending means no report is recorded.</p>
      {!current ? <AppState type="loading" title="Loading daily reports" compact />
        : current.error ? <AppState type="error" title="Daily reports unavailable" message={current.error} action={<button type="button" className="btn btn-outline" onClick={() => setRetry((value) => value + 1)}>Try again</button>} compact />
          : rows.length === 0 ? <AppState type="empty" title="No recorded workdays" message="No work or reports were recorded for this selection. Days without records are not treated as missing submissions." compact />
            : <div className="daily-reviews-list">
              {rows.map((report) => (
                <article className="daily-review" key={`${report.employee_id}:${report.report_date}`}>
                  <header>
                    <div><strong>{report.employee_name}</strong><small>{report.employee_code} · {formatAppDate(report.report_date, { weekday: 'short' })}</small></div>
                    <button type="button" className="btn btn-outline" aria-label={`View tasks for ${report.employee_name} on ${formatAppDate(report.report_date)}`} onClick={() => { onOpenDay(report); setMode('day'); }}>View tasks</button>
                  </header>
                  <div className="daily-review-reports">
                    {['bos', 'eod'].map((kind) => (
                      <section key={kind}>
                        <h4>{kind === 'bos' ? 'Start-of-day plan' : 'End-of-day summary'}</h4>
                        <span className={`badge ${reportSubmissionStatus(report, kind) === 'Submitted' ? 'success' : ''}`}>{reportSubmissionStatus(report, kind)}</span>
                        <p>{report[`${kind}_report`] || 'No report submitted.'}</p>
                        {report[`${kind}_submitted_at`] && <time dateTime={report[`${kind}_submitted_at`]}>{formatAppDateTime(report[`${kind}_submitted_at`])} IST</time>}
                      </section>
                    ))}
                  </div>
                </article>
              ))}
            </div>}
    </section>
  );
}
