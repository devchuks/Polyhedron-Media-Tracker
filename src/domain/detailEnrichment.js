import { isIntentionalAbort } from '../utils/requestErrors.js';

export const hasUsableMetadata = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== '';
};

export const shouldShowMetadataSkeleton = (isPending, currentValue) => (
  Boolean(isPending) && !hasUsableMetadata(currentValue)
);

export const isDetailEnrichmentPending = (state, routeKey) => (
  state?.routeKey === routeKey && state?.phase === 'pending'
);

export const runSettlingDetailRequest = async ({ load, isCurrent, onResolved }) => {
  try {
    const value = await load();
    if (!isCurrent()) return { outcome: 'stale', value: null };
    if (!value) return { outcome: 'empty', value: null };
    await onResolved(value);
    return { outcome: 'resolved', value };
  } catch (error) {
    if (!isCurrent()) return { outcome: 'stale', value: null };
    return { outcome: isIntentionalAbort(error) ? 'aborted' : 'rejected', value: null, error };
  }
};
