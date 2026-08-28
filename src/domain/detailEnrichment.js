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

export const previewItemForRoute = (previewItem, type, id) => {
  if (!previewItem || String(previewItem.id) !== String(id) || String(previewItem.type || type) !== String(type)) return null;
  return previewItem;
};

export const resolveDetailTitle = (details, type, currentTitle = '') => {
  if (!details || typeof details !== 'object') return currentTitle;
  const structuredTitle = details.title && typeof details.title === 'object'
    ? details.title.english || details.title.romaji || details.title.native
    : details.title;
  if (type === 'tv') return details.name || structuredTitle || currentTitle;
  if (type === 'vn' && Array.isArray(details.titles)) {
    const english = details.titles.find(title => title.lang === 'en' || title.lang === 'eng');
    return english?.latin || english?.title || structuredTitle || currentTitle;
  }
  return structuredTitle || details.name || currentTitle;
};

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
