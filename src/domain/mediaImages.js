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

const finiteMetadataNumber = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const selectVnBannerImage = (screenshots) => {
  if (!Array.isArray(screenshots)) return null;

  const candidates = screenshots.map(screenshot => {
    const url = normalizeImageUrl(screenshot?.url);
    const dimensions = Array.isArray(screenshot?.dims)
      ? screenshot.dims
      : Array.isArray(screenshot?.dimensions)
        ? screenshot.dimensions
        : [];
    const width = finiteMetadataNumber(dimensions[0] ?? screenshot?.width);
    const height = finiteMetadataNumber(dimensions[1] ?? screenshot?.height);
    const sexual = finiteMetadataNumber(screenshot?.sexual);
    const violence = finiteMetadataNumber(screenshot?.violence);
    if (!url || !width || !height || width / height < 1.25 || sexual === null || violence === null) return null;
    if (sexual > 0.5 || violence > 1) return null;

    const aspectRatio = width / height;
    return {
      url,
      contentScore: sexual + violence,
      aspectDistance: Math.abs(aspectRatio - (16 / 9)),
      area: width * height,
    };
  }).filter(Boolean);

  candidates.sort((left, right) => (
    left.contentScore - right.contentScore
    || left.aspectDistance - right.aspectDistance
    || right.area - left.area
    || left.url.localeCompare(right.url)
  ));
  return candidates[0]?.url || null;
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
