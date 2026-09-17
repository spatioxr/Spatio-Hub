import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import useDialogFocus from '../hooks/useDialogFocus';
import { addAppDays, formatAppDate } from '../utils/timezone';
import { monthShift, periodRange } from '../utils/analyticsPeriods';
import { validAnalyticsRange } from '../utils/analyticsNavigation';

function RangeDialog({ range, today, mode, onApply, onClose, onAllTime }) {
  useEffect(() => {
    const root = document.getElementById('root');
    const previousInert = root?.inert;
    const overflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = 'hidden';
    return () => { if (root) root.inert = previousInert; document.body.style.overflow = overflow; };
  }, []);
  const ref = useDialogFocus(true, onClose);
  const [draft, setDraft] = useState(range);
  const [month, setMonth] = useState(range.start.slice(0, 7) + '-01');
  const [selectEnd, setSelectEnd] = useState(false);
  const [error, setError] = useState('');
  const pick = (date) => {
    if (mode !== 'custom') { onApply(periodRange(mode, date, today), mode); return; }
    if (!selectEnd || date < draft.start) { setDraft({ start: date, end: date }); setSelectEnd(true); }
    else { setDraft({ ...draft, end: date }); setSelectEnd(false); }
  };
  const preset = (start) => { setDraft({ start, end: today }); setMonth(start.slice(0, 7) + '-01'); setSelectEnd(false); };
  return createPortal(<div className="analytics-date-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="analytics-date-title" className="analytics-date-dialog" tabIndex={-1}>
      <header><h2 id="analytics-date-title">{mode === 'custom' ? 'Choose date range' : `Choose ${mode}`}</h2><button type="button" className="btn btn-outline" aria-label="Close date picker" onClick={onClose}>×</button></header>
      {mode === 'custom' && <div className="analytics-date-presets">
        <button type="button" onClick={() => preset(addAppDays(today, -29))}>Last 30 days</button>
        <button type="button" onClick={() => preset(addAppDays(today, -89))}>Last 90 days</button>
        <button type="button" onClick={() => preset(`${today.slice(0, 4)}-01-01`)}>This year</button>
        <button type="button" onClick={async () => { try { const start = await onAllTime(); preset(start); } catch { setError('Unable to find the first reporting date. Choose dates below.'); } }}>All time</button>
      </div>}
      <div className="analytics-calendar-nav"><button type="button" className="btn btn-outline" aria-label="Previous calendar month" onClick={() => setMonth(monthShift(month, -1))}>‹</button>
        <label>Jump to month <input type="month" value={month.slice(0, 7)} max={today.slice(0, 7)} onChange={(e) => { if (e.target.value) setMonth(`${e.target.value}-01`); }} /></label>
        <button type="button" className="btn btn-outline" aria-label="Next calendar month" disabled={month.slice(0, 7) >= today.slice(0, 7)} onClick={() => setMonth(monthShift(month, 1))}>›</button></div>
      {mode === 'month' ? <div className="analytics-month-grid">{Array.from({ length: 12 }, (_, index) => {
        const date = `${month.slice(0, 4)}-${String(index + 1).padStart(2, '0')}-01`;
        return <button type="button" key={date} disabled={date > today} aria-pressed={date.slice(0, 7) === range.start.slice(0, 7)} onClick={() => pick(date)}>{formatAppDate(date, { day: undefined, year: undefined, month: 'short' })}</button>;
      })}</div> : <div className="analytics-calendars">{[month, monthShift(month, 1)].map((start, index) => {
        const firstDay = (new Date(`${start}T12:00:00Z`).getUTCDay() + 6) % 7;
        const days = new Date(`${monthShift(start, 1)}T12:00:00Z`); days.setUTCDate(0);
        return <div className={`analytics-calendar analytics-calendar--${index}`} key={start}><h3>{formatAppDate(start, { day: undefined, month: 'long' })}</h3><div className="analytics-calendar-grid">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => <span key={`label-${i}`}>{label}</span>)}
          {Array.from({ length: firstDay }, (_, i) => <span key={`empty-${i}`} />)}
          {Array.from({ length: days.getUTCDate() }, (_, i) => { const date = addAppDays(start, i); return <button type="button" key={date} disabled={date > today} aria-label={formatAppDate(date)} aria-pressed={date >= draft.start && date <= draft.end} onClick={() => pick(date)}>{i + 1}</button>; })}
        </div></div>;
      })}</div>}
      {mode === 'custom' ? <form onSubmit={(e) => { e.preventDefault(); if (!validAnalyticsRange(draft.start, draft.end, today)) setError('Choose valid dates, with the end on or after the start and no later than today.'); else onApply(draft, 'custom'); }}>
        <div className="analytics-custom-fields"><label>From<input type="date" required max={today} value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} /></label><label>To<input type="date" required min={draft.start} max={today} value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} /></label></div>
        <p className="analytics-date-hint">{selectEnd ? 'Select an end date.' : 'Select a start date, then an end date. Any historical range is supported.'}</p>
        {error && <p role="alert">{error}</p>}<footer><button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button><button type="submit" className="btn">Apply</button></footer>
      </form> : <p className="analytics-date-hint">{mode === 'week' ? 'Select any day to view its Monday–Sunday week.' : 'Select a month. Use Jump to month to change the year.'}</p>}
    </section>
  </div>, document.body);
}

export default function AnalyticsPeriodPicker({ range, mode, today, onChange, loading, onAllTime }) {
  const [picker, setPicker] = useState(null);
  const anchor = mode === 'month' ? monthShift(range.start, 1) : addAppDays(range.start, 7);
  const changeMode = (next) => {
    if (next === 'custom') setPicker('custom');
    else onChange(periodRange(next, range.end, today), next);
  };
  const label = mode === 'month' ? formatAppDate(range.start, { day: undefined, month: 'long' })
    : `${formatAppDate(range.start)} – ${formatAppDate(mode === 'week' ? addAppDays(range.start, 6) : range.end)}`;
  return <section className="card analytics-period-toolbar" aria-label="Reporting period">
    <div className="analytics-period-modes" role="group" aria-label="Period type">{['week', 'month', 'custom'].map((item) => <button key={item} type="button" aria-pressed={mode === item} onClick={() => changeMode(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
    <div className="analytics-period-navigation">
      {mode !== 'custom' && <button type="button" className="btn btn-outline" aria-label={`Previous ${mode}`} onClick={() => onChange(periodRange(mode, mode === 'month' ? monthShift(range.start, -1) : addAppDays(range.start, -7), today), mode)}>‹</button>}
      <button type="button" className="analytics-period-label" onClick={() => setPicker(mode)}>{label}<i className="ri-calendar-line" aria-hidden="true" /></button>
      {mode !== 'custom' && <><button type="button" className="btn btn-outline" aria-label={`Next ${mode}`} disabled={anchor > today} onClick={() => onChange(periodRange(mode, anchor, today), mode)}>›</button><button type="button" className="analytics-period-current" onClick={() => onChange(periodRange(mode, today, today), mode)}>This {mode}</button></>}
    </div>
    <span className="analytics-period-status" role="status">{loading ? 'Loading results…' : range.end === today ? 'Data through today · IST' : 'IST reporting dates'}</span>
    {picker && <RangeDialog range={range} mode={picker} today={today} onClose={() => setPicker(null)} onAllTime={onAllTime} onApply={(next, nextMode) => { onChange(next, nextMode); setPicker(null); }} />}
  </section>;
}
