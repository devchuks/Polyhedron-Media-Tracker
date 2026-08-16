export const parseRetryAfter = (value, now = Date.now()) => {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 120_000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(Math.max(0, timestamp - now), 120_000);
};

export const isTransientError = error => {
  if (!error) return false;
  if (error.name === 'AbortError' && !error.isTimeout) return false;
  if (error.isTimeout || error.name === 'TypeError') return true;
  const status = Number(error.status);
  return status === 408 || status === 425 || status === 429 || status >= 500;
};

export const retryDelayFor = (error, attempt, baseDelay = 500) => {
  if (Number.isFinite(error?.retryAfterMs)) return Math.max(0, Math.min(error.retryAfterMs, 120_000));
  return Math.min(baseDelay * (2 ** attempt), 10_000);
};

export const withRetry = async (operation, {
  retries = 1,
  baseDelay = 500,
  wait = delay => new Promise(resolve => setTimeout(resolve, delay)),
} = {}) => {
  let attempt = 0;
  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= retries || !isTransientError(error)) throw error;
      await wait(retryDelayFor(error, attempt, baseDelay));
      attempt += 1;
    }
  }
};
