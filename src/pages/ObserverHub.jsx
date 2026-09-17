import useListSort from '../hooks/useListSort';
import ListSortControls from '../components/ListSortControls';
import SortableTable from '../components/SortableTable';
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { supabase } from '../utils/supabaseClient';
import {
  addAppDays,
  appDateKey,
  formatAppClock,
  formatAppDate,
  formatAppTimeValue,
} from '../utils/timezone';
import {
  observerAttendanceLabel,
  summarizeObserverWork,
  validObserverRange,
} from '../utils/observer';
import './ObserverAccess.css';

const titles = {
  overview: 'Organisation overview',
  projects: 'Projects',
  timesheets: 'Timesheets',
  attendance: 'Attendance',
  analytics: 'Work summaries',
};
const hours = (seconds) => `${(Number(seconds || 0) / 3600).toFixed(1)} h`;

const ObserverHub = ({ view = 'overview' }) => {
  const projectSort = useListSort('observerProjects', [{ key: 'name', label: 'Project name', value: (item) => item.name }, { key: 'code', label: 'Code', value: (item) => item.code }, { key: 'team', label: 'Team size', value: (item) => Number(item.member_count) }, { key: 'status', label: 'Status', value: (item) => item.archived_at ? 'Archived' : 'Active' }]);
  const [start, setStart] = useState(() => addAppDays(appDateKey(), -6));
  const [end, setEnd] = useState(() => appDateKey());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [person, setPerson] = useState('');
  const valid = validObserverRange(start, end);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setData(null);
      setError('');
      if (!valid) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await supabase.rpc('observer_hub_snapshot', {
          start_date: start,
          end_date: end,
        });
        if (!active) return;
        if (result.error) throw result.error;
        setData(result.data);
      } catch (failure) {
        if (active) {
          setData(null);
          setError(failure.message || 'Unable to load organisation data.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [start, end, valid, refresh]);

  useEffect(() => {
    const update = () => {
      if (document.visibilityState === 'visible')
        setRefresh((value) => value + 1);
    };
    const interval = window.setInterval(update, 60000);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', update);
    };
  }, []);

  const entries = useMemo(
    () =>
      (data?.entries || []).filter(
        (entry) =>
          (!person || person === entry.employee_id) &&
          `${entry.employee_name} ${entry.context_name} ${entry.department || ''}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [data, person, search],
  );
  const summaries = useMemo(() => summarizeObserverWork(entries), [entries]);
  const people = useMemo(
    () =>
      [
        ...new Map([
          ...(data?.people || []).map((item) => [item.id, item.name]),
          ...(data?.entries || []).map((item) => [
            item.employee_id,
            item.employee_name,
          ]),
          ...(data?.attendance || []).map((item) => [
            item.employee_id,
            item.employee_name,
          ]),
        ]).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [data],
  );
  const attendance = (data?.attendance || []).filter(
    (row) =>
      (!person || row.employee_id === person) &&
      row.employee_name.toLowerCase().includes(search.toLowerCase()),
  );
  const projects = (data?.projects || []).filter((row) =>
    `${row.name} ${row.code}`.toLowerCase().includes(search.toLowerCase()),
  );
  const livePeople = (data?.people || []).filter((row) =>
    `${row.name} ${row.department || ''}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  return (
    <Layout
      title={titles[view]}
      eyebrow="Observer access"
      description="Organisation visibility for external stakeholders. View only."
      showTimer={false}
    >
      <div className="observer-notice">
        <i className="ri-eye-line" aria-hidden="true" />
        <span>
          External stakeholder · No attendance, time tracking or leave
          submissions required.
        </span>
      </div>
      <div className="observer-toolbar">
        <label>
          From
          <input
            type="date"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
        <label>
          Search
          <input
            type="search"
            placeholder={
              view === 'projects'
                ? 'Project name or code'
                : 'Name or work context'
            }
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {['timesheets', 'attendance', 'analytics'].includes(view) && (
          <label>
            Person
            <select
              aria-label="Person"
              value={person}
              onChange={(event) => setPerson(event.target.value)}
            >
              <option value="">All people</option>
              {people.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="btn btn-outline"
          disabled={loading || !valid}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh
        </button>
      </div>
      {!valid && (
        <p role="alert">
          Choose a date range of 31 days or fewer, with From on or before To.
        </p>
      )}
      {error && (
        <p className="observer-error" role="alert">
          {error}{' '}
          <button
            className="btn btn-outline"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {loading && <p role="status">Loading organisation data…</p>}
      {data && !loading && !error && valid && (
        <>
          <p className="observer-meta">
            Updated {formatAppClock(data.updated_at)} IST · Work totals cover{' '}
            {formatAppDate(start)}–{formatAppDate(end)}. Unresolved timers are
            excluded.
          </p>
          {view === 'overview' && (
            <>
              <div className="observer-stats">
                <article>
                  <span>Active staff</span>
                  <strong>{data.people.length}</strong>
                </article>
                <article>
                  <span>Currently working</span>
                  <strong>
                    {
                      data.people.filter(
                        (item) => item.work_status === 'In' && !item.stale,
                      ).length
                    }
                  </strong>
                </article>
                <article>
                  <span>Active projects</span>
                  <strong>
                    {data.projects.filter((item) => !item.archived_at).length}
                  </strong>
                </article>
                <article>
                  <span>Recorded work in range</span>
                  <strong>
                    {hours(
                      data.entries.reduce(
                        (sum, item) => sum + (Number(item.worked_seconds) || 0),
                        0,
                      ),
                    )}
                  </strong>
                </article>
              </div>
              <div className="observer-links">
                <Link to="/projects">Browse projects →</Link>
                <Link to="/analytics">View work summaries →</Link>
              </div>
              <h2>Who’s in / out</h2>
              <div className="observer-table-wrap">
                <SortableTable sortId="observerLive" className="observer-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Department</th>
                      <th>Current status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {livePeople.map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td>{item.department || '—'}</td>
                        <td>
                          {item.stale ? 'Unresolved timer' : item.work_status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </SortableTable>
              </div>
              {!livePeople.length && <p>No staff match this search.</p>}
            </>
          )}
          {view === 'projects' && (
            <div className="observer-projects">
              <ListSortControls sort={projectSort} />
              {projectSort.sort(projects).map((item) => (
                <article key={item.id}>
                  <span className="badge primary">
                    {item.archived_at ? 'Archived' : 'Active'}
                  </span>
                  <h2>{item.name}</h2>
                  <small>
                    {item.code} · {item.member_count} active team members
                  </small>
                  <p>{item.description || 'No description provided.'}</p>
                </article>
              ))}
              {!projects.length && <p>No projects match this search.</p>}
            </div>
          )}
          {view === 'timesheets' && (
            <>
              <div className="observer-table-wrap">
                <SortableTable sortId="observerEntries" className="observer-table">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Project / activity</th>
                      <th>Started (IST)</th>
                      <th>Ended (IST)</th>
                      <th>Work in range</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((item) => (
                      <tr key={item.id}>
                        <td>{item.employee_name}</td>
                        <td>{item.context_name}</td>
                        <td data-sort-value={Date.parse(item.started_at)}>
                          {formatAppDate(item.started_at)} ·{' '}
                          {formatAppClock(item.started_at)}
                        </td>
                        <td data-sort-value={item.ended_at ? Date.parse(item.ended_at) : null}>
                          {item.ended_at
                            ? `${formatAppDate(item.ended_at)} · ${formatAppClock(item.ended_at)}`
                            : 'Open'}
                        </td>
                        <td data-sort-value={item.stale ? null : Number(item.worked_seconds)}>
                          {item.stale
                            ? 'Unresolved timer'
                            : hours(item.worked_seconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </SortableTable>
              </div>
              {!entries.length && (
                <p>No recorded work matches these filters.</p>
              )}
            </>
          )}
          {view === 'attendance' && (
            <>
              <p>
                Factual attendance and approved leave only. No record does not
                imply absence. Leave reasons and types are private.
              </p>
              <div className="observer-table-wrap">
                <SortableTable sortId="observerAttendance" className="observer-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Person</th>
                      <th>Status</th>
                      <th>Check-in (IST)</th>
                      <th>Check-out (IST)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.map((item) => (
                      <tr key={`${item.employee_id}:${item.date}`}>
                        <td data-sort-value={item.date}>{formatAppDate(item.date)}</td>
                        <td>{item.employee_name}</td>
                        <td>{observerAttendanceLabel(item, data.holidays)}</td>
                        <td data-sort-value={item.check_in || null}>{formatAppTimeValue(item.check_in)}</td>
                        <td data-sort-value={item.check_out || null}>{formatAppTimeValue(item.check_out)}</td>
                      </tr>
                    ))}
                  </tbody>
                </SortableTable>
              </div>
              {!attendance.length && (
                <p>No attendance matches these filters.</p>
              )}
            </>
          )}
          {view === 'analytics' && (
            <>
              <div className="observer-stats">
                <article>
                  <span>Recorded work in range</span>
                  <strong>
                    {hours(
                      summaries.reduce((sum, item) => sum + item.seconds, 0),
                    )}
                  </strong>
                </article>
                <article>
                  <span>Unresolved timers</span>
                  <strong>
                    {summaries.reduce((sum, item) => sum + item.unresolved, 0)}
                  </strong>
                </article>
              </div>
              <div className="observer-table-wrap">
                <SortableTable sortId="observerTotals" className="observer-table">
                  <thead>
                    <tr>
                      <th>Project / activity</th>
                      <th>Recorded work</th>
                      <th>Unresolved timers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaries.map((item) => (
                      <tr key={item.key}>
                        <td>{item.name}</td>
                        <td data-sort-value={item.seconds}>{hours(item.seconds)}</td>
                        <td data-sort-value={item.unresolved || 0}>{item.unresolved || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </SortableTable>
              </div>
              {!summaries.length && (
                <p>No recorded work matches these filters.</p>
              )}
            </>
          )}
        </>
      )}
    </Layout>
  );
};
export default ObserverHub;
