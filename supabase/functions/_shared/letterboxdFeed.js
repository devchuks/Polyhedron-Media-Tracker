// Parses a public Letterboxd RSS feed (https://letterboxd.com/<user>/rss/) into diary entries.
// Only film diary entries are returned (lists and other items have no watched date or TMDB id).

const USERNAME = /^[A-Za-z0-9_]{1,40}$/u;

export const assertLetterboxdUsername = value => {
  const username = String(value || '').trim()
    .replace(/^https?:\/\/(www\.)?letterboxd\.com\//iu, '')
    .replace(/\/.*$/u, '');
  if (!USERNAME.test(username)) throw new TypeError('Invalid Letterboxd username');
  return username;
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decodeEntities = text => String(text || '')
  .replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .replace(/&#(\d+);/gu, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
  .replace(/&([a-z#0-9]+);/giu, (match, name) => ENTITIES[name.toLowerCase()] ?? match);

const tag = (xml, name) => {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'u'));
  if (!match) return '';
  return match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/u, '$1').trim();
};

// The review is the description without the poster, the spoiler notice, or the
// "Watched on …" line Letterboxd writes when there is no review.
export const letterboxdReviewText = descriptionHtml => {
  const paragraphs = String(descriptionHtml || '')
    .split(/<\/p>/iu)
    .map(part => part
      .replace(/<img[^>]*>/giu, '')
      .replace(/<br\s*\/?>/giu, '\n')
      .replace(/<[^>]+>/gu, '')
      .trim())
    .map(decodeEntities)
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => !/^This review may contain spoilers\.?$/iu.test(part));
  if (paragraphs.length === 1 && /^Watched on .+\.$/iu.test(paragraphs[0])) return '';
  return paragraphs.join('\n\n');
};

export const parseLetterboxdFeed = xml => {
  const entries = [];
  for (const [, item] of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gu)) {
    const tmdbId = tag(item, 'tmdb:movieId');
    const watchedDate = tag(item, 'letterboxd:watchedDate');
    if (!/^\d+$/u.test(tmdbId) || !/^\d{4}-\d{2}-\d{2}$/u.test(watchedDate)) continue;
    const guid = tag(item, 'guid');
    const rating = Number.parseFloat(tag(item, 'letterboxd:memberRating'));
    const description = tag(item, 'description');
    entries.push({
      guid,
      tmdbId,
      watchedDate,
      rewatch: /^yes$/iu.test(tag(item, 'letterboxd:rewatch')),
      rating: Number.isFinite(rating) && rating > 0 ? Math.round(rating * 2) : 0,
      title: decodeEntities(tag(item, 'letterboxd:filmTitle')),
      year: tag(item, 'letterboxd:filmYear'),
      review: letterboxdReviewText(description),
      poster: (description.match(/<img[^>]+src="([^"]+)"/u) || [])[1] || null,
      link: tag(item, 'link'),
      publishedAt: Date.parse(tag(item, 'pubDate')) || null,
    });
  }
  return entries;
};
