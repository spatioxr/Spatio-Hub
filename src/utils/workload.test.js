import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combineWorkload,
  reviewFlags,
  projectPeople,
  summarizeWorkload,
  workloadRange,
  workloadMonths,
  timesheetInitialSelection,
  timesheetReviewLink,
} from './workload.js';
const day = (date, hours, project = 'p', allocation = hours) => ({
  work_date: date,
  recorded_seconds: hours * 3600,
  leave_fraction: 0,
  flags: [],
  contexts: [
    {
      context_id: project,
      label: project,
      recorded_seconds: hours * 3600,
      costing_hours: allocation,
    },
  ],
});
const snapshot = (month, days) => ({
  month,
  people: [
    {
      id: 'e',
      name: 'Person',
      monthly_hours: 176,
      allocated_hours: 40,
      leave_hours: 8,
      unallocated_hours: 128,
      needs_review: true,
      days,
    },
  ],
});
test('weekly range spans months and loads both complete monthly denominators', () => {
  const range = workloadRange('2026-10-01', 'week');
  assert.deepEqual(range, { start: '2026-09-28', end: '2026-10-04' });
  assert.deepEqual(workloadMonths(range), ['2026-09-01', '2026-10-01']);
  const result = combineWorkload(
    [
      snapshot('2026-09-01', [
        day('2026-09-27', 4),
        day('2026-09-28', 10, 'p', 8),
      ]),
      snapshot('2026-10-01', [day('2026-10-01', 10, 'internal', 7)]),
    ],
    range,
  );
  assert.equal(result.people[0].months.length, 2);
  assert.equal(summarizeWorkload(result.people[0]).costing, 15);
});
test('project filtering retains the complete person workload and monthly review status', () => {
  const person = combineWorkload(
    [
      snapshot('2026-09-01', [
        {
          ...day('2026-09-01', 10, 'p', 4),
          contexts: [
            ...day('', 5, 'p', 4).contexts,
            ...day('', 5, 'internal', 4).contexts,
          ],
        },
      ]),
    ],
    workloadRange('2026-09-01', 'month'),
  ).people[0];
  const sum = summarizeWorkload(person, 'p');
  assert.equal(sum.recorded, 5);
  assert.equal(sum.costing, 4);
  assert.equal(sum.totalRecorded, 10);
  assert.equal(sum.aboveEight, 2);
  assert.equal(sum.needsReview, true);
});
test('project detail includes assigned people without entries and past contributors', () => {
  const people = [
    { id: 'assigned', days: [] },
    { id: 'contributor', days: [day('2026-09-01', 2)] },
    { id: 'outside', days: [] },
  ];
  assert.deepEqual(
    projectPeople({ id: 'p', members: [{ id: 'assigned' }] }, people).map(
      (p) => p.id,
    ),
    ['assigned', 'contributor'],
  );
});
test('review links preserve the session start day, and untrusted deep links cannot grant scope', () => {
  assert.match(
    timesheetReviewLink(
      'e',
      {
        work_date: '2026-09-02',
        review_entries: [{ started_at: '2026-09-01T18:00:00Z' }],
      },
      'manager',
    ),
    /date=2026-09-01/,
  );
  assert.deepEqual(
    timesheetInitialSelection(
      '?date=2026-02-31&scope=organisation&employee=bad',
      ['personal'],
      '2026-09-16',
    ),
    { date: '2026-09-16', scope: 'personal', employee: 'all' },
  );
});

test('hour indicators remain visible without keeping confirmed short days in review', () => {
  assert.deepEqual(reviewFlags({ flags: ['below_eight'] }), []);
  assert.deepEqual(reviewFlags({ flags: ['below_eight', 'missing_time'] }), ['missing_time']);
  assert.deepEqual(reviewFlags({ flags: ['above_eight', 'long_day'] }), ['long_day']);
});
