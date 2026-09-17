import SortableTable from '../components/SortableTable';
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import WorkloadProjects from '../components/WorkloadProjects';
import AppState from '../components/AppState';
import { AuthContext } from '../context/AuthContext';
import { WorkSessionContext } from '../context/WorkSessionContext';
import { supabase } from '../utils/supabaseClient';
import useDialogFocus from '../hooks/useDialogFocus';
import {
  addAppDays,
  appDateKey,
  appDateTimeInputToIso,
  formatAppDate,
  formatAppDateTime,
} from '../utils/timezone';
import {
  combineWorkload,
  projectPeople,
  reviewFlags,
  summarizeWorkload,
  timesheetReviewLink,
  WORKLOAD_FLAGS,
  workloadHours as hours,
  workloadMonths,
  workloadRange,
} from '../utils/workload';
import './Workload.css';

const TimesheetReviewDrawer = ({ url, onClose }) => {
  const focusRef = useDialogFocus(true, onClose);
  const [frameReady, setFrameReady] = useState(false);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
  return (
    <div className="drawer-backdrop workload-correction-backdrop">
      <section ref={focusRef} className="drawer workload-timesheet-drawer" role="dialog" aria-modal="true" aria-label="Review timesheet">
        <div className="workload-heading"><h2>Correct timesheet</h2><button className="btn btn-outline" onClick={onClose}>Done · return to review</button></div>
        <p>Save corrections in the timesheet, then return here. Your period and selected item stay in place.</p>
        {!frameReady && <p role="status">Opening the selected timesheet…</p>}
        <iframe onLoad={() => setFrameReady(true)} title="Timesheet correction" src={`${url}&workloadReview=1`} tabIndex={0} />
      </section>
    </div>
  );
};

const ReviewDialog = ({ review, onClose, onSaved }) => {
  const [reason, setReason] = useState('');
  const [actualEnd, setActualEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const ref = useDialogFocus(true, onClose, { closeDisabled: saving });
  const close = () => {
    if (!saving) onClose();
  };
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = review.entry
        ? await supabase.rpc('close_stale_work_entry', {
            target_entry: review.entry.id,
            actual_end: appDateTimeInputToIso(actualEnd),
            change_reason: reason.trim(),
          })
        : await supabase.rpc('confirm_workload_day', {
            target_employee: review.person.id,
            target_date: review.day.work_date,
            expected_fingerprint: review.day.fingerprint,
            review_reason: reason.trim(),
          });
      if (result.error) throw result.error;
      onSaved();
    } catch (failure) {
      setError(failure.message || 'Unable to save the review.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      className="drawer-backdrop"
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      <aside
        className="drawer workload-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workload-review-title"
        ref={ref}
        tabIndex={-1}
      >
        <div className="workload-heading">
          <h2 id="workload-review-title">
            {review.entry ? 'Resolve open timer' : 'Confirm recorded hours'}
          </h2>
          <button className="btn btn-outline" onClick={close} disabled={saving}>
            Close
          </button>
        </div>
        <p>
          {review.person.name} · {formatAppDate(review.day.work_date)}
        </p>
        <p>
          {review.entry
            ? `Started ${formatAppDateTime(review.entry.started_at)}. Enter the actual end, in IST. The original record and reason remain in change history.`
            : 'Confirm that the recorded hours are correct, even if below eight hours. Unworked hours stay unallocated; confirmation does not increase costing hours. Changes to the entries require a fresh review.'}
        </p>
        {error && (
          <p role="alert" className="workload-error">
            {error}
          </p>
        )}
        <form onSubmit={submit}>
          {review.entry && (
            <label className="people-field">
              <span>Actual end (IST)</span>
              <input
                type="datetime-local"
                required
                value={actualEnd}
                onChange={(e) => setActualEnd(e.target.value)}
                disabled={saving}
              />
            </label>
          )}
          <label className="people-field">
            <span>
              {review.entry ? 'Correction reason' : 'Why these hours are valid'}
            </span>
            <textarea
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              rows={4}
            />
          </label>
          <button className="btn" disabled={saving || !reason.trim()}>
            {saving
              ? 'Saving…'
              : review.entry
                ? 'Save actual end'
                : 'Confirm recorded hours'}
          </button>
        </form>
      </aside>
    </div>
  );
};

const Workload = () => {
  const { user } = useContext(AuthContext);
  const canResolve = ['admin', 'superadmin'].includes(user?.role);
  const { refresh: refreshOwnWork } = useContext(WorkSessionContext);
  const [params, setParams] = useSearchParams();
  const today = appDateKey();
  const candidate = params.get('date');
  const parsedDate = new Date(`${candidate}T12:00:00Z`);
  const anchor =
    /^\d{4}-\d{2}-\d{2}$/.test(candidate || '') &&
    Number.isFinite(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === candidate
      ? candidate
      : today;
  const mode = params.get('mode') === 'month' ? 'month' : 'week';
  const tab = ['people', 'projects', 'review'].includes(params.get('tab'))
    ? params.get('tab')
    : params.get('project')
      ? 'projects'
      : 'people';
  const range = workloadRange(anchor, mode);
  const months = workloadMonths(range);
  const monthKey = months.join(',');
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState(null);
  const [correction, setCorrection] = useState(null);
  const [queueFilter, setQueueFilter] = useState('all');
  const request = useRef(0);
  const detailRef = useRef(null);
  const change = (updates) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(updates).forEach(([key, value]) =>
        value ? next.set(key, value) : next.delete(key),
      );
      return next;
    });
  const load = useCallback(async (quiet = false) => {
    const version = ++request.current;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const results = await Promise.all(
        monthKey
          .split(',')
          .map((month) =>
            supabase.rpc('workload_month', { requested_month: month }),
          ),
      );
      if (version !== request.current) return;
      const failure = results.find((result) => result.error);
      if (failure) throw failure.error;
      setSnapshots(results.map((result) => result.data));
    } catch (failure) {
      if (version === request.current) {
        setSnapshots([]);
        setError(failure.message || 'Unable to load workload.');
      }
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [monthKey, user?.id]);
  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) void load();
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [load]);
  const data = useMemo(
    () => combineWorkload(snapshots, range),
    [snapshots, range.start, range.end],
  );
  const person = data.people.find((item) => item.id === params.get('person'));
  useEffect(() => {
    if (person && !loading)
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [person?.id]);
  const project = data.projects.find(
    (item) => item.id === params.get('project'),
  );
  const people =
    project && tab === 'projects'
      ? projectPeople(project, data.people)
      : data.people;
  const sums = new Map(
    people.map((item) => [
      item.id,
      summarizeWorkload(item, tab === 'projects' ? project?.id : null),
    ]),
  );
  const issues = people.flatMap((item) =>
    item.days
      .filter((day) => reviewFlags(day).length)
      .map((day) => ({ person: item, day })),
  );
  const totals = [...sums.values()].reduce(
    (sum, item) => ({
      recorded: sum.recorded + item.recorded,
      costing: sum.costing + item.costing,
      issues: sum.issues + item.issues,
    }),
    { recorded: 0, costing: 0, issues: 0 },
  );
  const move = (direction) => {
    if (mode === 'week') change({ date: addAppDays(anchor, direction * 7) });
    else {
      const date = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + direction);
      change({ date: date.toISOString().slice(0, 10) });
    }
  };
  const issueActions = (item, day) => (
    <div className="workload-actions">
      {canResolve && item.can_open_timesheet !== false ? (
        <button
          className="btn btn-outline"
          onClick={() => setCorrection(timesheetReviewLink(item.id, day, user.role))}
        >
          Needs correction · open timesheet
        </button>
      ) : (
        <span>
          Only Admins can resolve these flags. Archived profiles may need restoring before correction.
        </span>
      )}
      {canResolve && (day.flags.includes('long_day') || (day.flags.includes('missing_time') && Number(day.recorded_seconds) > 0)) &&
        day.can_review &&
        !day.flags.some((flag) =>
          [
            'in_progress',
            'stale_session',
            'future_time',
            'work_on_leave',
          ].includes(flag),
        ) && (
          <button
            className="btn btn-outline"
            onClick={() => setReview({ person: item, day })}
          >
            Confirm correct
          </button>
        )}
      {day.review_entries
        ?.filter((entry) => canResolve && entry.can_close)
        .map((entry) => (
          <button
            className="btn btn-outline"
            key={entry.id}
            onClick={() => setReview({ person: item, day, entry })}
          >
            Resolve open timer
          </button>
        ))}
      {day.flags.includes('previous_day_open') &&
        !day.review_entries?.some((entry) => entry.can_close) && (
          <span>An Admin must resolve the open timer.</span>
        )}
      {!day.can_review && day.flags.includes('long_day') && (
        <span>Ask an Admin to review the complete day.</span>
      )}
    </div>
  );
  const peopleTable = (rows, projectId = null) => (
    <div className="workload-table-wrap">
      <SortableTable sortId="workloadPeople" className="workload-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Recorded hours{projectId ? ' · project' : ''}</th>
            <th>Costing hours</th>
            <th>Total workload</th>
            <th>Leave days</th>
            <th>Review</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const sum = summarizeWorkload(item, projectId);
            return (
              <tr key={item.id}>
                <td data-sort-value={item.name}>
                  <button
                    className="workload-text-button"
                    onClick={() => change({ person: item.id })}
                  >
                    {item.name}
                  </button>
                  <small>
                    {item.emp_code} · {item.department || 'No department'}
                    {item.status === 'Released' ? ' · Archived' : ''}
                  </small>
                </td>
                <td data-sort-value={sum.recorded}>{hours(sum.recorded)}</td>
                <td data-sort-value={sum.costing}>
                  <strong>{hours(sum.costing)}</strong>
                  <small>
                    {sum.needsReview
                      ? 'Needs review · provisional'
                      : 'Provisional'}
                  </small>
                </td>
                <td data-sort-value={sum.totalRecorded}>
                  {hours(sum.totalRecorded)}h
                  <small>
                    {sum.aboveEight > 0
                      ? `${hours(sum.aboveEight)}h above daily 8h baseline`
                      : 'Across projects + internal work'}
                  </small>
                </td>
                <td>{sum.leave}</td>
                <td data-sort-value={sum.issues}>
                  <button
                    className="workload-text-button"
                    onClick={() => change({ person: item.id })}
                  >
                    {sum.issues ? `${sum.issues} flagged days` : 'View days'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </SortableTable>
      {!rows.length && <p>No people in this scope.</p>}
    </div>
  );

  return (
    <Layout
      title="Workload & Costing"
      eyebrow="Workload & costing"
      heading="People, projects & time"
      description="Review weekly workload and provisional allocations before taking figures to your scorecard."

    >

      <section className="card workload-toolbar" aria-label="Workload period">
        <div className="workload-actions">
          <button
            className="btn btn-outline"
            onClick={() => move(-1)}
            aria-label="Previous period"
          >
            ←
          </button>
          <strong>
            {formatAppDate(range.start)} – {formatAppDate(range.end)}
          </strong>
          <button
            className="btn btn-outline"
            onClick={() => move(1)}
            aria-label="Next period"
          >
            →
          </button>
          <button
            className="btn btn-outline"
            onClick={() => change({ date: today })}
          >
            Today
          </button>
        </div>
        <div className="workload-actions">
          <label>
            View{' '}
            <select
              value={mode}
              onChange={(e) => change({ mode: e.target.value })}
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
          <label>
            Date{' '}
            <input
              type="date"
              value={anchor}
              onChange={(e) =>
                e.target.value && change({ date: e.target.value })
              }
            />
          </label>
          <button className="btn btn-outline" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
      </section>
      <nav className="workload-tabs" aria-label="Workload views">
        {[
          ['people', 'People'],
          ['projects', 'Projects'],
          ['review', 'Needs review'],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => change({ tab: key, person: null, project: null })}
          >
            {label}
          </button>
        ))}
      </nav>
      {notice && (
        <p role="status" className="workload-notice">
          {notice}
        </p>
      )}
      {loading ? (
        <AppState
          title="Loading workload…"
          description="Calculating the complete monthly allocation."
        />
      ) : error ? (
        <AppState
          title="Workload unavailable"
          description={error}
          action={
            <button className="btn btn-outline" onClick={load}>
              Try again
            </button>
          }
        />
      ) : params.get('project') && !project ? (
        <AppState
          title="Project unavailable"
          description="This project is outside your current access. Choose a project from your list."
          action={
            <button
              className="btn btn-outline"
              onClick={() => change({ project: null, person: null })}
            >
              All projects
            </button>
          }
        />
      ) : (
        <>
          <div className="workload-kpis">
            <div>
              <span>Recorded hours</span>
              <strong>{hours(totals.recorded)}</strong>
              <small>Includes unresolved and live time</small>
            </div>
            <div>
              <span>Costing hours · provisional</span>
              <strong>{hours(totals.costing)}</strong>
              <small>Questionable days reserve their allowance</small>
            </div>
            <div>
              <span>Days needing review</span>
              <strong>{totals.issues}</strong>
              <small>Across the people shown</small>
            </div>
          </div>
          <p className="workload-explanation">
            Costing uses the complete person-month across projects and internal
            work. Leave and unallocated time stay separate. Figures may change
            as records are completed or corrected.{' '}
            {snapshots
              .map(
                (snapshot) =>
                  `${formatAppDate(snapshot.month, { day: undefined })}: ${hours(snapshot.monthly_hours)}h per person`,
              )
              .join(' · ')}
            . Last loaded {formatAppDateTime(snapshots[0]?.generated_at)}.
          </p>
          {tab === 'projects' && (
            <section className="card workload-section">
              <div className="workload-heading">
                <h2>{project ? project.name : 'Projects'}</h2>
                {project && (
                  <button
                    className="btn btn-outline"
                    onClick={() => change({ project: null, person: null })}
                  >
                    All projects
                  </button>
                )}
              </div>
              {project ? (
                <>
                  <p>
                    {project.description ||
                      'Project workload and leave coverage.'}
                  </p>
                  <p>
                    Managers:{' '}
                    {(project.managers || [])
                      .map((manager) => manager.name)
                      .join(', ') || 'None'}{' '}
                    · {project.members?.length || 0} assigned members
                    {project.archived_at ? ' · Archived project' : ''}
                  </p>
                  {peopleTable(people, project.id)}
                  <div className="workload-leave">
                    <h3>Approved leave in this period</h3>
                    {people.flatMap((item) =>
                      item.days
                        .filter((day) => Number(day.leave_fraction) > 0)
                        .map((day) => (
                          <p key={`${item.id}:${day.work_date}`}>
                            <strong>{item.name}</strong> ·{' '}
                            {formatAppDate(day.work_date)} ·{' '}
                            {Number(day.leave_fraction) === 0.5
                              ? 'Half day'
                              : 'Full day'}
                          </p>
                        )),
                    )}
                    {!people.some((item) =>
                      item.days.some((day) => Number(day.leave_fraction) > 0),
                    ) && (
                      <p>
                        No approved leave in this period. Choose a future week
                        to check upcoming coverage.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <WorkloadProjects projects={data.projects} people={data.people} onSelect={(id) => change({ project: id, person: null })} />
              )}
            </section>
          )}
          {tab === 'people' && (
            <section className="card workload-section">
              <h2>People this {mode}</h2>
              {peopleTable(data.people)}
            </section>
          )}
          {tab === 'review' && (
            <section className="card workload-section">
              <h2>Days needing attention</h2>
              <p>Admins resolve these items. Above-eight-hour indicators and today’s running timers are informational and do not appear here. Corrected or confirmed issues leave this queue automatically.</p>
              <label>Show <select value={queueFilter} onChange={(event) => setQueueFilter(event.target.value)}>
                <option value="all">All pending issues</option>
                <option value="missing_time">Below expected / missing hours</option>
                <option value="long_day">Long days to confirm</option>
                <option value="invalid">Stale timers and conflicting records</option>
              </select></label>
              {issues.length ? (
                issues.filter(({ day }) => queueFilter === 'all' || (queueFilter === 'invalid' ? reviewFlags(day).some((flag) => !['missing_time', 'long_day'].includes(flag)) : day.flags.includes(queueFilter))).map(({ person: item, day }) => (
                  <article
                    className="workload-issue"
                    key={`${item.id}:${day.work_date}`}
                  >
                    <h3>
                      <button
                        className="workload-text-button"
                        onClick={() => change({ person: item.id })}
                      >
                        {item.name}
                      </button>{' '}
                      · {formatAppDate(day.work_date)}
                    </h3>
                    <p>
                      {reviewFlags(day)
                        .map((flag) => WORKLOAD_FLAGS[flag])
                        .join(' · ')}
                    </p>
                    <p>
                      {hours(Number(day.recorded_seconds) / 3600)} recorded
                      hours · {hours(day.costing_hours)} provisional costing
                      hours
                    </p>
                    {issueActions(item, day)}
                  </article>
                ))
              ) : (
                <p>No review flags in this period.</p>
              )}
              <details>
                <summary>Confirmed days in this period</summary>
                <p>Corrections retain their audit trail in the timesheet. A change to confirmed entries requires a fresh review.</p>
                {data.people.flatMap((item) => item.days.filter((day) => day.confirmed).map((day) => (
                  <p key={`${item.id}:${day.work_date}`}>{item.name} · {formatAppDate(day.work_date)} · Confirmed correct</p>
                )))}
              </details>
            </section>
          )}
          {person && (
            <section
              className="card workload-section"
              ref={detailRef}
              aria-label={`${person.name} detail`}
            >
              <div className="workload-heading">
                <h2>
                  {person.name} · {mode} detail
                </h2>
                <button
                  className="btn btn-outline"
                  onClick={() => change({ person: null })}
                >
                  Close detail
                </button>
              </div>
              <div className="workload-balances">
                {person.months.map((month) => (
                  <div key={month.month}>
                    <strong>
                      {formatAppDate(month.month, { day: undefined })} ·{' '}
                      {hours(month.monthly_hours)}h allowance
                    </strong>
                    <p>
                      {hours(month.allocated_hours)}h work allocation ·{' '}
                      {hours(month.leave_hours)}h leave ·{' '}
                      {hours(month.unallocated_hours)}h unallocated
                    </p>
                    <small>
                      Unallocated includes future days, missing time, open
                      timers and days awaiting review. It is not charged to
                      projects.
                    </small>
                  </div>
                ))}
              </div>
              <div className="workload-table-wrap">
                <SortableTable sortId="workloadContexts" className="workload-table">
                  <thead>
                    <tr>
                      <th>Project / internal activity</th>
                      <th>Recorded hours</th>
                      <th>Costing hours · provisional</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summarizeWorkload(person).contexts.map((context) => (
                      <tr key={context.context_id}>
                        <td>{context.label}</td>
                        <td data-sort-value={context.recorded}>{hours(context.recorded)}</td>
                        <td data-sort-value={context.costing}>{hours(context.costing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </SortableTable>
              </div>
              {person.days.map((day) => (
                <article key={day.work_date} className="workload-day">
                  <div className="workload-heading">
                    <h3>
                      {formatAppDate(day.work_date, { weekday: 'short' })}
                    </h3>
                    <span>
                      {hours(Number(day.recorded_seconds) / 3600)}h recorded ·{' '}
                      <strong>{hours(day.costing_hours)}h costing</strong>
                    </span>
                  </div>
                  <p>
                    {day.flags.map((flag) => (
                      <span
                        key={flag}
                        className={`workload-flag ${flag === 'above_eight' ? 'workload-flag--workload' : ''}`}
                      >
                        {WORKLOAD_FLAGS[flag]}
                      </span>
                    ))}
                    {day.confirmed && (
                      <span className="workload-flag workload-flag--confirmed">
                        Recorded hours confirmed
                      </span>
                    )}
                    {Number(day.leave_fraction) > 0 && (
                      <span className="workload-flag">
                        {Number(day.leave_fraction) === 0.5
                          ? 'Half-day leave'
                          : 'Full-day leave'}
                      </span>
                    )}
                    {!day.is_working_day && (
                      <span className="workload-flag">
                        Non-working / outside employment day
                      </span>
                    )}
                  </p>
                  {day.contexts.map((context) => (
                    <p key={context.context_id}>
                      {context.label} ·{' '}
                      {hours(Number(context.recorded_seconds) / 3600)}h recorded
                      · {hours(context.costing_hours)}h costing
                    </p>
                  ))}
                  {issueActions(person, day)}
                </article>
              ))}
            </section>
          )}

        </>
      )}
      <details className="card workload-section workload-guide">
        <summary>How costing hours work</summary>
        <p className="workload-guide-intro">Recorded hours show time worked. Costing hours show how the fixed monthly allowance is shared across projects and internal work.</p>
        <div className="workload-guide-steps">
          <section><h3>1. Start with the allowance</h3><p>The default is <strong>176 hours per person per month</strong>. Divide it by the company working days to find each day’s share.</p></section>
          <section><h3>2. Set aside leave and unworked time</h3><p>Approved leave has its own reserve. A valid eight-hour working day funds a full daily share; a four-hour day funds half. Confirming a short day keeps that same partial allocation.</p></section>
          <section><h3>3. Share the work allocation</h3><p>Distribute the funded monthly hours in proportion to eligible recorded time across <strong>all projects and internal activities together</strong>. Overtime changes this split, never the monthly allowance.</p></section>
        </div>
        <div className="workload-guide-example"><h3>Example: a 100-hour work allocation</h3><p>If eligible recorded time is 60% on a project and 40% on internal work, their costing allocations are <strong>60 hours and 40 hours</strong>.</p></div>
        <p><strong>Why weekly figures change:</strong> each week uses the complete month’s distribution. Later entries or corrections can change earlier weekly figures.</p>
        <p><strong>Why some hours are zero:</strong> days with open timers or unresolved invalid records do not fund costing. Leave, unworked time and future days stay separate from project costs.</p>
        <p>Select a person to see: <strong>work allocation + leave reserve + unallocated = monthly allowance.</strong></p>
      </details>
      {correction && (
        <TimesheetReviewDrawer url={correction} onClose={() => { setCorrection(null); void load(true); }} />
      )}
      {review && (
        <ReviewDialog
          key={`${review.person.id}:${review.day.work_date}:${review.entry?.id || ''}`}
          review={review}
          onClose={() => setReview(null)}
          onSaved={() => {
            if (review.entry && review.person.id === user.id)
              void refreshOwnWork();
            setReview(null);
            setNotice(
              'Saved with an audit record. Allocations are being refreshed.',
            );
            void load(true);
          }}
        />
      )}
    </Layout>
  );
};
export default Workload;
