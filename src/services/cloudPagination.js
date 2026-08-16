export const fetchPaginatedRows = async (fetchPage, { pageSize = 1_000, maxRows = 500_000 } = {}) => {
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

  if (expectedCount !== null && rows.length !== expectedCount) {
    throw new Error(`Cloud snapshot was incomplete: expected ${expectedCount} rows but received ${rows.length}`);
  }
  if (expectedCount !== null && expectedCount > maxRows) {
    throw new Error('Cloud snapshot exceeds the supported row limit');
  }
  return rows;
};
