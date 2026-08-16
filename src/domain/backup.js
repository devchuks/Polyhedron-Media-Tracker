import { canonicalizeLog, canonicalizeMediaItem, MEDIA_TYPES } from './mediaIdentity.js';
import { safeExternalUrl } from '../utils/urlSafety.js';

export const BACKUP_SCHEMA_VERSION = 2;
const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const MAX_ITEMS_PER_CATEGORY = 20_000;
const VALID_STATUSES = new Set(['planned', 'in progress', 'completed', 'dropped']);

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const optionalTime = value => {
  if (value === null || value === undefined || value === '') return null;
  const time = Number(value);
  return Number.isFinite(time) ? time : null;
};

const normalizeItem = (item, category, index) => {
  if (!isObject(item)) throw new TypeError(`Invalid ${category} item at index ${index}`);
  if (item.id === null || item.id === undefined || String(item.id).trim() === '') {
    throw new TypeError(`Missing identifier for ${category} item at index ${index}`);
  }
  const canonical = canonicalizeMediaItem(item, category);
  if (canonical.status != null && !VALID_STATUSES.has(canonical.status)) {
    throw new TypeError(`Invalid status for ${category} item at index ${index}`);
  }
  const status = canonical.status || 'planned';
  const rating = canonical.rating == null ? 0 : Number(canonical.rating);
  if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
    throw new TypeError(`Invalid rating for ${category} item at index ${index}`);
  }
  for (const dateField of ['addedAt', 'dateStarted', 'dateCompleted']) {
    if (canonical[dateField] != null && canonical[dateField] !== '' && optionalTime(canonical[dateField]) === null) {
      throw new TypeError(`Invalid ${dateField} for ${category} item at index ${index}`);
    }
  }
  const completionDate = optionalTime(canonical.dateCompleted);
  if (status === 'completed' && completionDate === null) {
    throw new TypeError(`Completed ${category} item at index ${index} is missing a completion date`);
  }
  const apiData = isObject(canonical.apiData) ? { ...canonical.apiData } : {};
  if (apiData.url) apiData.url = safeExternalUrl(apiData.url);
  return {
    ...canonical,
    title: String(canonical.title || 'Unknown Title').slice(0, 1_000),
    status,
    rating,
    addedAt: optionalTime(canonical.addedAt) ?? Date.now(),
    dateStarted: optionalTime(canonical.dateStarted),
    dateCompleted: status === 'completed' ? completionDate : null,
    readIssueIds: Array.isArray(canonical.readIssueIds) ? [...new Set(canonical.readIssueIds.map(String))] : [],
    apiData,
  };
};

const normalizeLog = (log, index) => {
  if (!isObject(log)) throw new TypeError(`Invalid mediaLogs entry at index ${index}`);
  if (!log.log_id) throw new TypeError(`Missing log identifier at index ${index}`);
  const canonical = canonicalizeLog(log);
  const date = new Date(canonical.log_date);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`Invalid log date at index ${index}`);
  return {
    ...canonical,
    log_id: String(canonical.log_id),
    log_date: date.toISOString(),
    review_text: String(canonical.review_text || '').slice(0, 100_000),
  };
};

export const normalizeBackup = input => {
  if (!isObject(input)) throw new TypeError('Backup must be an object');
  const serializedLength = JSON.stringify(input).length;
  if (serializedLength > MAX_BACKUP_BYTES) throw new TypeError('Backup is too large');
  if (!isObject(input.media)) throw new TypeError('Backup media must be an object');
  if (!Array.isArray(input.mediaLogs)) throw new TypeError('Backup mediaLogs must be an array');
  if (Number(input.schemaVersion) > BACKUP_SCHEMA_VERSION) throw new TypeError('Backup schema version is newer than this application');
  const unknownCategories = Object.keys(input.media).filter(category => !MEDIA_TYPES.includes(category));
  if (unknownCategories.length) throw new TypeError(`Backup contains unsupported media categories: ${unknownCategories.join(', ')}`);

  const media = {};
  const mediaKeys = new Set();
  for (const category of MEDIA_TYPES) {
    const items = input.media[category] ?? [];
    if (!Array.isArray(items)) throw new TypeError(`Backup ${category} must be an array`);
    if (items.length > MAX_ITEMS_PER_CATEGORY) throw new TypeError(`Backup ${category} exceeds the item limit`);
    media[category] = items.map((item, index) => normalizeItem(item, category, index));
    for (const item of media[category]) {
      if (mediaKeys.has(item.media_key)) throw new TypeError(`Backup contains duplicate media identity ${item.media_key}`);
      mediaKeys.add(item.media_key);
    }
  }
  const mediaLogs = input.mediaLogs.map(normalizeLog);
  const logIds = new Set();
  for (const log of mediaLogs) {
    if (logIds.has(log.log_id)) throw new TypeError(`Backup contains duplicate log identifier ${log.log_id}`);
    if (!mediaKeys.has(log.media_key)) throw new TypeError(`Backup contains orphan log ${log.log_id}`);
    logIds.add(log.log_id);
  }
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: input.exportedAt || null,
    media,
    mediaLogs,
  };
};

export const createBackup = (media, mediaLogs) => {
  const normalized = normalizeBackup({ media, mediaLogs });
  return { ...normalized, exportedAt: new Date().toISOString() };
};
