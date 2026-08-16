import test from 'node:test';
import assert from 'node:assert/strict';
import { dateInputFromTimestamp, timestampFromDateInput } from '../src/utils/calendarDate.js';

test('calendar date round trips without UTC-day drift at extreme time-zone offsets', () => {
  for (const offsetMinutes of [-12 * 60, 0, 5.5 * 60, 14 * 60]) {
    const timestamp = timestampFromDateInput('2026-08-16', { offsetMinutes });
    assert.equal(dateInputFromTimestamp(timestamp, { offsetMinutes }), '2026-08-16');
  }
});

test('invalid or empty calendar dates are rejected', () => {
  assert.equal(timestampFromDateInput(''), null);
  assert.equal(timestampFromDateInput('2026-02-30'), null);
  assert.equal(timestampFromDateInput('not-a-date'), null);
});
