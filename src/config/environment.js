export const shouldShowEnvironmentBadge = (environment, isDevelopment) => {
  const normalized = String(environment || '').trim().toUpperCase();
  return Boolean(isDevelopment && normalized && normalized !== 'PRODUCTION');
};

const readAppEnvironment = () => {
  try { return import.meta.env.VITE_APP_ENVIRONMENT; }
  catch { return ''; }
};

const readDevelopmentFlag = () => {
  try { return import.meta.env.DEV; }
  catch { return false; }
};

export const appEnvironment = String(readAppEnvironment() || '').trim().toUpperCase();
export const showEnvironmentBadge = shouldShowEnvironmentBadge(appEnvironment, readDevelopmentFlag());
