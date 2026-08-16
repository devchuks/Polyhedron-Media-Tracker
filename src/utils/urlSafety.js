const CONTROL_OR_SPACE = /[\u0000-\u001f\u007f]/;

export const safeExternalUrl = (value, options = {}) => {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate || CONTROL_OR_SPACE.test(candidate)) return null;
  const allowedProtocols = options.allowedProtocols || ['https:', 'http:'];
  const isRelative = candidate.startsWith('/');
  if (isRelative && !options.relativeBase) return null;
  try {
    const parsed = isRelative ? new URL(candidate, options.relativeBase) : new URL(candidate);
    if (!allowedProtocols.includes(parsed.protocol.toLowerCase())) return null;
    return parsed.href;
  } catch {
    return null;
  }
};

export const safeProviderUrl = (value, expectedHosts = []) => {
  const safe = safeExternalUrl(value);
  if (!safe) return null;
  if (!expectedHosts.length) return safe;
  const hostname = new URL(safe).hostname.toLowerCase();
  return expectedHosts.some(host => hostname === host || hostname.endsWith(`.${host}`)) ? safe : null;
};
