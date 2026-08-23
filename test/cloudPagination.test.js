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

test('cloud hydration validates a paginated snapshot with a lightweight revision pass', async () => {
  const source = Array.from({ length: 4 }, (_, id) => ({ id, updated_at: `r${id}` }));
  let validationCalls = 0;
  const rows = await fetchPaginatedRows(async (from, to, includeCount) => ({
    data: source.slice(from, to + 1),
    count: includeCount ? source.length : null,
    error: null,
  }), {
    pageSize: 2,
    validateRows: async snapshot => {
      validationCalls += 1;
      return snapshot.every((row, index) => row.updated_at === source[index].updated_at);
    },
  });
  assert.deepEqual(rows, source);
  assert.equal(validationCalls, 1);
});

test('cloud hydration fails immediately on a page error so auth recovery stays bounded', async () => {
  let calls = 0;
  await assert.rejects(
    fetchPaginatedRows(async () => {
      calls += 1;
      return { error: new Error('PGRST3003 JWT issued at future') };
    }),
    /JWT issued at future/,
  );
  assert.equal(calls, 1);
});
