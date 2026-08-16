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
  const status = VALID_STATUSES.has(canonical.status) ? canonical.status : 'planned';
  const rating = Math.min(10, Math.max(0, Number(canonical.rating) || 0));
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

  const media = {};
  for (const category of MEDIA_TYPES) {
    const items = input.media[category] ?? [];
    if (!Array.isArray(items)) throw new TypeError(`Backup ${category} must be an array`);
    if (items.length > MAX_ITEMS_PER_CATEGORY) throw new TypeError(`Backup ${category} exceeds the item limit`);
    media[category] = items.map((item, index) => normalizeItem(item, category, index));
  }
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: input.exportedAt || null,
    media,
    mediaLogs: input.mediaLogs.map(normalizeLog),
  };
};

export const createBackup = (media, mediaLogs) => {
  const normalized = normalizeBackup({ media, mediaLogs });
  return { ...normalized, exportedAt: new Date().toISOString() };
};
