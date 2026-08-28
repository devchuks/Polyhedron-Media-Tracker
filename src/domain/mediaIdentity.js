import { normalizeImageUrl, normalizeMediaImageFields } from './mediaImages.js';

export const MEDIA_TYPES = Object.freeze(['tv', 'movies', 'games', 'vn', 'anime', 'manga', 'books', 'comics']);

export const PROVIDER_BY_MEDIA_TYPE = Object.freeze({
  tv: 'tmdb',
  movies: 'tmdb',
  games: 'igdb',
  vn: 'vndb',
  anime: 'anilist',
  manga: 'anilist',
  books: 'openlibrary',
  comics: 'metron',
});

const normalizePart = (value, name) => {
  if (value === null || value === undefined) throw new TypeError(`Missing ${name}`);
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized.includes(':')) throw new TypeError(`Invalid ${name}`);
  return normalized;
};

export const providerForMediaType = (mediaType, explicitProvider) => {
  const type = normalizePart(mediaType, 'media type');
  const provider = explicitProvider || PROVIDER_BY_MEDIA_TYPE[type];
  if (!provider) throw new TypeError(`Unsupported media type: ${type}`);
  return normalizePart(provider, 'provider');
};

export const normalizeProviderId = (providerId, mediaType) => {
  if (providerId === null || providerId === undefined) throw new TypeError('Missing provider identifier');
  let normalized = String(providerId).trim();
  if (!normalized) throw new TypeError('Invalid provider identifier');
  if (mediaType === 'games') normalized = normalized.replace(/^igdb_/i, '');
  if (mediaType === 'books') normalized = normalized.replace(/^\/works\//i, '');
  return normalized;
};

export const createMediaKey = (provider, mediaType, providerId) => {
  const type = normalizePart(mediaType, 'media type');
  return `${providerForMediaType(type, provider)}:${type}:${normalizeProviderId(providerId, type)}`;
};

export const parseMediaKey = (mediaKey) => {
  if (typeof mediaKey !== 'string') return null;
  const first = mediaKey.indexOf(':');
  const second = mediaKey.indexOf(':', first + 1);
  if (first <= 0 || second <= first + 1 || second === mediaKey.length - 1) return null;
  const provider = mediaKey.slice(0, first);
  const mediaType = mediaKey.slice(first + 1, second);
  const providerId = mediaKey.slice(second + 1);
  try {
    const canonical = createMediaKey(provider, mediaType, providerId);
    return canonical === mediaKey ? { provider, mediaType, providerId, mediaKey } : null;
  } catch {
    return null;
  }
};

const getProviderIdFromItem = (item, mediaType) => {
  const parsedKey = parseMediaKey(item?.media_key || item?.mediaKey);
  if (parsedKey) return parsedKey.providerId;
  return item?.provider_id ?? item?.providerId ?? item?.id ?? item?.apiData?.id ?? item?.apiData?.raw?.id;
};

export const canonicalizeMediaItem = (item, category) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Media item must be an object');
  const parsedKey = parseMediaKey(item.media_key || item.mediaKey);
  const mediaType = normalizePart(category || item.media_type || item.mediaType || item.type || parsedKey?.mediaType, 'media type');
  const provider = providerForMediaType(
    mediaType,
    item.provider || item.apiSource || item.apiData?.apiSource || parsedKey?.provider,
  );
  const providerId = normalizeProviderId(getProviderIdFromItem(item, mediaType), mediaType);
  return normalizeMediaImageFields({
    ...item,
    type: mediaType,
    provider,
    provider_id: providerId,
    media_key: createMediaKey(provider, mediaType, providerId),
  });
};

export const canonicalizeLog = (log) => {
  if (!log || typeof log !== 'object' || Array.isArray(log)) throw new TypeError('Diary log must be an object');
  const parsedKey = parseMediaKey(log.media_key || log.mediaKey);
  const mediaType = normalizePart(log.media_type || log.mediaType || parsedKey?.mediaType, 'media type');
  const provider = providerForMediaType(mediaType, log.provider || parsedKey?.provider);
  const providerId = normalizeProviderId(log.provider_id ?? log.providerId ?? parsedKey?.providerId ?? log.media_id ?? log.mediaId, mediaType);
  return {
    ...log,
    image: normalizeImageUrl(log.image),
    media_type: mediaType,
    provider,
    provider_id: providerId,
    media_key: createMediaKey(provider, mediaType, providerId),
  };
};

export const mediaKeyFor = (value, category) => {
  if (typeof value === 'string' && parseMediaKey(value)) return value;
  if (value && typeof value === 'object') {
    if ('media_id' in value || 'media_type' in value) return canonicalizeLog(value).media_key;
    return canonicalizeMediaItem(value, category).media_key;
  }
  if (category) return createMediaKey(providerForMediaType(category), category, value);
  throw new TypeError('Cannot derive canonical media key');
};

export const sameMediaIdentity = (left, right, leftCategory, rightCategory) => {
  try {
    return mediaKeyFor(left, leftCategory) === mediaKeyFor(right, rightCategory);
  } catch {
    return false;
  }
};
