import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarMonth, holidaysInPeriod, moveCalendarMonth } from './holidayCalendar.js';

test('holiday calendar aligns weekdays and includes leap day', () => {
  const cells = calendarMonth(2024, 1);
  assert.equal(cells.filter(Boolean).length, 29);
  assert.equal(cells[4], '2024-02-01');
  assert.equal(cells.at(-1), '2024-02-29');
  assert.equal(calendarMonth(2026, 1).filter(Boolean).length, 28);
});

test('holiday month navigation crosses year boundaries', () => {
  assert.deepEqual(moveCalendarMonth(2026, 11, 1), { year: 2027, month: 0 });
  assert.deepEqual(moveCalendarMonth(2026, 0, -1), { year: 2025, month: 11 });
});

test('year lists include all holidays including past dates without a six-item cap', () => {
  const holidays = Array.from({ length: 12 }, (_, month) => ({ date: `2026-${String(month + 1).padStart(2, '0')}-01`, name: `Holiday ${month}` })).reverse();
  holidays.push({ date: '2027-01-01', name: 'Next year' });
  assert.equal(holidaysInPeriod(holidays, 2026).length, 12);
  assert.equal(holidaysInPeriod(holidays, 2026)[0].date, '2026-01-01');
  assert.equal(holidaysInPeriod(holidays, 2026, 8)[0].date, '2026-09-01');
  assert.deepEqual(holidaysInPeriod(holidays, 2025), []);
  assert.equal(holidays[0].date, '2026-12-01');
});
