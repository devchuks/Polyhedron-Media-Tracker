import { parseRetryAfter } from './retry.js';

export class ApiError extends Error {
  constructor(message, { status = 0, body = null, retryAfterMs = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
}

const parseResponseBody = async response => {
  if (response.status === 204 || response.status === 205) return null;
  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    try { return JSON.parse(text); }
    catch (error) { throw new ApiError('The API returned malformed JSON.', { status: response.status, body: text.slice(0, 1_000), cause: error }); }
  }
  return text;
};

export const apiClient = async (url, options = {}) => {
  const { timeoutMs = 15_000, signal: callerSignal, ...fetchOptions } = options;
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) forwardAbort();
  else callerSignal?.addEventListener('abort', forwardAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        ...fetchOptions.headers,
      },
    });

    const body = await parseResponseBody(response);

    if (!response.ok) {
      const message = typeof body === 'object' && body?.error
        ? String(body.error)
        : `API request failed with status ${response.status}.`;
      throw new ApiError(message, {
        status: response.status,
        body,
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
      });
    }

    return body;
  } catch (error) {
    if (timedOut) {
      const timeoutError = new ApiError(`API request timed out after ${timeoutMs}ms.`, { status: 408, cause: error });
      timeoutError.isTimeout = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', forwardAbort);
  }
};
