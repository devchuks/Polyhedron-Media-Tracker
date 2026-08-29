export const DISCOVERY_TYPES = ['movies', 'tv', 'anime', 'manga', 'books', 'vn', 'games', 'comics'];
export const DISCOVERY_CACHE_VERSION = 2;

export const DISCOVERY_SECTIONS = Object.freeze({
  movies: [
    { key: 'trending', name: 'Trending This Week', provider: 'TMDB', semantics: 'Weekly movie attention' },
    { key: 'upcoming', name: 'Upcoming Movies', provider: 'TMDB', semantics: 'Highly anticipated movies releasing within the next 18 months, ordered by popularity' },
    { key: 'popular', name: 'Popular Movies', provider: 'TMDB', semantics: 'Current TMDB popularity ranking' },
  ],
  tv: [
    { key: 'trending', name: 'Trending This Week', provider: 'TMDB', semantics: 'Weekly TV attention' },
    { key: 'upcoming', name: 'Currently Airing', provider: 'TMDB', semantics: 'Shows with episodes airing in the current window' },
    { key: 'popular', name: 'Popular TV', provider: 'TMDB', semantics: 'Current TMDB popularity ranking' },
  ],
  anime: [
    { key: 'trending', name: 'Trending Now', provider: 'AniList', semantics: 'AniList trending rank' },
    { key: 'upcoming', name: 'Next Season', provider: 'AniList', semantics: 'Not-yet-released anime in the next season' },
    { key: 'popular', name: 'Most Popular', provider: 'AniList', semantics: 'All-time AniList popularity' },
  ],
  manga: [
    { key: 'trending', name: 'Trending Now', provider: 'AniList', semantics: 'AniList trending rank' },
    { key: 'upcoming', name: 'Upcoming Releases', provider: 'AniList', semantics: 'Not-yet-released manga by popularity' },
    { key: 'popular', name: 'Most Popular', provider: 'AniList', semantics: 'All-time AniList popularity' },
  ],
  books: [
    { key: 'trending', name: 'Trending This Week', provider: 'Open Library', semantics: 'Works trending in Open Library reading activity' },
    { key: 'upcoming', name: 'Recently Published', provider: 'Open Library', semantics: 'Recently published works ordered newest first' },
    { key: 'popular', name: 'Most Read', provider: 'Open Library', semantics: 'Works ordered by reading-log activity' },
  ],
  vn: [
    { key: 'trending', name: 'Recently Released', provider: 'VNDB', semantics: 'Released visual novels ordered newest first' },
    { key: 'upcoming', name: 'Upcoming Releases', provider: 'VNDB', semantics: 'Future-dated visual novels ordered by release date' },
    { key: 'popular', name: 'Top Rated', provider: 'VNDB', semantics: 'Bayesian rating with a minimum vote count' },
  ],
  games: [
    { key: 'trending', name: 'New Releases', provider: 'IGDB', semantics: 'Games released in the last 90 days, newest first' },
    { key: 'upcoming', name: 'Most Anticipated', provider: 'IGDB', semantics: 'Future releases ordered by hype' },
    { key: 'popular', name: 'Top Rated', provider: 'IGDB', semantics: 'Total rating with a meaningful rating-count threshold' },
  ],
  comics: [
    { key: 'trending', name: 'In Stores This Week', provider: 'Metron', semantics: 'Issues with store dates in the current week' },
    { key: 'upcoming', name: 'In Stores Next Week', provider: 'Metron', semantics: 'Issues with store dates next week' },
    { key: 'popular', name: 'Later Releases', provider: 'Metron', semantics: 'Subsequent announced issues ordered by store date' },
  ],
});

export const tmdbDiscoveryRequest = (type, section, page = 1, today = new Date()) => {
  const mediaType = type === 'movies' ? 'movie' : 'tv';
  if (section === 'trending') return { path: `/trending/${mediaType}/week`, query: { page } };
  if (section === 'popular') return { path: `/${mediaType}/popular`, query: { page } };
  if (type === 'tv') return { path: '/tv/on_the_air', query: { page } };
  const date = new Date(today);
  const horizon = new Date(date);
  horizon.setUTCMonth(horizon.getUTCMonth() + 18);
  return {
    path: '/discover/movie',
    query: {
      page,
      include_adult: false,
      'primary_release_date.gte': date.toISOString().slice(0, 10),
      'primary_release_date.lte': horizon.toISOString().slice(0, 10),
      sort_by: 'popularity.desc',
    },
  };
};

export const sectionState = ({ loading, items, error }) => {
  if (loading && !(items?.length)) return 'loading';
  if (error) return 'error';
  if (!(items?.length)) return 'empty';
  return loading ? 'updating' : 'ready';
};
