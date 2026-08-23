export const fetchPaginatedRows = async (fetchPage, {
  pageSize = 500,
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
      let result = null;
      let pageError = null;
      for (let pageAttempt = 0; pageAttempt < maxAttempts; pageAttempt++) {
        const res = await fetchPage(offset, offset + pageSize - 1, offset === 0);
        if (res?.error) {
          pageError = res.error;
          await new Promise(r => setTimeout(r, 1000 * (pageAttempt + 1))); // backoff
        } else {
          result = res;
          pageError = null;
          break;
        }
      }
      if (pageError) throw pageError;
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
