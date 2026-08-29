const decodeEntity = (entity) => {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  const key = entity.toLowerCase();
  if (Object.hasOwn(named, key)) return named[key];

  const numeric = key.startsWith('#x')
    ? Number.parseInt(key.slice(2), 16)
    : key.startsWith('#')
      ? Number.parseInt(key.slice(1), 10)
      : Number.NaN;
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0x10ffff) return `&${entity};`;
  return String.fromCodePoint(numeric);
};

const decodeHtmlEntities = (value) => value.replace(/&(#x?[0-9a-f]+|amp|apos|gt|lt|nbsp|quot);/giu, (_match, entity) => decodeEntity(entity));

export const plainTextFromMarkup = (value) => {
  if (!value) return '';

  let text = String(value).replace(/\r\n?/g, '\n');
  // Some cached/provider descriptions contain backslashes before otherwise valid HTML tags.
  text = text.replace(/\\+(?=<\/?[a-z][^>]*>)/giu, '');
  text = decodeHtmlEntities(text);
  text = text
    .replace(/<(script|style)(?:\s[^>]*)?>[\s\S]*?<\/\1>/giu, '')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/(?:blockquote|div|h[1-6]|li|p)>/giu, '\n')
    .replace(/<li(?:\s[^>]*)?>/giu, '• ')
    .replace(/<[^>]*>/gu, '')
    .replace(/[\t\f\v ]+\n/gu, '\n')
    .replace(/\n[\t\f\v ]+/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  return decodeHtmlEntities(text);
};
