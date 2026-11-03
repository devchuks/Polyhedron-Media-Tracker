const VALID_VIEW_MODES = new Set(['grid', 'list']);
const VALID_SORTS = new Set(['recentActivity', 'dateAdded', 'dateStarted', 'dateFinished', 'releaseYear', 'releaseYearAsc', 'rating', 'title']);
export const DEFAULT_LIBRARY_SORT = 'recentActivity';
const VALID_STATUSES = new Set(['all', 'planned', 'in progress', 'completed', 'dropped']);

export const LIBRARY_VIEW_STORAGE_KEY = 'polyhedron-library-view';
export const LIBRARY_SORT_STORAGE_KEY = 'polyhedron-library-sort-v2';

const safeStorage = (storage) => storage && typeof storage.getItem === 'function' ? storage : null;

export const readLibraryViewMode = (storage) => {
  try {
    const value = safeStorage(storage)?.getItem(LIBRARY_VIEW_STORAGE_KEY);
    return VALID_VIEW_MODES.has(value) ? value : 'grid';
  } catch { return 'grid'; }
};

export const writeLibraryViewMode = (storage, mode) => {
  if (!VALID_VIEW_MODES.has(mode)) return false;
  try { safeStorage(storage)?.setItem(LIBRARY_VIEW_STORAGE_KEY, mode); return true; }
  catch { return false; }
};

export const readLibrarySort = (storage, category) => {
  try {
    const saved = JSON.parse(safeStorage(storage)?.getItem(LIBRARY_SORT_STORAGE_KEY) || '{}');
    return VALID_SORTS.has(saved?.[category]) ? saved[category] : DEFAULT_LIBRARY_SORT;
  } catch { return DEFAULT_LIBRARY_SORT; }
};

export const writeLibrarySort = (storage, category, sort) => {
  if (!category || !VALID_SORTS.has(sort)) return false;
  try {
    const target = safeStorage(storage);
    const saved = JSON.parse(target?.getItem(LIBRARY_SORT_STORAGE_KEY) || '{}');
    target?.setItem(LIBRARY_SORT_STORAGE_KEY, JSON.stringify({ ...saved, [category]: sort }));
    return true;
  } catch { return false; }
};

export const parseLibraryContext = (searchParams, fallbackSort = DEFAULT_LIBRARY_SORT) => {
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || '');
  const status = params.get('status') || 'all';
  const sort = params.get('sort') || fallbackSort;
  const page = Number.parseInt(params.get('page') || '1', 10);
  return {
    search: params.get('q') || '',
    status: VALID_STATUSES.has(status) ? status : 'all',
    sort: VALID_SORTS.has(sort) ? sort : DEFAULT_LIBRARY_SORT,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
};

export const updateLibraryContext = (searchParams, patch) => {
  const next = new URLSearchParams(searchParams);
  const values = { q: patch.search, status: patch.status, sort: patch.sort, page: patch.page };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const replacingSavedSort = key === 'sort' && value === DEFAULT_LIBRARY_SORT && next.has('sort');
    const shouldOmit = value === '' || value === null || (key === 'status' && value === 'all') || (key === 'sort' && value === DEFAULT_LIBRARY_SORT && !replacingSavedSort) || (key === 'page' && Number(value) === 1);
    if (shouldOmit) next.delete(key);
    else next.set(key, String(value));
  }
  return next;
};

const timeValue = value => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Newest diary entry per media key, so a logged season or viewing counts as activity.
export const latestLogTimeByMediaKey = (logs = []) => {
  const latest = new Map();
  for (const log of logs || []) {
    if (!log?.media_key) continue;
    const time = timeValue(log.log_date);
    if (time > (latest.get(log.media_key) || 0)) latest.set(log.media_key, time);
  }
  return latest;
};

// When the user last did something meaningful with an item: added it, started it, finished it,
// or logged it. Episode-by-episode progress and provider refreshes deliberately do not count,
// and addedAt keeps its own meaning (it is never rewritten to reorder the library).
export const lastActivityTime = (item, latestLogs = new Map()) => Math.max(
  timeValue(item?.addedAt ?? item?.dateAdded),
  timeValue(item?.dateStarted),
  timeValue(item?.dateCompleted),
  latestLogs.get(item?.media_key) || 0,
);

// Choosing a sort saves it as the remembered sort before updating the URL. The URL omits the
// default sort, so without this a remembered non-default sort would win and the choice would be
// ignored until another sort was picked first.
export const chooseLibrarySort = (storage, searchParams, category, sort) => {
  writeLibrarySort(storage, category, sort);
  return updateLibraryContext(searchParams, { sort, page: 1 });
};
