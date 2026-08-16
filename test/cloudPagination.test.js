import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPaginatedRows } from '../src/services/cloudPagination.js';

test('cloud hydration retrieves every row beyond the PostgREST page limit', async () => {
  const source = Array.from({ length: 2_305 }, (_, id) => ({ id }));
  const calls = [];
  const rows = await fetchPaginatedRows(async (from, to, includeCount) => {
    calls.push([from, to]);
    return { data: source.slice(from, to + 1), count: includeCount ? source.length : null, error: null };
  });
  assert.equal(rows.length, source.length);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('cloud hydration rejects a truncated snapshot instead of silently replacing local data', async () => {
  await assert.rejects(
    fetchPaginatedRows(async () => ({ data: [{ id: 1 }], count: 2, error: null })),
    /incomplete/i,
  );
});
