import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPaginatedRows } from '../src/services/cloudPagination.js';

test('cloud hydration retrieves every row beyond the PostgREST page limit', async () => {
  const source = Array.from({ length: 2_305 }, (_, id) => ({ id }));
  const calls = [];
  const rows = await fetchPaginatedRows(async (from, to, includeCount) => {
    calls.push([from, to]);
    return { data: source.slice(from, to + 1), count: includeCount ? source.length : null, error: null };
  }, { pageSize: 1_000 });
  assert.equal(rows.length, source.length);
  assert.deepEqual(calls, [
    [0, 999], [1000, 1999], [2000, 2999],
    [0, 999], [1000, 1999], [2000, 2999],
  ]);
});

test('cloud hydration retries a balanced between-page mutation until the snapshot is stable', async () => {
  let source = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
  let calls = 0;
  const rows = await fetchPaginatedRows(async (from, to, includeCount) => {
    calls += 1;
    const count = source.length;
    const page = source.slice(from, to + 1);
    if (calls === 1) source = [{ id: 'B' }, { id: 'C' }, { id: 'D' }, { id: 'E' }];
    return { data: page, count: includeCount ? count : null, error: null };
  }, { pageSize: 2, getRowKey: row => row.id });
  assert.deepEqual(rows.map(row => row.id), ['B', 'C', 'D', 'E']);
  assert.equal(calls, 9);
});

test('cloud hydration retries a deletion between pages until the snapshot is stable', async () => {
  let source = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
  let calls = 0;
  const rows = await fetchPaginatedRows(async (from, to, includeCount) => {
    calls += 1;
    const count = source.length;
    const page = source.slice(from, to + 1);
    if (calls === 1) source = [{ id: 'B' }, { id: 'C' }, { id: 'D' }];
    return { data: page, count: includeCount ? count : null, error: null };
  }, { pageSize: 2, getRowKey: row => row.id });
  assert.deepEqual(rows.map(row => row.id), ['B', 'C', 'D']);
  assert.equal(calls, 6);
});

test('cloud hydration retries an insertion between pages until the snapshot is stable', async () => {
  let source = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
  let calls = 0;
  const rows = await fetchPaginatedRows(async (from, to, includeCount) => {
    calls += 1;
    const count = source.length;
    const page = source.slice(from, to + 1);
    if (calls === 1) source = [{ id: '0' }, { id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
    return { data: page, count: includeCount ? count : null, error: null };
  }, { pageSize: 2, getRowKey: row => row.id });
  assert.deepEqual(rows.map(row => row.id), ['0', 'A', 'B', 'C', 'D']);
  assert.equal(calls, 9);
});

test('cloud hydration rejects a truncated snapshot instead of silently replacing local data', async () => {
  await assert.rejects(
    fetchPaginatedRows(async () => ({ data: [{ id: 1 }], count: 2, error: null })),
    /incomplete/i,
  );
});

test('cloud hydration retries a failed page instead of aborting the entire sequence', async () => {
  let calls = 0;
  const source = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const rows = await fetchPaginatedRows(async (from, to, includeCount) => {
    calls++;
    if (calls === 1) return { error: new Error('57014 query_canceled') }; // First attempt fails
    return { data: source.slice(from, to + 1), count: includeCount ? 3 : null, error: null };
  }, { pageSize: 3, maxAttempts: 3 });
  assert.equal(rows.length, 3);
  assert.equal(calls, 3); // 1 fail, 1 success, 1 empty
});
