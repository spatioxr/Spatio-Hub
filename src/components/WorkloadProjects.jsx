import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { projectPeople, summarizeWorkload, workloadHours } from '../utils/workload';

const columns = [
  ['code', 'Code'], ['name', 'Project'], ['managers', 'Managers'],
  ['status', 'Status'], ['people', 'People'], ['recorded', 'Recorded hours'],
  ['costing', 'Costing hours'], ['review', 'Review'],
];

export default function WorkloadProjects({ projects, people, onSelect }) {
  const [params, setParams] = useSearchParams();
  const filter = ['all', 'active'].includes(params.get('projectView')) ? params.get('projectView') : 'recorded';
  const query = params.get('projectSearch') || '';
  const sort = {
    key: columns.some(([key]) => key === params.get('projectSort')) ? params.get('projectSort') : 'name',
    direction: params.get('projectDirection') === 'desc' ? 'desc' : 'asc',
  };
  const update = (values) => setParams((current) => {
    const next = new URLSearchParams(current);
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    return next;
  }, { replace: true });
  const rows = useMemo(() => projects.map((project) => {
    const members = projectPeople(project, people);
    const summaries = members.map((person) => summarizeWorkload(person, project.id));
    return {
      id: project.id, code: project.code || '—', name: project.name,
      managers: (project.managers || []).map((person) => person.name).join(', ') || '—',
      status: project.archived_at ? 'Archived' : 'Active',
      people: members.length,
      recorded: summaries.reduce((sum, item) => sum + item.recorded, 0),
      costing: summaries.reduce((sum, item) => sum + item.costing, 0),
      review: summaries.some((item) => item.needsReview) ? 'Needs review' : 'No pending issues',
    };
  }), [projects, people]);
  const visible = useMemo(() => rows.filter((row) => (
    (filter === 'all' || (filter === 'active' ? row.status === 'Active' : row.recorded > 0))
    && `${row.code} ${row.name} ${row.managers}`.toLowerCase().includes(query.trim().toLowerCase())
  )).sort((a, b) => {
    const order = typeof a[sort.key] === 'number'
      ? a[sort.key] - b[sort.key]
      : a[sort.key].localeCompare(b[sort.key], undefined, { numeric: true, sensitivity: 'base' });
    return (sort.direction === 'asc' ? order : -order) || a.name.localeCompare(b.name);
  }), [rows, filter, query, sort.key, sort.direction]);
  return (
    <>
      <div className="workload-project-filters">
        <label>Show projects
          <select value={filter} onChange={(event) => update({ projectView: event.target.value })}>
            <option value="recorded">With recorded work in this period</option>
            <option value="active">All active projects</option>
            <option value="all">All projects, including archived</option>
          </select>
        </label>
        <label>Search projects
          <input type="search" value={query} onChange={(event) => update({ projectSearch: event.target.value })} placeholder="Project, code or manager" />
        </label>
      </div>
      <p className="workload-project-note">{visible.length} of {rows.length} projects · Hours are for the selected period. Active is the project’s current status; recorded work shows whether it was used in this period. All costing hours are provisional.</p>
      <div className="workload-table-wrap">
        <table className="workload-table workload-project-table">
          <caption className="workload-project-note">Select a project for its people and leave details. Select any column heading to sort.</caption>
          <thead><tr>{columns.map(([key, label]) => (
            <th key={key} scope="col" aria-sort={sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
              <button type="button" className="workload-sort-button" onClick={() => update({ projectSort: key, projectDirection: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc' })}>
                {label}<span aria-hidden="true">{sort.key === key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span>
              </button>
            </th>
          ))}</tr></thead>
          <tbody>{visible.map((row) => (
            <tr key={row.id}>
              <td>{row.code}</td>
              <td><button className="workload-text-button" onClick={() => onSelect(row.id)}>{row.name}</button></td>
              <td>{row.managers}</td><td>{row.status}</td><td>{row.people}</td>
              <td>{workloadHours(row.recorded)}</td><td>{workloadHours(row.costing)}</td><td>{row.review}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {!visible.length && <p role="status">{rows.length ? 'No projects match this view. Choose All active projects or All projects to include projects without recorded work, or clear your search.' : 'No projects in your scope.'}</p>}
      <p className="workload-project-note">People includes current assignees and contributors. Review status also considers unresolved records elsewhere in each person’s month, because they affect the allocation.</p>
    </>
  );
}
