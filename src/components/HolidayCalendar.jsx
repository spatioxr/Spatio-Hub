import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useDialogFocus from '../hooks/useDialogFocus';
import { appDateKey, formatAppDate } from '../utils/timezone';
import { calendarMonth, holidaysInPeriod, moveCalendarMonth } from '../utils/holidayCalendar';
import './HolidayCalendar.css';

const monthName = (year, month) => formatAppDate(`${year}-${String(month + 1).padStart(2, '0')}-01`, { day: undefined, month: 'long', year: undefined });

function HolidayExplorer({ holidays, onClose }) {
  useEffect(() => {
    const root = document.getElementById('root');
    const previousInert = root?.inert;
    const previousOverflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = 'hidden';
    return () => {
      if (root) root.inert = previousInert;
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  const dialogRef = useDialogFocus(true, onClose);
  const today = appDateKey();
  const [view, setView] = useState('month');
  const [period, setPeriod] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 }));
  const { year, month } = period;
  const visible = holidaysInPeriod(holidays, year, view === 'month' ? month : null);
  const months = view === 'month' ? [month] : Array.from({ length: 12 }, (_, i) => i);
  const byDate = new Map();
  visible.forEach((holiday) => byDate.set(holiday.date, [...(byDate.get(holiday.date) || []), holiday.name]));
  const move = (offset) => setPeriod(view === 'month' ? moveCalendarMonth(year, month, offset) : { year: year + offset, month });

  return createPortal(
    <div className="holiday-explorer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="holiday-calendar holiday-explorer" role="dialog" aria-modal="true" aria-labelledby="holiday-calendar-title" tabIndex={-1}>
      <div className="track-work-section-heading">
        <div><span className="page-eyebrow">Company calendar</span><h2 id="holiday-calendar-title">Explore holidays</h2></div>
        <button type="button" className="holiday-explorer-close" aria-label="Close holiday calendar" onClick={onClose}><i className="ri-close-line" aria-hidden="true" /></button>
      </div>
      <div className="holiday-explorer-toolbar">
        <div className="holiday-view-switch" role="group" aria-label="Holiday calendar view">
          {['month', 'year'].map((option) => <button key={option} type="button" aria-pressed={view === option} onClick={() => setView(option)}>{option === 'month' ? 'Month' : 'Year'}</button>)}
        </div>
      <div className="holiday-calendar-navigation">
        <button type="button" onClick={() => move(-1)} aria-label={`Previous ${view}`}><i className="ri-arrow-left-s-line" aria-hidden="true" /></button>
        <strong className={view === 'year' ? 'holiday-calendar-year-label' : undefined} aria-live="polite">{view === 'month' ? `${monthName(year, month)} ${year}` : year}</strong>
        <button type="button" onClick={() => move(1)} aria-label={`Next ${view}`}><i className="ri-arrow-right-s-line" aria-hidden="true" /></button>
        <button type="button" className="holiday-calendar-today-button" onClick={() => setPeriod({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 })}>Today</button>
      </div>
      </div>
      <div className="holiday-explorer-body">
      <div className={`holiday-calendar-months${view === 'year' ? ' holiday-calendar-months--year' : ''}`}>
        {months.map((item) => {
          const cells = calendarMonth(year, item);
          return (
          <div key={item} className="holiday-calendar-month">
            {view === 'year' && <button className="holiday-calendar-month-title" type="button" aria-label={`View ${monthName(year, item)} ${year} holidays`} onClick={() => { setPeriod({ year, month: item }); setView('month'); }}>{monthName(year, item)}</button>}
            <table aria-label={`${monthName(year, item)} ${year} holidays`}>
              <thead><tr>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day) => <th key={day} scope="col" abbr={day}>{day.slice(0, 1)}</th>)}</tr></thead>
              <tbody>{Array.from({ length: Math.ceil(cells.length / 7) }, (_, week) => (
                <tr key={week}>{Array.from({ length: 7 }, (_, day) => {
                  const date = cells[week * 7 + day];
                  const names = byDate.get(date);
                  return <td key={day}>{date && <span className={`${names ? 'holiday-calendar-date--holiday' : ''} ${date === today ? 'holiday-calendar-date--today' : ''}`} aria-current={date === today ? 'date' : undefined} aria-label={`${formatAppDate(date)}${names ? `: ${names.join(', ')}` : ''}`} title={names?.join(', ')}>{Number(date.slice(-2))}{names && <i aria-hidden="true" />}</span>}</td>;
                })}</tr>
              ))}</tbody>
            </table>
          </div>
        ); })}
      </div>
      <aside className="holiday-explorer-list" aria-label="Holiday list">
      <p className="holiday-calendar-legend"><span aria-hidden="true">●</span> Company holiday · {visible.length} this {view}</p>
      {visible.length ? (
        <ol className="leave-holiday-list holiday-calendar-list" aria-label={`All holidays in ${view === 'month' ? monthName(year, month) + ' ' : ''}${year}`}>
          {visible.map((holiday) => <li key={holiday.id}>
            <time dateTime={holiday.date}><strong>{Number(holiday.date.slice(-2))}</strong><span>{formatAppDate(holiday.date, { day: undefined, month: 'short', year: undefined })}</span></time>
            <div><strong>{holiday.name}</strong><span>{formatAppDate(holiday.date, { weekday: 'long', day: undefined, month: undefined, year: undefined })}</span></div>
          </li>)}
        </ol>
      ) : <p className="holiday-calendar-empty">No company holidays scheduled this {view}.</p>}
      </aside>
      </div>
    </section>
    </div>,
    document.body,
  );
}

export default function HolidayCalendar({ holidays }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const closeExplorer = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const upcoming = [...holidays].filter((holiday) => holiday.date >= appDateKey())
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  return (
    <>
      <section className="card leave-holiday-card holiday-preview" aria-labelledby="holiday-preview-title">
        <div className="track-work-section-heading"><div><span className="page-eyebrow">Company calendar</span><h2 id="holiday-preview-title">Upcoming holidays</h2></div></div>
        {upcoming.length ? <ol className="leave-holiday-list">{upcoming.map((holiday) => (
          <li key={holiday.id}>
            <time dateTime={holiday.date}><strong>{Number(holiday.date.slice(-2))}</strong><span>{formatAppDate(holiday.date, { day: undefined, month: 'short', year: undefined })}</span></time>
            <div><strong>{holiday.name}</strong><span>{formatAppDate(holiday.date, { weekday: 'short', month: 'short' })}</span></div>
          </li>
        ))}</ol> : <p className="holiday-calendar-empty">No upcoming company holidays.</p>}
        <button type="button" ref={triggerRef} className="btn btn-outline holiday-explore-button" aria-haspopup="dialog" onClick={() => setOpen(true)}><i className="ri-calendar-line" aria-hidden="true" /> Explore holidays</button>
      </section>
      {open && <HolidayExplorer holidays={holidays} onClose={closeExplorer} />}
    </>
  );
}
