import { workloadCache } from '../utils/workloadCache';
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
import CostingAmount from '../components/CostingAmount';
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
  costingLabel,
  costingPending,
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

const EMPTY_SNAPSHOTS = [];

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
      const result = await supabase.rpc('close_stale_work_entry', {
        target_entry: review.entry.id,
        actual_end: appDateTimeInputToIso(actualEnd),
        change_reason: reason.trim(),
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
            Resolve open timer
          </h2>
          <button className="btn btn-outline" onClick={close} disabled={saving}>
            Close
          </button>
        </div>
        <p>
          {review.person.name} · {formatAppDate(review.day.work_date)}
        </p>
        <p>
          {`Started ${formatAppDateTime(review.entry.started_at)}. Enter the actual end, in IST. The original record and reason remain in change history.`}
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
              Correction reason
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
            {saving ? 'Saving…' : 'Save actual end'}
          </button>
        </form>
      </aside>
    </div>
  );
};

const ConfirmDayButton = ({ person, day, onSaved }) => {
  const [stage, setStage] = useState('idle');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const confirm = async () => {
    if (inFlight.current || stage === 'confirmed') return;
    if (stage !== 'armed') { setStage('armed'); setError(''); return; }
    inFlight.current = true;
    setStage('saving');
    try {
      const result = await supabase.rpc('confirm_workload_day', {
        target_employee: person.id,
        target_date: day.work_date,
        expected_fingerprint: day.fingerprint,
        review_reason: 'Recorded hours confirmed as correct.',
      });
      if (result.error) throw result.error;
      setStage('confirmed');
      onSaved();
    } catch (failure) {
      setStage('idle');
      setError(failure.message || 'Could not confirm. Please try again.');
    } finally {
      inFlight.current = false;
    }
  };
  return (
    <div className="workload-inline-confirm">
      <button type="button" className={`btn workload-confirm-button${stage === 'armed' ? ' workload-confirm-armed' : ''}`}
        disabled={stage === 'saving' || stage === 'confirmed'}
        onClick={confirm}
        onBlur={() => { if (stage === 'armed') setStage('idle'); }}
        onKeyDown={(event) => { if (event.key === 'Escape') setStage('idle'); }}
        aria-label={`${stage === 'armed' ? 'Confirm these hours' : stage === 'confirmed' ? 'Confirmed' : 'Confirm correct'} for ${person.name} on ${formatAppDate(day.work_date)}`}>
        {stage === 'saving' ? 'Confirming…' : stage === 'confirmed' ? '✓ Confirmed' : stage === 'armed' ? '✓ Click to confirm' : 'Confirm correct'}
      </button>
      {error && <p role="alert" className="workload-error">{error}</p>}
    </div>
  );
};

const Workload = () => {
  const { user, session } = useContext(AuthContext);
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
  const cacheOwner = `${user?.id}:${user?.role}:${session?.access_token || ''}`;
  const snapshotKey = `${cacheOwner}:${monthKey}`;
  const [snapshotState, setSnapshotState] = useState({ key: '', data: EMPTY_SNAPSHOTS });
  const snapshotRef = useRef(snapshotState);
  const snapshots = snapshotState.key === snapshotKey ? snapshotState.data : EMPTY_SNAPSHOTS;
  const [refreshing, setRefreshing] = useState(false);
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
  const load = useCallback(async (force = false) => {
    const version = ++request.current;
    const cached = force ? null : workloadCache.get(cacheOwner, monthKey);
    const previous = snapshotRef.current.key === snapshotKey ? snapshotRef.current.data : EMPTY_SNAPSHOTS;
    const publish = (data) => {
      const next = { key: snapshotKey, data };
      snapshotRef.current = next;
      setSnapshotState(next);
    };
    setError('');
    if (cached) {
      publish(cached);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (force) workloadCache.clear();
    setLoading(previous.length === 0);
    setRefreshing(true);
    try {
      const results = await Promise.all(monthKey.split(',').map((month) =>
        supabase.rpc('workload_month', { requested_month: month }),
      ));
      if (version !== request.current) return;
      const failure = results.find((result) => result.error);
      if (failure) {
        if ([401, 403].includes(failure.status) || ['42501', 'PGRST301', 'PGRST302'].includes(failure.error.code)) {
          workloadCache.clear();
          publish(EMPTY_SNAPSHOTS);
        }
        throw failure.error;
      }
      const next = results.map((result) => result.data);
      workloadCache.set(cacheOwner, monthKey, next);
      publish(next);
    } catch (failure) {
      if (version === request.current) {
        setError(failure.message || 'Unable to load workload.');
      }
    } finally {
      if (version === request.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [monthKey, cacheOwner, snapshotKey]);
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
      pendingReview: sum.pendingReview || item.pendingReview,
      pendingTimer: sum.pendingTimer || item.pendingTimer,
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
          Correct timesheet
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
          <ConfirmDayButton
            key={`${item.id}:${day.work_date}:${day.fingerprint}`}
            person={item}
            day={day}
            onSaved={() => {
              setNotice(`${item.name} · ${formatAppDate(day.work_date)} confirmed correct.`);
              void load(true);
            }}
          />
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
                  <CostingAmount value={sum.costing} pendingReview={sum.pendingReview} pendingTimer={sum.pendingTimer} />
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
          <button className="btn btn-outline workload-refresh-button" onClick={() => void load(true)} disabled={refreshing} aria-label={refreshing ? 'Refreshing workload' : 'Refresh workload'}>
            <span role="status">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
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
        <div role="status" className="workload-toast"><span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>
      )}
      {error && snapshots.length > 0 && <p role="alert" className="workload-error">Could not refresh: {error} Showing previously loaded figures. <button className="btn btn-outline" onClick={() => void load(true)}>Retry</button></p>}
      {loading || (!snapshots.length && !error) ? (
        <AppState
          type="loading"
          title="Loading workload…"
          message="Calculating the complete monthly allocation."
        />
      ) : error && !snapshots.length ? (
        <AppState
          type="error"
          title="Workload unavailable"
          message={error}
          action={
            <button className="btn btn-outline" onClick={() => void load(true)}>
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
              <strong>{totals.costing > 0 ? hours(totals.costing) : (totals.pendingReview ? 'Pending review' : totals.pendingTimer ? 'Timer running' : hours(0))}</strong>
              {totals.costing > 0 && (totals.pendingReview || totals.pendingTimer) && <small>Partial · {totals.pendingReview ? 'pending review' : 'timer running'}{totals.pendingReview && totals.pendingTimer ? ' · timer running' : ''}</small>}
              <small>Excludes time pending review or still running</small>
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
            <section className="card workload-section workload-review-list">
              <div className="workload-review-header">
                <div><h2>Days needing attention</h2><p>Confirm the hours or open the timesheet to correct them.</p></div>
              <label>Show <select value={queueFilter} onChange={(event) => setQueueFilter(event.target.value)}>
                <option value="all">All pending issues</option>
                <option value="missing_time">Below expected / missing hours</option>
                <option value="long_day">Long days to confirm</option>
                <option value="invalid">Stale timers and conflicting records</option>
              </select></label>
              </div>
              {issues.length ? (
                issues.filter(({ day }) => queueFilter === 'all' || (queueFilter === 'invalid' ? reviewFlags(day).some((flag) => !['missing_time', 'long_day'].includes(flag)) : day.flags.includes(queueFilter))).map(({ person: item, day }) => (
                  <article
                    className="workload-issue"
                    key={`${item.id}:${day.work_date}`}
                  >
                    <div className="workload-issue-person">
                      <h3><button className="workload-text-button" onClick={() => change({ person: item.id })}>{item.name}</button></h3>
                      <time dateTime={day.work_date}>{formatAppDate(day.work_date)}</time>
                    </div>
                    <div className="workload-issue-facts">
                    <p>
                      {reviewFlags(day)
                        .map((flag) => WORKLOAD_FLAGS[flag])
                        .join(' · ')}
                    </p>
                    <p className="workload-issue-hours">
                      <strong>{hours(Number(day.recorded_seconds) / 3600)}h</strong> recorded · Costing hours: {costingLabel(day.costing_hours, costingPending(day))} (provisional)
                    </p>
                    </div>
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
                        <td data-sort-value={context.costing}><CostingAmount value={context.costing} pendingReview={context.pendingReview} pendingTimer={context.pendingTimer} /></td>
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
                      <strong>Costing hours: {costingLabel(day.costing_hours, costingPending(day))}</strong>
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
                      · Costing hours: {costingLabel(context.costing_hours, costingPending(day, context.recorded_seconds))}
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
        <p><strong>Pending and partial costing:</strong> Pending review or Timer running means recorded time is excluded for now. Partial means the number includes eligible time only; other recorded time is still pending. A plain 0.00 means no costing allocation, without excluded recorded time. Leave, unworked time and future days stay separate from project costs.</p>
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
