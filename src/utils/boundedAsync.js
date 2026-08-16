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
