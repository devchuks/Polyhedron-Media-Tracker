export const isIntentionalAbort = error => error?.name === 'AbortError';

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
