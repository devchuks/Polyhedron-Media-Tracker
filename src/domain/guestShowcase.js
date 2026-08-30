import { canonicalizeLog, canonicalizeMediaItem, MEDIA_TYPES } from './mediaIdentity.js';

export const GUEST_SHOWCASE_VERSION = 1;
export const GUEST_SHOWCASE_MARKER = 'polyhedron-guest-showcase-version';

export const readGuestShowcaseVersion = storage => {
  try { return Number(storage?.getItem(GUEST_SHOWCASE_MARKER)) || 0; }
  catch { return 0; }
};

export const markGuestShowcaseInitialized = storage => {
  try { storage?.setItem(GUEST_SHOWCASE_MARKER, String(GUEST_SHOWCASE_VERSION)); }
  catch { /* IndexedDB remains the durable fallback when localStorage is unavailable. */ }
};

const at = value => Date.parse(`${value}T20:00:00.000Z`);
const fixture = (type, item) => canonicalizeMediaItem({
  ...item,
  type,
  subtype: type,
  isGuestShowcase: true,
  rewatchCount: 0,
  readIssueIds: item.readIssueIds || [],
  updatedAt: item.dateCompleted || item.dateStarted || item.addedAt,
}, type);

const media = [
  fixture('movies', {
    id: '157336', provider: 'tmdb', provider_id: '157336', title: 'Interstellar', year: 2014,
    status: 'completed', progress: '169 Minutes', rating: 9,
    addedAt: at('2025-01-04'), dateStarted: at('2025-01-08'), dateCompleted: at('2025-01-11'),
    image: 'https://image.tmdb.org/t/p/w500/yQvGrMoipbRoddT0ZR8tPoR7NfX.jpg',
    description: "The adventures of explorers who use a wormhole to surpass the limitations on human space travel.",
    apiData: {
      id: '157336', title: 'Interstellar', type: 'movies', year: 2014,
      image: 'https://image.tmdb.org/t/p/w500/yQvGrMoipbRoddT0ZR8tPoR7NfX.jpg',
      description: "The adventures of explorers who use a wormhole to surpass the limitations on human space travel.",
      url: 'https://www.themoviedb.org/movie/157336', apiSource: 'tmdb',
      raw: { id: 157336, runtime: 169, release_date: '2014-11-05', backdrop_path: '/vgnoBSVzWAV9sNQUORaDGvDp7wx.jpg', genres: [{ name: 'Adventure' }, { name: 'Drama' }, { name: 'Science Fiction' }] },
    },
  }),
  fixture('tv', {
    id: '73107', provider: 'tmdb', provider_id: '73107', title: 'Barry', year: 2018,
    status: 'in progress', progress: 'S03 E04', rating: 9,
    addedAt: at('2025-02-01'), dateStarted: at('2025-02-02'), dateCompleted: null,
    image: 'https://image.tmdb.org/t/p/w500/j1XpwD11f0BAEI7pX6UdMhUVX2F.jpg',
    description: 'A disillusioned hitman discovers an acting community in Los Angeles.',
    apiData: {
      id: '73107', title: 'Barry', type: 'tv', year: 2018,
      image: 'https://image.tmdb.org/t/p/w500/j1XpwD11f0BAEI7pX6UdMhUVX2F.jpg',
      description: 'A disillusioned hitman discovers an acting community in Los Angeles.',
      url: 'https://www.themoviedb.org/tv/73107', apiSource: 'tmdb',
      raw: {
        id: 73107, first_air_date: '2018-03-25', number_of_seasons: 4, number_of_episodes: 32,
        backdrop_path: '/nfjqhuGFUWqJD14B4fxlSiZWfeR.jpg',
        seasons: [
          { id: 89613, season_number: 1, name: 'Season 1', air_date: '2018-03-25', episode_count: 8 },
          { id: 122239, season_number: 2, name: 'Season 2', air_date: '2019-03-31', episode_count: 8 },
          { id: 203070, season_number: 3, name: 'Season 3', air_date: '2022-04-24', episode_count: 8 },
          { id: 289507, season_number: 4, name: 'Season 4', air_date: '2023-04-16', episode_count: 8 },
        ],
      },
    },
  }),
  fixture('anime', {
    id: '30', provider: 'anilist', provider_id: '30', title: 'Neon Genesis Evangelion', year: 1995,
    status: 'completed', progress: '26 Episodes', rating: 10,
    addedAt: at('2025-03-01'), dateStarted: at('2025-03-02'), dateCompleted: at('2025-03-20'),
    image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx30-AI1zr74Dh4ye.jpg',
    description: 'Teen pilots defend a fortified Tokyo against mysterious beings known as Angels.',
    apiData: {
      id: '30', title: 'Neon Genesis Evangelion', type: 'anime', year: 1995,
      image: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx30-AI1zr74Dh4ye.jpg',
      description: 'Teen pilots defend a fortified Tokyo against mysterious beings known as Angels.',
      url: 'https://anilist.co/anime/30', apiSource: 'anilist',
      raw: { id: 30, episodes: 26, seasonYear: 1995, bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/30-gEMoHHIqxDgN.jpg', studios: { nodes: [{ name: 'Gainax' }] } },
    },
  }),
  fixture('manga', {
    id: '87170', provider: 'anilist', provider_id: '87170', title: 'Fire Punch', year: 2016,
    status: 'in progress', progress: '37 Chapters', rating: 8,
    addedAt: at('2025-04-01'), dateStarted: at('2025-04-03'), dateCompleted: null,
    image: 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx87170-nyuwcN7rU4pc.jpg',
    description: 'In a frozen world, a young man with regenerative powers is consumed by an unending flame.',
    apiData: {
      id: '87170', title: 'Fire Punch', type: 'manga', year: 2016,
      image: 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx87170-nyuwcN7rU4pc.jpg',
      description: 'In a frozen world, a young man with regenerative powers is consumed by an unending flame.',
      url: 'https://anilist.co/manga/87170', apiSource: 'anilist',
      raw: { id: 87170, chapters: 83, volumes: 8, startDate: { year: 2016 }, bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/manga/banner/87170-gsBzHdIHoyEk.jpg' },
    },
  }),
  fixture('books', {
    id: 'OL32195W', provider: 'openlibrary', provider_id: 'OL32195W', title: 'House of Leaves', year: 1998,
    status: 'completed', progress: '', rating: 9,
    addedAt: at('2025-05-01'), dateStarted: at('2025-05-04'), dateCompleted: at('2025-05-28'),
    image: 'https://covers.openlibrary.org/b/id/6450442-L.jpg',
    description: 'A typographically experimental novel about a house that is larger inside than outside.',
    apiData: {
      id: 'OL32195W', title: 'House of Leaves', type: 'books', year: 1998,
      image: 'https://covers.openlibrary.org/b/id/6450442-L.jpg',
      description: 'A typographically experimental novel about a house that is larger inside than outside.',
      url: 'https://openlibrary.org/works/OL32195W', apiSource: 'openlibrary',
      raw: { key: '/works/OL32195W', workId: 'OL32195W', cover_i: 6450442, authors: [{ name: 'Mark Z. Danielewski' }], first_publish_year: 1998 },
    },
  }),
  fixture('vn', {
    id: 'v54897', provider: 'vndb', provider_id: 'v54897', title: 'The Hundred Line: Last Defense Academy', year: 2025,
    status: 'in progress', progress: '42%', rating: 8,
    addedAt: at('2025-06-01'), dateStarted: at('2025-06-02'), dateCompleted: null,
    image: 'https://t.vndb.org/cv/44/104144.jpg',
    description: 'Students defend their academy for one hundred days in a branching tactical adventure.',
    apiData: {
      id: 'v54897', title: 'The Hundred Line: Last Defense Academy', type: 'vn', year: 2025,
      image: 'https://t.vndb.org/cv/44/104144.jpg',
      description: 'Students defend their academy for one hundred days in a branching tactical adventure.',
      url: 'https://vndb.org/v54897', apiSource: 'vndb',
      raw: { id: 'v54897', title: 'HUNDRED LINE -Saishuu Bouei Gakuen-', alttitle: 'The Hundred Line -Last Defense Academy-', released: '2025-04-24', developers: [{ name: 'Media.Vision' }], image: { url: 'https://t.vndb.org/cv/44/104144.jpg' } },
    },
  }),
  fixture('games', {
    id: 'igdb_185246', provider: 'igdb', provider_id: '185246', title: 'Alan Wake 2', year: 2023,
    status: 'completed', progress: '100%', rating: 9,
    addedAt: at('2025-07-01'), dateStarted: at('2025-07-02'), dateCompleted: at('2025-07-20'),
    image: 'https://images.igdb.com/igdb/image/upload/t_720p/co6jar.jpg',
    description: 'A survival-horror mystery following a trapped writer and an FBI agent investigating ritual murders.',
    apiData: {
      id: 'igdb_185246', title: 'Alan Wake 2', type: 'games', year: 2023,
      image: 'https://images.igdb.com/igdb/image/upload/t_720p/co6jar.jpg',
      description: 'A survival-horror mystery following a trapped writer and an FBI agent investigating ritual murders.',
      url: 'https://www.igdb.com/games/alan-wake-ii', apiSource: 'igdb',
      raw: { id: 185246, name: 'Alan Wake II', first_release_date: 1698364800, cover: { image_id: 'co6jar' }, artworks: [{ image_id: 'ar3nuh' }], genres: [{ name: 'Shooter' }, { name: 'Adventure' }] },
    },
  }),
  fixture('comics', {
    id: 'series_8082', provider: 'metron', provider_id: 'series_8082', title: 'The Power Fantasy', year: 2024,
    status: 'in progress', progress: '5 Issues', rating: 8,
    addedAt: at('2025-08-01'), dateStarted: at('2025-08-07'), dateCompleted: null,
    readIssueIds: ['125499', '125500', '125501', '129376', '129377'],
    image: 'https://static.metron.cloud/media/issue/2024/07/29/ec7846b809944a32866e61ada2bcb930.jpg',
    description: 'Six superpowered people could destroy the world; the challenge is persuading them not to.',
    apiData: {
      id: 'series_8082', title: 'The Power Fantasy', type: 'comics', year: 2024,
      image: 'https://static.metron.cloud/media/issue/2024/07/29/ec7846b809944a32866e61ada2bcb930.jpg',
      description: 'Six superpowered people could destroy the world; the challenge is persuading them not to.',
      url: 'https://metron.cloud/series/the-power-fantasy', apiSource: 'metron',
      raw: {
        id: 8082, name: 'The Power Fantasy', issue_count: 16, issuesCount: 16, publisher: { name: 'Image Comics' },
        issue_details: [
          { id: 125499, number: '1' }, { id: 125500, number: '2' }, { id: 125501, number: '3' }, { id: 129376, number: '4' },
          { id: 129377, number: '5' }, { id: 135525, number: '6' }, { id: 135526, number: '7' }, { id: 135527, number: '8' },
          { id: 142533, number: '9' }, { id: 144261, number: '10' }, { id: 150168, number: '11' }, { id: 153299, number: '12' },
          { id: 153300, number: '13' }, { id: 156358, number: '14' }, { id: 158456, number: '15' }, { id: 158457, number: '16' },
        ],
      },
    },
  }),
];

const log = (mediaItem, suffix, entry) => canonicalizeLog({
  log_id: `guest:${mediaItem.media_key}:${suffix}`,
  media_id: mediaItem.provider_id,
  media_type: mediaItem.type,
  provider: mediaItem.provider,
  provider_id: mediaItem.provider_id,
  media_key: mediaItem.media_key,
  image: mediaItem.image,
  updatedAt: Date.parse(entry.log_date),
  review_text: '',
  season_label: null,
  season_year: null,
  ...entry,
});

const byTitle = title => media.find(item => item.title === title);
const logs = [
  log(byTitle('Interstellar'), 'watched-2025-01-11', { action_type: 'WATCHED', log_date: '2025-01-11T20:00:00.000Z', review_text: 'Vast, intimate, and even better on a quiet night.' }),
  log(byTitle('Barry'), 'season-1-2025-02-09', { action_type: 'WATCHED', log_date: '2025-02-09T20:00:00.000Z', season_label: 'Season 1', season_year: '2018', review_text: 'The comedy and dread sharpen each other.' }),
  log(byTitle('Barry'), 'season-2-2025-02-16', { action_type: 'WATCHED', log_date: '2025-02-16T20:00:00.000Z', season_label: 'Season 2', season_year: '2019', review_text: 'A darker, stranger second act.' }),
  log(byTitle('Neon Genesis Evangelion'), 'watched-2025-03-20', { action_type: 'WATCHED', log_date: '2025-03-20T20:00:00.000Z', review_text: 'A raw character study inside a giant-robot apocalypse.' }),
  log(byTitle('Fire Punch'), 'note-2025-04-10', { action_type: 'LOGGED', log_date: '2025-04-10T20:00:00.000Z', review_text: 'The frozen-world premise keeps mutating in unsettling ways.' }),
  log(byTitle('House of Leaves'), 'read-2025-05-28', { action_type: 'READ', log_date: '2025-05-28T20:00:00.000Z', review_text: 'The page itself becomes part of the labyrinth.' }),
  log(byTitle('The Hundred Line: Last Defense Academy'), 'note-2025-06-15', { action_type: 'LOGGED', log_date: '2025-06-15T20:00:00.000Z', review_text: 'The branching school defense is starting to open up.' }),
  log(byTitle('Alan Wake 2'), 'played-2025-07-20', { action_type: 'PLAYED', log_date: '2025-07-20T20:00:00.000Z', review_text: 'Bold, strange, and confident about making horror theatrical.' }),
  log(byTitle('The Power Fantasy'), 'note-2025-08-18', { action_type: 'LOGGED', log_date: '2025-08-18T20:00:00.000Z', review_text: 'Five issues in, every conversation feels world-ending.' }),
];

const clone = value => structuredClone(value);
export const createEmptyGuestSnapshot = () => ({
  media: Object.fromEntries(MEDIA_TYPES.map(type => [type, []])),
  mediaLogs: [], deletedMediaKeys: {}, deletedLogIds: {}, importQueue: [],
});
export const createIsolatedAuthenticatedSnapshot = createEmptyGuestSnapshot;

export const createGuestShowcaseSnapshot = () => {
  const snapshot = createEmptyGuestSnapshot();
  for (const item of media) snapshot.media[item.type].push(clone(item));
  snapshot.mediaLogs = clone(logs);
  return snapshot;
};

export const snapshotGuestState = state => ({
  media: clone(state?.media || createEmptyGuestSnapshot().media),
  mediaLogs: clone(state?.mediaLogs || []),
  deletedMediaKeys: clone(state?.deletedMediaKeys || {}),
  deletedLogIds: clone(state?.deletedLogIds || {}),
  importQueue: clone(state?.importQueue || []),
});

export const resolveGuestInitialization = ({ currentOwnerId, currentState, savedGuestSnapshot, seededVersion = 0 }) => {
  if (currentOwnerId === 'guest') return { snapshot: snapshotGuestState(currentState), seeded: false };
  if (savedGuestSnapshot) return { snapshot: snapshotGuestState(savedGuestSnapshot), seeded: false };
  if (Number(seededVersion) >= GUEST_SHOWCASE_VERSION) return { snapshot: createEmptyGuestSnapshot(), seeded: false };
  return { snapshot: createGuestShowcaseSnapshot(), seeded: true };
};

export const guestShowcaseMedia = () => clone(media);
export const guestShowcaseLogs = () => clone(logs);
