import { strFromU8, unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 120 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 250;
const MAX_TABULAR_ROWS = 100_000;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  trimValues: false,
});

const asArray = value => value == null ? [] : (Array.isArray(value) ? value : [value]);
const cleanText = value => String(value ?? '').replace(/^\uFEFF/u, '').trim();
const normalizedText = value => cleanText(value).toLocaleLowerCase().replace(/\s+/gu, ' ');
const validYear = value => {
  const year = Number.parseInt(value, 10);
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : null;
};
const boundedRating = value => {
  const rating = Number(value);
  return Number.isFinite(rating) ? Math.min(10, Math.max(0, rating)) : 0;
};
const letterboxdRating = value => boundedRating(Number(value) * 2);
const comicGeeksRating = value => boundedRating(Number(value) * 2);
const trueish = value => ['1', 'true', 'yes', 'y'].includes(normalizedText(value));
const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/u;

const timestampForDate = value => {
  const text = cleanText(value);
  const dateOnly = text.match(dateOnlyPattern);
  if (dateOnly) {
    const timestamp = Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12);
    const check = new Date(timestamp);
    return check.getUTCFullYear() === Number(dateOnly[1])
      && check.getUTCMonth() === Number(dateOnly[2]) - 1
      && check.getUTCDate() === Number(dateOnly[3])
      ? timestamp
      : null;
  }
  const timestamp = new Date(text).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const isoForTimestamp = value => Number.isFinite(Number(value)) ? new Date(Number(value)).toISOString() : null;

const stableHash = value => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of String(value)) {
    const code = character.codePointAt(0);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + 0x9e37), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
};

const stableExternalId = (source, kind, key) => `${source}-${kind}-${stableHash(`${source}|${kind}|${key}`)}`;
const filmKey = (title, year) => `${normalizedText(title)}|${validYear(year) || ''}`;

const assertSourceSize = (bytes, label) => {
  const length = bytes?.byteLength ?? bytes?.length ?? 0;
  if (!length) throw new TypeError(`${label} is empty.`);
  if (length > MAX_SOURCE_BYTES) throw new TypeError(`${label} exceeds the 50 MB import limit.`);
};

const openArchive = (input, label) => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  assertSourceSize(bytes, label);
  let files;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new TypeError(`${label} is not a readable ZIP/XLSX archive.`);
  }
  const entries = Object.entries(files).filter(([name]) => !name.endsWith('/'));
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new TypeError(`${label} contains too many files.`);
  const expandedBytes = entries.reduce((sum, [, value]) => sum + value.byteLength, 0);
  if (expandedBytes > MAX_UNCOMPRESSED_BYTES) throw new TypeError(`${label} expands beyond the 120 MB safety limit.`);
  return Object.fromEntries(entries);
};

export const parseCsv = text => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/u, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/u, ''));
      rows.push(row);
      if (rows.length > MAX_TABULAR_ROWS + 1) throw new TypeError('CSV exceeds the row limit.');
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new TypeError('CSV contains an unterminated quoted field.');
  if (field || row.length) {
    row.push(field.replace(/\r$/u, ''));
    rows.push(row);
  }
  const nonEmptyRows = rows.filter(values => values.some(value => cleanText(value)));
  if (!nonEmptyRows.length) return [];
  const headers = nonEmptyRows[0].map(cleanText);
  return nonEmptyRows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
};

const archiveFileByBasename = (archive, basename) => {
  const target = basename.toLocaleLowerCase();
  const entry = Object.entries(archive).find(([name]) => name.replace(/\\/gu, '/').split('/').at(-1).toLocaleLowerCase() === target);
  return entry?.[1] || null;
};

const parseArchiveCsv = (archive, name) => {
  const bytes = archiveFileByBasename(archive, name);
  return bytes ? parseCsv(strFromU8(bytes)) : [];
};

const makeQueueItem = ({
  source,
  sourceKey,
  title,
  year,
  type,
  modifier = '',
  note = '',
  timestamp,
  sourceUrl = null,
  sourceProviderId = null,
  searchQuery = null,
  intent,
  extra = {},
}) => {
  const effectiveTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();
  return {
    id: stableExternalId(source, 'queue', sourceKey),
    import_source: source,
    source_record_key: sourceKey,
    raw_text: `${title}${year ? ` (${year})` : ''}${modifier ? ` ${modifier}` : ''}`,
    extracted_title: cleanText(title),
    parsed_year: validYear(year),
    parsed_modifier: cleanText(modifier),
    extracted_note: cleanText(note),
    tweet_timestamp: isoForTimestamp(effectiveTimestamp),
    source_tweet_id: null,
    source_url: sourceUrl,
    source_provider_id: sourceProviderId,
    search_query: searchQuery || cleanText(title),
    selected_type: type,
    status: 'PENDING',
    candidates: [],
    has_searched: false,
    ready_to_commit: false,
    import_intent: intent,
    ...extra,
  };
};

const summarizeItems = (items, sourceRecords) => ({
  sourceRecords,
  queueItems: items.length,
  historyEntries: items.filter(item => item.import_intent?.create_diary).length,
  libraryOnly: items.filter(item => !item.import_intent?.create_diary).length,
  planned: items.filter(item => item.import_intent?.library_status === 'planned').length,
  inProgress: items.filter(item => item.import_intent?.library_status === 'in progress').length,
  completed: items.filter(item => item.import_intent?.library_status === 'completed').length,
});

export const parseLetterboxdZip = (input, { includeHistory = true } = {}) => {
  const archive = openArchive(input, 'Letterboxd export');
  const diary = parseArchiveCsv(archive, 'diary.csv');
  const watched = parseArchiveCsv(archive, 'watched.csv');
  const ratings = parseArchiveCsv(archive, 'ratings.csv');
  const reviews = parseArchiveCsv(archive, 'reviews.csv');
  const watchlist = parseArchiveCsv(archive, 'watchlist.csv');
  if (![diary, watched, ratings, reviews, watchlist].some(rows => rows.length)) {
    throw new TypeError('Letterboxd ZIP does not contain diary, watched, ratings, reviews, or watchlist CSV data.');
  }

  const ratingByFilm = new Map(ratings.map(row => [filmKey(row.Name, row.Year), letterboxdRating(row.Rating)]));
  const reviewByDiaryUri = new Map(reviews.filter(row => cleanText(row['Letterboxd URI'])).map(row => [cleanText(row['Letterboxd URI']), row]));
  const reviewByEvent = new Map(reviews.map(row => [`${filmKey(row.Name, row.Year)}|${cleanText(row['Watched Date'])}`, row]));
  const diaryFilmKeys = new Set(diary.map(row => filmKey(row.Name, row.Year)));
  const consumed = new Map();
  for (const row of [...watched, ...diary]) {
    const key = filmKey(row.Name, row.Year);
    if (!cleanText(row.Name)) continue;
    const previous = consumed.get(key);
    const rowTimestamp = timestampForDate(row['Watched Date'] || row.Date);
    if (!previous || (rowTimestamp || 0) >= (previous.timestamp || 0)) consumed.set(key, { row, timestamp: rowTimestamp });
  }
  for (const row of ratings) {
    const key = filmKey(row.Name, row.Year);
    if (cleanText(row.Name) && !consumed.has(key)) {
      consumed.set(key, { row, timestamp: timestampForDate(row.Date) });
    }
  }

  const items = [];
  if (includeHistory) {
    for (const [index, row] of diary.entries()) {
      const title = cleanText(row.Name);
      if (!title) continue;
      const key = filmKey(title, row.Year);
      const activityAt = timestampForDate(row['Watched Date'] || row.Date);
      if (!activityAt) continue;
      const diaryUri = cleanText(row['Letterboxd URI']);
      const review = reviewByDiaryUri.get(diaryUri) || reviewByEvent.get(`${key}|${cleanText(row['Watched Date'])}`);
      const rating = letterboxdRating(row.Rating) || ratingByFilm.get(key) || letterboxdRating(review?.Rating);
      const rewatch = trueish(row.Rewatch || review?.Rewatch);
      const sourceKey = diaryUri || `${key}|${cleanText(row['Watched Date'])}|${index}`;
      items.push(makeQueueItem({
        source: 'letterboxd',
        sourceKey: `diary|${sourceKey}`,
        title,
        year: row.Year,
        type: 'movies',
        modifier: rewatch ? 'Rewatch' : '',
        note: review?.Review || '',
        timestamp: activityAt,
        sourceUrl: diaryUri || null,
        intent: {
          library_status: 'completed',
          rating,
          added_at: timestampForDate(row.Date) || activityAt,
          date_started: activityAt,
          date_completed: activityAt,
          create_diary: true,
          activity_at: isoForTimestamp(activityAt),
          action_type: rewatch ? 'RE-WATCHED' : 'WATCHED',
          log_id: stableExternalId('letterboxd', 'log', sourceKey),
          review_text: cleanText(review?.Review || ''),
        },
      }));
    }
  }

  for (const [key, value] of consumed) {
    if (includeHistory && diaryFilmKeys.has(key)) continue;
    const row = value.row;
    const completedAt = value.timestamp || timestampForDate(row.Date) || Date.now();
    items.push(makeQueueItem({
      source: 'letterboxd',
      sourceKey: `film|${cleanText(row['Letterboxd URI']) || key}`,
      title: row.Name,
      year: row.Year,
      type: 'movies',
      timestamp: completedAt,
      sourceUrl: cleanText(row['Letterboxd URI']) || null,
      intent: {
        library_status: 'completed',
        rating: ratingByFilm.get(key) || letterboxdRating(row.Rating),
        added_at: timestampForDate(row.Date) || completedAt,
        date_started: null,
        date_completed: completedAt,
        create_diary: false,
      },
    }));
  }

  for (const row of watchlist) {
    const title = cleanText(row.Name);
    const key = filmKey(title, row.Year);
    if (!title || consumed.has(key)) continue;
    const addedAt = timestampForDate(row.Date) || Date.now();
    items.push(makeQueueItem({
      source: 'letterboxd',
      sourceKey: `watchlist|${cleanText(row['Letterboxd URI']) || key}`,
      title,
      year: row.Year,
      type: 'movies',
      modifier: 'Watchlist',
      timestamp: addedAt,
      sourceUrl: cleanText(row['Letterboxd URI']) || null,
      intent: {
        library_status: 'planned',
        rating: ratingByFilm.get(key) || 0,
        added_at: addedAt,
        date_started: null,
        date_completed: null,
        create_diary: false,
      },
    }));
  }

  items.sort((left, right) => new Date(left.tweet_timestamp) - new Date(right.tweet_timestamp));
  return {
    source: 'letterboxd',
    label: 'Letterboxd',
    items,
    summary: summarizeItems(items, diary.length + watched.length + ratings.length + reviews.length + watchlist.length),
    warnings: [
      'Likes, lists, comments, profile data, and tags are not imported because Polyhedron has no matching Library fields.',
      includeHistory
        ? 'Letterboxd Diary rows become stable WATCHED/RE-WATCHED history; watched-only rows update Library state without inventing Diary entries.'
        : 'Diary history is disabled for this import; each film becomes one Library update only.',
      ...(includeHistory ? ['If another backup already contains the same dated activity, disable Diary history to avoid cross-source duplicate events.'] : []),
    ],
  };
};

const xmlText = value => {
  if (value == null) return '';
  if (typeof value === 'object') return cleanText(value['#text'] ?? value.title ?? value.latin ?? value.original);
  return cleanText(value);
};

const vndbLabels = value => asArray(value).map(label => normalizedText(label?.label ?? label?.['#text'] ?? label)).filter(Boolean);

const statusForVndb = (labels, finishedAt) => {
  if (finishedAt || labels.includes('finished')) return 'completed';
  if (labels.includes('playing') || labels.includes('stalled')) return 'in progress';
  if (labels.includes('dropped') || labels.includes('blacklist')) return 'dropped';
  return 'planned';
};

export const parseVndbXml = (text, { includeHistory = true } = {}) => {
  const source = String(text || '');
  if (!source.trim()) throw new TypeError('VNDB export is empty.');
  if (source.length > MAX_SOURCE_BYTES) throw new TypeError('VNDB export exceeds the 50 MB import limit.');
  if (/<!DOCTYPE|<!ENTITY/iu.test(source)) throw new TypeError('VNDB export contains unsupported XML declarations.');
  let parsed;
  try {
    parsed = xmlParser.parse(source);
  } catch {
    throw new TypeError('VNDB export is not valid XML.');
  }
  const root = parsed?.['vndb-export'];
  const records = asArray(root?.vns?.vn);
  if (!root || !records.length) throw new TypeError('VNDB XML does not contain a VN list.');

  const items = [];
  let skipped = 0;
  for (const record of records) {
    const providerId = cleanText(record?.id);
    const title = xmlText(record?.title);
    if (!providerId || !title) {
      skipped += 1;
      continue;
    }
    const labels = vndbLabels(record.label);
    if (labels.includes('blacklist') && labels.length === 1) {
      skipped += 1;
      continue;
    }
    const addedAt = timestampForDate(record.added) || Date.now();
    const startedAt = timestampForDate(record.started);
    const finishedAt = timestampForDate(record.finished);
    const status = statusForVndb(labels, finishedAt);
    const vote = boundedRating(record.vote?.['#text'] ?? record.vote);
    const createDiary = Boolean(includeHistory && finishedAt);
    const eventAt = finishedAt || startedAt || addedAt;
    items.push(makeQueueItem({
      source: 'vndb',
      sourceKey: providerId,
      title,
      year: null,
      type: 'vn',
      modifier: labels.filter(label => label !== 'voted').map(label => label.replace(/^./u, first => first.toLocaleUpperCase())).join(' · '),
      timestamp: eventAt,
      sourceUrl: `https://vndb.org/${encodeURIComponent(providerId)}`,
      sourceProviderId: providerId,
      intent: {
        library_status: status,
        rating: vote,
        added_at: addedAt,
        date_started: startedAt,
        date_completed: status === 'completed' ? finishedAt : null,
        create_diary: createDiary,
        activity_at: createDiary ? isoForTimestamp(finishedAt) : null,
        action_type: createDiary ? 'PLAYED' : null,
        log_id: createDiary ? stableExternalId('vndb', 'log', `${providerId}|finished|${record.finished}`) : null,
        review_text: '',
      },
    }));
  }
  items.sort((left, right) => new Date(left.tweet_timestamp) - new Date(right.tweet_timestamp));
  return {
    source: 'vndb',
    label: 'VNDB',
    items,
    summary: summarizeItems(items, records.length),
    warnings: [
      'VNDB IDs are retained for exact provider resolution; start, finish, vote, and list status fields are preserved.',
      includeHistory
        ? 'A finished date creates one deterministic PLAYED Diary entry; unfinished records remain Library-only.'
        : 'Diary history is disabled for this import; finished dates update Library state only.',
      ...(skipped ? [`${skipped} empty or blacklist-only record${skipped === 1 ? '' : 's'} will be skipped.`] : []),
    ],
  };
};

const collectRichText = value => {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(collectRichText).join('');
  if (Object.hasOwn(value, '#text')) return String(value['#text']);
  if (Object.hasOwn(value, 't')) return collectRichText(value.t);
  if (Object.hasOwn(value, 'r')) return collectRichText(value.r);
  return '';
};

const columnFromReference = reference => cleanText(reference).match(/^[A-Z]+/u)?.[0] || '';

const workbookRows = input => {
  const archive = openArchive(input, 'ComicGeeks workbook');
  const worksheetEntry = Object.keys(archive).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/iu.test(name)).sort()[0];
  if (!worksheetEntry) throw new TypeError('ComicGeeks workbook does not contain a worksheet.');
  const sharedEntry = archive['xl/sharedStrings.xml'];
  const sharedStrings = sharedEntry
    ? asArray(xmlParser.parse(strFromU8(sharedEntry))?.sst?.si).map(collectRichText)
    : [];
  let sheet;
  try {
    sheet = xmlParser.parse(strFromU8(archive[worksheetEntry]));
  } catch {
    throw new TypeError('ComicGeeks worksheet XML is malformed.');
  }
  const rows = asArray(sheet?.worksheet?.sheetData?.row);
  if (rows.length < 2) throw new TypeError('ComicGeeks workbook does not contain any data rows.');
  if (rows.length > MAX_TABULAR_ROWS + 1) throw new TypeError('ComicGeeks workbook exceeds the row limit.');

  const valuesForRow = row => {
    const values = {};
    for (const cell of asArray(row?.c)) {
      const column = columnFromReference(cell?.r);
      if (!column) continue;
      if (cell.t === 's') values[column] = sharedStrings[Number(cell.v)] ?? '';
      else if (cell.t === 'inlineStr') values[column] = collectRichText(cell.is);
      else if (cell.t === 'b') values[column] = String(cell.v) === '1';
      else values[column] = cell.v ?? '';
    }
    return values;
  };

  const rawHeaders = valuesForRow(rows[0]);
  const headerByColumn = Object.fromEntries(Object.entries(rawHeaders).map(([column, value]) => [column, normalizedText(value)]));
  const required = ['series name', 'full title', 'marked read'];
  if (required.some(name => !Object.values(headerByColumn).includes(name))) {
    throw new TypeError('Workbook does not match the ComicGeeks export columns.');
  }
  return rows.slice(1).map(row => {
    const values = valuesForRow(row);
    return Object.fromEntries(Object.entries(values).map(([column, value]) => [headerByColumn[column] || column, value]));
  });
};

export const normalizeIssueNumber = value => cleanText(value)
  .replace(/^#\s*/u, '')
  .replace(/^0+(?=\d)/u, '')
  .replace(/\s+/gu, '')
  .toLocaleUpperCase();

const comicGeeksIssueIdentity = value => {
  const title = cleanText(value);
  const matches = [...String(value || '').matchAll(/#\s*([0-9]+(?:\.[0-9]+)?[A-Za-z.-]*)/gu)];
  const match = matches.at(-1);
  return {
    number: normalizeIssueNumber(match?.[1]),
    family: match ? title.slice(0, match.index).trim() : title,
  };
};

export const parseComicGeeksXlsx = (input, { importedAt = Date.now() } = {}) => {
  const rows = workbookRows(input);
  const groups = new Map();
  for (const row of rows) {
    const series = cleanText(row['series name']);
    if (!series) continue;
    const publisher = cleanText(row['publisher name']);
    const issueIdentity = comicGeeksIssueIdentity(row['full title']);
    const annualRun = /\bannual$/iu.test(issueIdentity.family) && !/\bannual\b/iu.test(series);
    const displaySeries = annualRun ? issueIdentity.family : series;
    const variant = annualRun ? normalizedText(issueIdentity.family) : 'main';
    const key = `${normalizedText(publisher)}|${normalizedText(series)}|${variant}`;
    const group = groups.get(key) || { publisher, series: displaySeries, sourceSeries: series, rows: [] };
    group.rows.push({ ...row, issue_number: issueIdentity.number });
    groups.set(key, group);
  }

  const items = [];
  for (const [key, group] of groups) {
    const sourceIssues = group.rows.map(row => ({
      number: row.issue_number,
      full_title: cleanText(row['full title']),
      release_date: cleanText(row['release date']),
      marked_read: trueish(row['marked read']),
      in_collection: trueish(row['in collection']),
      in_wish_list: trueish(row['in wish list']),
    }));
    const releaseYears = group.rows.map(row => validYear(cleanText(row['release date']).slice(0, 4))).filter(Boolean);
    const year = releaseYears.length ? Math.min(...releaseYears) : null;
    const ratings = group.rows.map(row => comicGeeksRating(row['my rating'])).filter(rating => rating > 0);
    const readCount = sourceIssues.filter(issue => issue.marked_read).length;
    const purchasedDates = group.rows.map(row => timestampForDate(row['date purchased'])).filter(Number.isFinite);
    const addedAt = purchasedDates.length ? Math.min(...purchasedDates) : importedAt;
    items.push(makeQueueItem({
      source: 'comicgeeks',
      sourceKey: key,
      title: group.series,
      year,
      type: 'comics',
      modifier: `${sourceIssues.length} exported issue${sourceIssues.length === 1 ? '' : 's'}`,
      timestamp: addedAt,
      searchQuery: `${group.series}${year ? ` ${year}` : ''}`,
      intent: {
        library_status: readCount ? 'in progress' : 'planned',
        rating: ratings.length ? Math.max(...ratings) : 0,
        added_at: addedAt,
        date_started: null,
        date_completed: null,
        progress: readCount ? `${readCount} exported issues` : null,
        read_issue_ids: [],
        create_diary: false,
      },
      extra: {
        source_publisher: group.publisher,
        source_series_name: group.sourceSeries,
        source_issues: sourceIssues,
        source_issue_count: sourceIssues.length,
        source_read_count: readCount,
      },
    }));
  }
  items.sort((left, right) => left.extracted_title.localeCompare(right.extracted_title));
  return {
    source: 'comicgeeks',
    label: 'League of Comic Geeks',
    items,
    summary: summarizeItems(items, rows.length),
    warnings: [
      'ComicGeeks issue rows are grouped into series before matching against Metron; annual runs are separated so they cannot collide with a regular issue of the same number.',
      'ComicGeeks has no read-date field. Read issues update Library progress only; no Diary history is fabricated.',
      'A series is marked completed only when the fetched Metron issue list is authoritative and every provider issue is matched as read.',
    ],
  };
};

const providerYear = issue => validYear(issue?.cover_date?.slice?.(0, 4) || issue?.date?.slice?.(0, 4));

export const matchComicGeeksIssues = (sourceIssues, providerDetails, completionAt = Date.now()) => {
  const providerIssues = asArray(providerDetails?.issue_details || providerDetails?.issues);
  const byNumber = new Map();
  for (const issue of providerIssues) {
    const number = normalizeIssueNumber(issue?.number ?? issue?.issue_number);
    if (!number || issue?.id == null) continue;
    const matches = byNumber.get(number) || [];
    matches.push(issue);
    byNumber.set(number, matches);
  }
  const matchedIds = [];
  const usedProviderIds = new Set();
  let unmatchedRead = 0;
  for (const sourceIssue of asArray(sourceIssues).filter(issue => issue?.marked_read)) {
    const number = normalizeIssueNumber(sourceIssue.number);
    const candidates = (byNumber.get(number) || []).filter(issue => !usedProviderIds.has(String(issue.id)));
    const sourceYear = validYear(cleanText(sourceIssue.release_date).slice(0, 4));
    const candidate = candidates.find(issue => sourceYear && providerYear(issue) === sourceYear) || candidates[0];
    if (candidate?.id != null) {
      const providerId = String(candidate.id);
      usedProviderIds.add(providerId);
      matchedIds.push(providerId);
    }
    else unmatchedRead += 1;
  }
  const readIssueIds = [...new Set(matchedIds)];
  const declaredTotal = Number(providerDetails?.issue_count ?? providerDetails?.issuesCount);
  const authoritativeTotal = Number.isInteger(declaredTotal) && declaredTotal > 0 && providerIssues.length >= declaredTotal
    ? declaredTotal
    : null;
  const completed = authoritativeTotal !== null && readIssueIds.length >= authoritativeTotal;
  return {
    readIssueIds,
    unmatchedRead,
    providerIssueCount: providerIssues.length,
    authoritativeTotal,
    status: completed ? 'completed' : (readIssueIds.length ? 'in progress' : 'planned'),
    progress: readIssueIds.length ? `${readIssueIds.length} Issues` : null,
    dateCompleted: completed ? completionAt : null,
  };
};

const candidateYear = item => validYear(
  item?.year
  || item?.apiData?.year
  || item?.apiData?.raw?.year
  || item?.apiData?.raw?.release_date?.slice?.(0, 4)
  || item?.apiData?.raw?.first_air_date?.slice?.(0, 4)
  || item?.apiData?.raw?.released?.slice?.(0, 4),
);

export const matchExternalItemsToLibrary = (items, media) => {
  const existing = Object.values(media || {}).flat();
  return items.map(item => {
    if (item.import_source === 'comicgeeks') return item;
    const exactProvider = cleanText(item.source_provider_id)
      ? existing.find(candidate => candidate.type === item.selected_type && cleanText(candidate.provider_id || candidate.id) === cleanText(item.source_provider_id))
      : null;
    const exactTitle = exactProvider || existing.find(candidate => {
      if (candidate.type !== item.selected_type || normalizedText(candidate.title) !== normalizedText(item.extracted_title)) return false;
      const expectedYear = validYear(item.parsed_year);
      const actualYear = candidateYear(candidate);
      return !expectedYear || (actualYear != null && actualYear === expectedYear);
    });
    return exactTitle
      ? { ...item, selected_candidate: exactTitle, ready_to_commit: true, matched_from_library: true }
      : item;
  });
};

export const parseExternalImportFile = async (file, options = {}) => {
  if (!file || typeof file.arrayBuffer !== 'function') throw new TypeError('Choose an export file first.');
  const name = cleanText(file.name);
  const extension = name.toLocaleLowerCase().split('.').at(-1);
  if (extension === 'zip') return parseLetterboxdZip(await file.arrayBuffer(), options);
  if (extension === 'xml') return parseVndbXml(await file.text(), options);
  if (extension === 'xlsx') return parseComicGeeksXlsx(await file.arrayBuffer(), { ...options, importedAt: file.lastModified || Date.now() });
  throw new TypeError('Supported external exports are Letterboxd .zip, VNDB .xml, and ComicGeeks .xlsx.');
};
