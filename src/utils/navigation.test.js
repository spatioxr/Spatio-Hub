import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('navigation separates common, Manage and Settings responsibilities', () => {
  const sidebar = read('../components/Sidebar.jsx');

  for (const item of ['Dashboard', 'Track Work', 'Timesheets', 'Attendance', 'Leave']) {
    assert.match(sidebar, new RegExp(`name: '${item}'`));
  }
  assert.match(sidebar, /label="Manage"/);
  assert.match(sidebar, /name: 'People'/);
  assert.match(sidebar, /name: 'Projects'/);
  assert.match(sidebar, /name: 'Analytics'/);
  assert.match(sidebar, /label="Settings"/);
  assert.match(sidebar, /name: 'Users & Access'/);
  assert.match(sidebar, /name: 'Work Setup'/);
  assert.match(sidebar, /name: 'Work Requirements'/);
});

test('Track Work owns live actions while Attendance remains read-only history', () => {
  const trackWork = read('../pages/TrackWork.jsx');
  const attendance = read('../pages/Attendance.jsx');

  assert.match(trackWork, /heading="Track Work"/);
  assert.match(trackWork, /<WorkTimerControl variant="page"/);
  assert.match(trackWork, /requested_scope: 'personal'/);
  assert.match(trackWork, /Today’s timeline/);
  assert.match(attendance, /heading="Attendance calendar"/);
  assert.doesNotMatch(attendance, /Edit Attendance/);
  assert.doesNotMatch(attendance, /\.from\('attendance'\)[\s\S]*\.update\(/);
  assert.match(attendance, /Work sessions and corrections remain in Timesheets/);
});

test('Manager+ live status is part of the application shell and settings stay role gated', () => {
  const layout = read('../components/Layout.jsx');
  const app = read('../App.jsx');

  assert.match(layout, /VIEW_MANAGEMENT_LIVE_RAIL/);
  assert.match(layout, /variant="rail"/);
  assert.match(app, /permission=\{PERMISSIONS\.VIEW_WORK_DISTRIBUTION\}/);
  assert.match(app, /path="\/admin-settings\/users"/);
  assert.match(app, /path="\/admin-settings\/work-setup"/);
  assert.match(app, /permission=\{PERMISSIONS\.MANAGE_BOS_EOD_EXCEPTIONS\}/);
});

test('Users & Access presents retained profiles with explicit archive semantics', () => {
  const people = read('../pages/People.jsx');

  assert.match(people, /'Total profiles'/);
  assert.match(people, /'People in your scope'/);
  assert.match(people, /\? 'Restore' : 'Archive'/);
  assert.match(people, /'Access blocked'/);
  assert.match(people, /profile and work history will be retained/);
  assert.doesNotMatch(people, />Visible people</);
});
