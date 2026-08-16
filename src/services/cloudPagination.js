export const fetchPaginatedRows = async (fetchPage, {
  pageSize = 1_000,
  maxRows = 500_000,
  maxAttempts = 3,
  getRowKey = row => JSON.stringify(row),
  getRowRevision = row => row?.updated_at ?? row?.deleted_at ?? '',
} = {}) => {
  let previousFingerprint = null;
  let lastValidationError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const rows = [];
    let expectedCount = null;
    for (let offset = 0; offset < maxRows; offset += pageSize) {
      const result = await fetchPage(offset, offset + pageSize - 1, offset === 0);
      if (result?.error) throw result.error;
      const page = Array.isArray(result?.data) ? result.data : [];
      if (offset === 0 && Number.isInteger(result?.count)) expectedCount = result.count;
      rows.push(...page);
      if (rows.length > maxRows) throw new Error('Cloud snapshot exceeds the supported row limit');
      if (page.length < pageSize) break;
    }

    if (expectedCount !== null && expectedCount > maxRows) throw new Error('Cloud snapshot exceeds the supported row limit');
    if (expectedCount !== null && rows.length !== expectedCount) {
      lastValidationError = new Error(`Cloud snapshot was incomplete: expected ${expectedCount} rows but received ${rows.length}`);
      previousFingerprint = null;
      continue;
    }
    const keys = rows.map(row => String(getRowKey(row)));
    if (new Set(keys).size !== keys.length) {
      lastValidationError = new Error('Cloud snapshot contained duplicate row identities');
      previousFingerprint = null;
      continue;
    }
    if (rows.length <= pageSize) return rows;

    const fingerprint = keys.map((key, index) => `${key}:${String(getRowRevision(rows[index]))}`).join('\u0000');
    if (fingerprint === previousFingerprint) return rows;
    previousFingerprint = fingerprint;
  }
  throw lastValidationError || new Error('Cloud snapshot changed during pagination; retry synchronization');
};
