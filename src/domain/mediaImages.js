const IMAGE_VALUE_KEYS = ['url', 'thumbnail', 'image', 'src', 'extraLarge', 'large', 'medium', 'small', 'original'];

const parseEmbeddedImageValue = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('"'))) return trimmed;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
};

const isUsableImageUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export const normalizeImageUrl = (value, seen = new Set()) => {
  const parsed = parseEmbeddedImageValue(value);
  if (typeof parsed === 'string') return isUsableImageUrl(parsed) ? parsed.trim() : null;
  if (!parsed || typeof parsed !== 'object' || seen.has(parsed)) return null;

  seen.add(parsed);
  for (const key of IMAGE_VALUE_KEYS) {
    const normalized = normalizeImageUrl(parsed[key], seen);
    if (normalized) return normalized;
  }
  return null;
};

export const firstUsableImageUrl = (...values) => {
  for (const value of values) {
    const normalized = normalizeImageUrl(value);
    if (normalized) return normalized;
  }
  return null;
};

export const normalizeMediaImageFields = (item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const hasTopLevelImage = Object.prototype.hasOwnProperty.call(item, 'image');
  const hasNestedImage = Boolean(item.apiData && Object.prototype.hasOwnProperty.call(item.apiData, 'image'));
  const image = firstUsableImageUrl(item.image, item.apiData?.image);
  const apiData = item.apiData && typeof item.apiData === 'object'
    ? {
        ...item.apiData,
        ...(hasNestedImage || image ? { image: firstUsableImageUrl(item.apiData.image, image) } : {}),
      }
    : item.apiData;
  return {
    ...item,
    ...(hasTopLevelImage || hasNestedImage ? { image } : {}),
    ...(apiData === undefined ? {} : { apiData }),
  };
};

export const preserveUsableMediaImage = (primary, fallback) => {
  if (!primary || typeof primary !== 'object' || Array.isArray(primary)) return primary;
  const image = firstUsableImageUrl(
    primary.image,
    primary.apiData?.image,
    fallback?.image,
    fallback?.apiData?.image,
  );
  const apiData = primary.apiData && typeof primary.apiData === 'object' && !Array.isArray(primary.apiData)
    ? { ...primary.apiData, ...(image ? { image: firstUsableImageUrl(primary.apiData.image, image) } : {}) }
    : primary.apiData;
  return {
    ...primary,
    image,
    ...(apiData === undefined ? {} : { apiData }),
  };
};

export { isUsableImageUrl };
