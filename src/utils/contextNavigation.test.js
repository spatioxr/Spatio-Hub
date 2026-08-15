import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('context navigator exposes labelled, boundary-aware controls', () => {
  const navigator = read('../components/ContextNavigator.jsx');

  assert.match(navigator, /role="group"/);
  assert.match(navigator, /aria-label=\{previousLabel\}/);
  assert.match(navigator, /aria-label=\{nextLabel\}/);
  assert.match(navigator, /previousDisabled/);
  assert.match(navigator, /nextDisabled/);
  assert.match(navigator, /aria-live="polite"/);
});

test('People navigation follows filtered results and protects dirty edits', () => {
  const people = read('../pages/People.jsx');

  assert.match(people, /getSequenceNavigation\(filteredPeople, drawer\.person\.id\)/);
  assert.match(people, /hasUnsavedChanges/);
  assert.match(people, /Discard the unsaved changes and open another person/);
});

test('Attendance navigation keeps scoped people and crosses calendar boundaries', () => {
  const attendance = read('../pages/Attendance.jsx');

  assert.match(attendance, /getSequenceNavigation\([\s\S]*attendancePeople/);
  assert.match(attendance, /addAppDays\(selectedDay\.attendance_date, offset\)/);
  assert.match(attendance, /setCurrentMonth\(new Date\(year, month - 1, 1\)\)/);
  assert.match(attendance, /attendanceRequestKey\.current !== requestKey/);
});

test('Timesheet person navigation preserves contextual filters', () => {
  const timesheets = read('../pages/Timesheets.jsx');

  assert.match(timesheets, /selectedDepartment === 'all'/);
  assert.match(timesheets, /getSequenceNavigation\([\s\S]*navigableMembers/);
  assert.match(timesheets, /setSelectedEmployeeId\(nextEmployee\.employee_id\)/);
  assert.doesNotMatch(timesheets, /onNext=\{\(\) => clearFilters\(\)\}/);
});
