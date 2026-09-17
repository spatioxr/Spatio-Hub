import { addAppDays, appDateKey } from './timezone.js';

export const WORKLOAD_FLAGS = {
  in_progress: 'Timer still open',
  previous_day_open: 'Open from a previous day',
  stale_session: 'Session spans 24+ hours',
  future_time: 'Future time recorded',
  long_day: 'Over 12 hours — confirm or correct',
  work_on_leave: 'Work on full-day leave',
  missing_time: 'Below expected hours — confirm or correct',
  above_eight: 'Above eight hours',
  below_eight: 'Below eight hours',
};
export const reviewFlags = (day) =>
  (day.flags || []).filter(
    (flag) => !['above_eight', 'below_eight', 'in_progress'].includes(flag),
  );
export const workloadHours = (value) => Number(value || 0).toFixed(2);
export const monthStart = (date) => `${date.slice(0, 7)}-01`;
export const workloadRange = (date, mode) => {
  if (mode === 'month') {
    const start = monthStart(date);
    const next = new Date(`${start}T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return { start, end: addAppDays(next.toISOString().slice(0, 10), -1) };
  }
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const start = addAppDays(date, -((weekday + 6) % 7));
  return { start, end: addAppDays(start, 6) };
};
export const workloadMonths = (range) => [
  ...new Set([monthStart(range.start), monthStart(range.end)]),
];

// Only combine server allocations. Filters never recalculate the monthly pool.
export const combineWorkload = (snapshots, range) => {
  const people = new Map();
  const projects = new Map();
  for (const snapshot of snapshots) {
    for (const project of snapshot.projects || [])
      projects.set(project.id, project);
    for (const person of snapshot.people || []) {
      const existing = people.get(person.id) || {
        ...person,
        days: [],
        months: [],
      };
      existing.days.push(
        ...person.days.filter(
          (day) => day.work_date >= range.start && day.work_date <= range.end,
        ),
      );
      existing.months.push({
        month: snapshot.month,
        monthly_hours: person.monthly_hours,
        allocated_hours: person.allocated_hours,
        leave_hours: person.leave_hours,
        unallocated_hours: person.unallocated_hours,
        needs_review: person.needs_review,
      });
      people.set(person.id, existing);
    }
  }
  return {
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
    projects: [...projects.values()],
  };
};
export const summarizeWorkload = (person, projectId = null) => {
  let recorded = 0;
  let costing = 0;
  let totalRecorded = 0;
  let aboveEight = 0;
  let leave = 0;
  let issues = 0;
  const contexts = new Map();
  for (const day of person.days) {
    totalRecorded += Number(day.recorded_seconds) / 3600;
    aboveEight += Math.max(0, Number(day.recorded_seconds) / 3600 - 8);
    leave += Number(day.leave_fraction);
    issues += reviewFlags(day).length > 0 ? 1 : 0;
    for (const context of day.contexts || []) {
      if (projectId && context.context_id !== projectId) continue;
      const row = contexts.get(context.context_id) || {
        ...context,
        recorded: 0,
        costing: 0,
      };
      row.recorded += Number(context.recorded_seconds) / 3600;
      row.costing += Number(context.costing_hours);
      recorded += Number(context.recorded_seconds) / 3600;
      costing += Number(context.costing_hours);
      contexts.set(context.context_id, row);
    }
  }
  return {
    recorded,
    costing,
    totalRecorded,
    aboveEight,
    leave,
    issues,
    contexts: [...contexts.values()],
    needsReview: person.months.some((month) => month.needs_review),
  };
};
export const projectPeople = (project, people) => {
  const assigned = new Set(
    [...(project.members || []), ...(project.managers || [])].map(
      (person) => person.id,
    ),
  );
  return people.filter(
    (person) =>
      assigned.has(person.id) ||
      person.days.some((day) =>
        day.contexts.some((context) => context.context_id === project.id),
      ),
  );
};
export const timesheetReviewLink = (personId, day, role) => {
  // A spanning session is stored in Timesheets under its original start date.
  const date = day.review_entries?.[0]?.started_at
    ? appDateKey(day.review_entries[0].started_at)
    : day.work_date;
  const params = new URLSearchParams({
    employee: personId,
    date,
    scope: role === 'manager' ? 'managed' : 'organisation',
  });
  return `/timesheets?${params}`;
};
export const timesheetInitialSelection = (search, scopes, today) => {
  const params = new URLSearchParams(search);
  const candidate = params.get('date');
  const parsed = new Date(`${candidate}T12:00:00Z`);
  const date =
    /^\d{4}-\d{2}-\d{2}$/.test(candidate || '') &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === candidate
      ? candidate
      : today;
  const employee = params.get('employee');
  return {
    date,
    scope: scopes.includes(params.get('scope'))
      ? params.get('scope')
      : 'personal',
    employee: /^[0-9a-f-]{36}$/i.test(employee || '') ? employee : 'all',
  };
};
