export const getCachedValue = (cache, key, now = Date.now()) => {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (!entry.expiresAt || entry.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
};

export const setCachedValue = (cache, key, value, { ttlMs = 30 * 60_000, limit = 50, now = Date.now() } = {}) => {
  if (cache.has(key)) cache.delete(key);
  while (cache.size >= limit) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
};

export const mapWithConcurrency = async (values, limit, mapper) => {
  const items = Array.from(values || []);
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('Concurrency limit must be a positive integer');
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

export const collectPaginatedResults = async (fetchPage, {
  expectedCount = null,
  pageSize = 100,
  maxPages = 50,
  keyFor = item => item?.id,
} = {}) => {
  if (typeof fetchPage !== 'function') throw new TypeError('fetchPage must be a function');
  const items = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetchPage(page, pageSize);
    const rows = Array.isArray(response?.results) ? response.results : [];
    for (const item of rows) {
      const key = String(keyFor(item) ?? `${page}:${items.length}`);
      if (!seen.has(key)) {
        seen.add(key);
        items.push(item);
      }
    }
    const declaredCount = Number(response?.count ?? expectedCount);
    if (!rows.length || rows.length < pageSize || (Number.isFinite(declaredCount) && items.length >= declaredCount)) break;
  }
  return items;
};
