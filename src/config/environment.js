export const shouldShowEnvironmentBadge = (environment, isDevelopment) => {
  const normalized = String(environment || '').trim().toUpperCase();
  return Boolean(isDevelopment && normalized && normalized !== 'PRODUCTION');
};

const viteEnvironment = import.meta.env || {};

export const appEnvironment = String(viteEnvironment.VITE_APP_ENVIRONMENT || '').trim().toUpperCase();
export const showEnvironmentBadge = shouldShowEnvironmentBadge(appEnvironment, viteEnvironment.DEV);
