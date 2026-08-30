const VALID_VIEW_MODES = new Set(['grid', 'list']);
const VALID_SORTS = new Set(['dateAdded', 'dateStarted', 'dateFinished', 'releaseYear', 'releaseYearAsc', 'rating', 'title']);
const VALID_STATUSES = new Set(['all', 'planned', 'in progress', 'completed', 'dropped']);

export const LIBRARY_VIEW_STORAGE_KEY = 'polyhedron-library-view';
export const LIBRARY_SORT_STORAGE_KEY = 'polyhedron-library-sort';

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
    return VALID_SORTS.has(saved?.[category]) ? saved[category] : 'dateAdded';
  } catch { return 'dateAdded'; }
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

export const parseLibraryContext = (searchParams, fallbackSort = 'dateAdded') => {
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || '');
  const status = params.get('status') || 'all';
  const sort = params.get('sort') || fallbackSort;
  const page = Number.parseInt(params.get('page') || '1', 10);
  return {
    search: params.get('q') || '',
    status: VALID_STATUSES.has(status) ? status : 'all',
    sort: VALID_SORTS.has(sort) ? sort : 'dateAdded',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
};

export const updateLibraryContext = (searchParams, patch) => {
  const next = new URLSearchParams(searchParams);
  const values = { q: patch.search, status: patch.status, sort: patch.sort, page: patch.page };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const replacingSavedSort = key === 'sort' && value === 'dateAdded' && next.has('sort');
    const shouldOmit = value === '' || value === null || (key === 'status' && value === 'all') || (key === 'sort' && value === 'dateAdded' && !replacingSavedSort) || (key === 'page' && Number(value) === 1);
    if (shouldOmit) next.delete(key);
    else next.set(key, String(value));
  }
  return next;
};
