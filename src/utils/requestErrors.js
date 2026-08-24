export const isIntentionalAbort = error => error?.name === 'AbortError';

export const providerErrorMessage = (error, serviceName) => {
  const service = String(serviceName || 'provider');
  const status = Number(error?.status);
  const detail = String(error?.message || '');
  if (status === 429) return `Rate limit exceeded for ${service}. Please wait a moment.`;
  if (status === 401 || status === 403) return `Access denied by ${service}. API credentials may be invalid.`;
  if (status >= 500) return `${service} server is currently unavailable.`;
  if (/Failed to fetch|NetworkError|CORS/iu.test(detail)) return `Network error. Unable to reach ${service}.`;
  if (status >= 400) return `${service} could not complete this request.`;
  return `Failed to fetch data from ${service}.`;
};

export const isJwtIssuedAtFutureError = error => {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || error?.details || '').toLowerCase();
  return (code === 'PGRST300' || code === 'PGRST3003' || code.startsWith('PGRST30'))
    && message.includes('jwt')
    && message.includes('future');
};

export const retryAfterJwtRefresh = async (operation, refreshSession) => {
  try {
    return await operation();
  } catch (error) {
    if (!isJwtIssuedAtFutureError(error)) throw error;
    const refreshResult = await refreshSession();
    if (refreshResult?.error) throw error;
    return operation();
  }
};
