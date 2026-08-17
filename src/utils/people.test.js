import assert from 'node:assert/strict';
import test from 'node:test';
import {
  employmentStatusLabel,
  isActivePerson,
  isActiveScopeMember,
  isArchivedPerson,
} from './people.js';

test('Released is the retained archive state shown to users as Archived', () => {
  const archivedPerson = { status: 'Released' };

  assert.equal(isArchivedPerson(archivedPerson), true);
  assert.equal(isActivePerson(archivedPerson), false);
  assert.equal(employmentStatusLabel(archivedPerson.status), 'Archived');
});

test('only Active employment status grants active-person access', () => {
  assert.equal(isActivePerson({ status: 'Active' }), true);
  assert.equal(isActivePerson({ status: 'On Leave' }), false);
  assert.equal(isActivePerson({ status: 'On Notice' }), false);
  assert.equal(isActivePerson({ status: 'Released' }), false);
});

test('timesheet and attendance scope members include Active profiles only', () => {
  assert.equal(isActiveScopeMember({ employee_status: 'Active' }), true);
  assert.equal(isActiveScopeMember({ employee_status: 'On Leave' }), false);
  assert.equal(isActiveScopeMember({ employee_status: 'On Notice' }), false);
  assert.equal(isActiveScopeMember({ employee_status: 'Released' }), false);
});
