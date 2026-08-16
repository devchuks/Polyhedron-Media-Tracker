import { safeExternalUrl } from './urlSafety.js';

export const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const safeLink = (url, label) => {
  const href = safeExternalUrl(url, { relativeBase: 'https://vndb.org' });
  return href
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : escapeHtml(label);
};

export const formatSafeMarkup = (input) => {
  if (!input) return '';
  const links = [];
  const token = html => {
    const index = links.push(html) - 1;
    return `\u0000POLY_LINK_${index}\u0000`;
  };

  let source = String(input).replaceAll('\u0000', '');
  source = source.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (_match, label, url) => token(safeLink(url, label)));
  source = source.replace(/\[url=(.*?)\](.*?)\[\/url\]/gis, (_match, url, label) => token(safeLink(url.replace(/^["']|["']$/g, ''), label)));
  source = source.replace(/\[url\](.*?)\[\/url\]/gis, (_match, url) => token(safeLink(url.replace(/^["']|["']$/g, ''), url)));

  let formatted = escapeHtml(source);
  const replacements = [
    [/\[b\](.*?)\[\/b\]/gis, '<strong>$1</strong>'],
    [/\[i\](.*?)\[\/i\]/gis, '<em>$1</em>'],
    [/\[u\](.*?)\[\/u\]/gis, '<u>$1</u>'],
    [/\[s\](.*?)\[\/s\]/gis, '<s>$1</s>'],
    [/\[spoiler\](.*?)\[\/spoiler\]/gis, '<span class="bg-base-content/20 text-transparent hover:text-base-content transition-colors px-1 rounded cursor-help" title="Spoiler">$1</span>'],
    [/\[quote\](.*?)\[\/quote\]/gis, '<blockquote class="border-l-2 border-primary/50 pl-2 italic my-1">$1</blockquote>'],
  ];
  for (const [pattern, replacement] of replacements) formatted = formatted.replace(pattern, replacement);
  links.forEach((link, index) => {
    formatted = formatted.replace(`\u0000POLY_LINK_${index}\u0000`, link);
  });
  return formatted;
};
