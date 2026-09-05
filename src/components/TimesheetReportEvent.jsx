import React, { useState } from 'react';
import { formatAppClock, formatAppDateTime } from '../utils/timezone';

export function ReportText({ text }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 240 || text.split('\n').length > 3;
  const preview = text.slice(0, 240).split('\n').slice(0, 3).join('\n');
  return <>
    <p className="timesheet-report-text">{long && !expanded ? `${preview}…` : text}</p>
    {long && <button type="button" className="timesheet-edit-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Show more'}</button>}
  </>;
}

export default function TimesheetReportEvent({ event, shared, formatDuration }) {
  const isBreak = event.type === 'break';
  const person = isBreak ? event.entry : event.report;
  const label = isBreak ? 'Break' : event.type === 'bos' ? 'Start-of-day plan' : 'End-of-day summary';
  return (
    <li className={`timesheet-session timesheet-session--${isBreak ? 'break' : 'report'}`}>
      <span className="timesheet-context-icon"><i aria-hidden="true" className={isBreak ? 'ri-cup-line' : event.type === 'bos' ? 'ri-sun-line' : 'ri-moon-line'} /></span>
      <div className="timesheet-session-body">
        <div className="timesheet-session-heading">
          <div>
            {shared && <span className="timesheet-person">{person.employee_name} · {person.employee_code}</span>}
            <span className="timesheet-context-type">{isBreak ? 'Break' : 'Workday report'}</span>
            <h4>{label}</h4>
          </div>
          {isBreak && <span className="timesheet-session-duration">{formatDuration(event.pause.duration_seconds)}</span>}
        </div>
        <div className="timesheet-session-meta">
          {isBreak ? <span>{formatAppClock(event.at)} – {formatAppClock(event.pause.ended_at)}</span>
            : <span>{event.at ? <time dateTime={event.at}>Submitted {formatAppDateTime(event.at)} IST</time> : 'Submission time not recorded'}</span>}
        </div>
        {!isBreak && <ReportText text={event.report[`${event.type}_report`]} />}
      </div>
    </li>
  );
}
