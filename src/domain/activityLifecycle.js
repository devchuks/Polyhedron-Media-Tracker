const finiteTimestamp = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const activityTimestamp = (value, fallback = Date.now()) => (
  finiteTimestamp(value) ?? finiteTimestamp(fallback) ?? Date.now()
);

export const isMeaningfulProgress = (value) => {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  const normalized = String(value).trim();
  if (!normalized || /^S\d+\s*E0+$/iu.test(normalized)) return false;
  const numeric = Number.parseFloat(normalized.replace(/[^0-9.]/gu, ''));
  return Number.isFinite(numeric) && numeric > 0;
};

export const applyActivityLifecycle = (item = {}, {
  status = item.status,
  activityAt = Date.now(),
  explicitStartedAt,
  allowStartedEdit = false,
  provesConsumption = false,
  completesItem = false,
} = {}) => {
  const eventTime = activityTimestamp(activityAt);
  const nextStatus = String(status || '').trim().toLowerCase();
  const existingStarted = finiteTimestamp(item.dateStarted);
  const explicitStarted = finiteTimestamp(explicitStartedAt);

  let dateStarted = existingStarted;
  if (allowStartedEdit && explicitStartedAt !== undefined) {
    dateStarted = explicitStarted;
  }
  if (dateStarted === null && (provesConsumption || completesItem)) {
    dateStarted = explicitStarted ?? eventTime;
  }

  let dateCompleted = finiteTimestamp(item.dateCompleted);
  if (completesItem || (nextStatus === 'completed' && dateCompleted === null)) {
    dateCompleted = eventTime;
  } else if (nextStatus && nextStatus !== 'completed') {
    dateCompleted = null;
  }

  return {
    ...item,
    status: nextStatus || item.status,
    addedAt: finiteTimestamp(item.addedAt) ?? eventTime,
    dateStarted,
    dateCompleted,
  };
};

export const diaryActionForType = (type, rewatch = false) => {
  const base = ['games', 'vn'].includes(type)
    ? 'PLAYED'
    : ['manga', 'books', 'comics'].includes(type)
      ? 'READ'
      : 'WATCHED';
  return rewatch ? `RE-${base}` : base;
};
