import assert from 'node:assert/strict';
import test from 'node:test';
import { getSequenceNavigation } from './sequenceNavigation.js';

const people = [
  { employee_id: 'a', name: 'Aisha' },
  { employee_id: 'b', name: 'Bharat' },
  { employee_id: 'c', name: 'Chitra' },
];
const employeeKey = (person) => person.employee_id;

test('sequence navigation returns adjacent items and a human position', () => {
  assert.deepEqual(getSequenceNavigation(people, 'b', employeeKey), {
    current: people[1],
    previous: people[0],
    next: people[2],
    index: 1,
    position: 2,
    total: 3,
  });
});

test('sequence navigation stops cleanly at both boundaries', () => {
  assert.equal(getSequenceNavigation(people, 'a', employeeKey).previous, null);
  assert.equal(getSequenceNavigation(people, 'c', employeeKey).next, null);
});

test('sequence navigation handles missing selections and empty lists', () => {
  assert.deepEqual(getSequenceNavigation(people, 'missing', employeeKey), {
    current: null,
    previous: null,
    next: null,
    index: -1,
    position: 0,
    total: 3,
  });
  assert.equal(getSequenceNavigation([], 'a', employeeKey).total, 0);
});
