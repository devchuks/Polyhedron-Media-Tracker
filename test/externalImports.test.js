import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { strToU8, zipSync } from 'fflate';

import {
  matchComicGeeksIssues,
  matchExternalItemsToLibrary,
  parseComicGeeksXlsx,
  parseCsv,
  parseLetterboxdZip,
  parseVndbXml,
} from '../src/domain/externalImports.js';

const zipTextFiles = files => zipSync(Object.fromEntries(
  Object.entries(files).map(([name, value]) => [name, strToU8(value)]),
));

const xmlEscape = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const columnName = index => String.fromCharCode(65 + index);
const inlineCell = (reference, value) => `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
const numericCell = (reference, value) => `<c r="${reference}" t="n"><v>${value}</v></c>`;

const comicWorkbook = rows => {
  const headers = [
    'Publisher Name', 'Series Name', 'Full Title', 'Release Date', 'In Collection', 'In Wish List',
    'Marked Read', 'My Rating', 'Media Format', 'Price Paid', 'Date Purchased', 'Condition', 'Notes', 'Tags',
  ];
  const allRows = [headers, ...rows];
  const rowXml = allRows.map((values, rowIndex) => {
    const cells = values.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      return rowIndex > 0 && [4, 5, 6].includes(columnIndex)
        ? numericCell(reference, value || 0)
        : inlineCell(reference, value);
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return zipTextFiles({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`,
  });
};

test('CSV parser preserves quoted commas, doubled quotes, and multiline reviews', () => {
  const rows = parseCsv('Name,Review\nFilm,"Line one, still one\nLine ""two"""\n');
  assert.deepEqual(rows, [{ Name: 'Film', Review: 'Line one, still one\nLine "two"' }]);
});

test('Letterboxd ZIP merges overlapping exports without duplicating watched library rows', () => {
  const archive = zipTextFiles({
    'letterboxd-export/diary.csv': [
      'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date',
      '2024-02-02,Film One,2001,https://boxd.it/log-one,4.5,No,,2024-02-01',
      '2025-03-03,Film One,2001,https://boxd.it/log-two,5,Yes,,2025-03-02',
    ].join('\n'),
    'letterboxd-export/watched.csv': [
      'Date,Name,Year,Letterboxd URI',
      '2024-02-02,Film One,2001,https://boxd.it/film-one',
      '2023-04-04,Film Two,2002,https://boxd.it/film-two',
    ].join('\n'),
    'letterboxd-export/ratings.csv': [
      'Date,Name,Year,Letterboxd URI,Rating',
      '2025-03-03,Film One,2001,https://boxd.it/film-one,5',
      '2026-04-04,Film Two,2002,https://boxd.it/film-two,4',
    ].join('\n'),
    'letterboxd-export/reviews.csv': [
      'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date',
      '2025-03-03,Film One,2001,https://boxd.it/log-two,5,Yes,"A review, with punctuation",,2025-03-02',
    ].join('\n'),
    'letterboxd-export/watchlist.csv': [
      'Date,Name,Year,Letterboxd URI',
      '2026-01-01,Film Three,2003,https://boxd.it/film-three',
    ].join('\n'),
  });

  const result = parseLetterboxdZip(archive);
  assert.equal(result.items.length, 4);
  assert.equal(result.summary.historyEntries, 2);
  assert.equal(result.summary.libraryOnly, 2);
  assert.equal(result.items.filter(item => item.extracted_title === 'Film One').length, 2);
  const rewatch = result.items.find(item => item.import_intent.action_type === 'RE-WATCHED');
  assert.equal(rewatch.import_intent.rating, 10);
  assert.equal(rewatch.import_intent.review_text, 'A review, with punctuation');
  assert.notEqual(result.items[0].import_intent.log_id, result.items[1].import_intent.log_id);
  const watchedOnly = result.items.find(item => item.extracted_title === 'Film Two');
  assert.equal(watchedOnly.tweet_timestamp, '2023-04-04T12:00:00.000Z');

  const libraryOnly = parseLetterboxdZip(archive, { includeHistory: false });
  assert.equal(libraryOnly.items.length, 3);
  assert.equal(libraryOnly.summary.historyEntries, 0);
});

test('VNDB XML preserves provider identity, lifecycle dates, votes, and optional history', () => {
  const xml = `<?xml version="1.0"?>
    <vndb-export date="2026-05-04T00:00:00Z">
      <vns>
        <vn id="v1"><title original="Original">Finished VN</title><label id="2" label="Finished"/><label id="7" label="Voted"/><added>2023-01-01T10:00:00Z</added><vote timestamp="2023-01-04T00:00:00Z">8</vote><started>2023-01-02</started><finished>2023-01-03</finished></vn>
        <vn id="v2"><title>Playing VN</title><label id="1" label="Playing"/><added>2024-01-01T10:00:00Z</added><started>2024-01-02</started></vn>
        <vn id="v3"><title>Wishlist VN</title><label id="5" label="Wishlist"/><added>2025-01-01T10:00:00Z</added></vn>
      </vns>
    </vndb-export>`;
  const result = parseVndbXml(xml);
  assert.equal(result.items.length, 3);
  const finished = result.items.find(item => item.source_provider_id === 'v1');
  assert.equal(finished.import_intent.library_status, 'completed');
  assert.equal(finished.import_intent.rating, 8);
  assert.equal(finished.import_intent.create_diary, true);
  assert.equal(result.items.find(item => item.source_provider_id === 'v2').import_intent.library_status, 'in progress');
  assert.equal(result.items.find(item => item.source_provider_id === 'v3').import_intent.library_status, 'planned');

  const libraryOnly = parseVndbXml(xml, { includeHistory: false });
  assert.equal(libraryOnly.items.every(item => !item.import_intent.create_diary), true);
});

test('ComicGeeks XLSX groups issue rows into series and maps authoritative Metron issue IDs safely', () => {
  const workbook = comicWorkbook([
    ['Publisher', 'Series A', 'Series A #1', '2024-01-01', 0, 0, 1, '5', 'Print', '', '', '', '', ''],
    ['Publisher', 'Series A', 'Series A #2', '2024-02-01', 0, 0, 1, '', 'Print', '', '', '', '', ''],
    ['Publisher', 'Series A', 'Series A Annual #1', '2024-06-01', 0, 0, 1, '', 'Print', '', '', '', '', ''],
    ['Publisher', 'Series B', 'Series B #1', '2025-01-01', 0, 1, 0, '', 'Print', '', '', '', '', ''],
  ]);
  const result = parseComicGeeksXlsx(workbook, { importedAt: Date.UTC(2026, 0, 1) });
  assert.equal(result.summary.sourceRecords, 4);
  assert.equal(result.items.length, 3);
  const series = result.items.find(item => item.extracted_title === 'Series A');
  assert.equal(series.source_issues.length, 2);
  assert.equal(series.import_intent.rating, 10);
  assert.equal(series.import_intent.create_diary, false);
  const annual = result.items.find(item => item.extracted_title === 'Series A Annual');
  assert.equal(annual.source_issues.length, 1);
  assert.equal(annual.source_issues[0].number, '1');

  const complete = matchComicGeeksIssues(series.source_issues, {
    issue_count: 2,
    issue_details: [{ id: 101, number: '1' }, { id: 102, number: '2' }],
  }, 1234);
  assert.deepEqual(complete.readIssueIds, ['101', '102']);
  assert.equal(complete.status, 'completed');
  assert.equal(complete.dateCompleted, 1234);

  const partial = matchComicGeeksIssues(series.source_issues, {
    issue_count: 3,
    issue_details: [{ id: 101, number: '1' }, { id: 102, number: '2' }],
  });
  assert.equal(partial.status, 'in progress');
  assert.equal(partial.authoritativeTotal, null);
});

test('external rows pre-resolve only against exact canonical IDs or exact title/year Library matches', () => {
  const items = [
    { id: 'vn', import_source: 'vndb', selected_type: 'vn', source_provider_id: 'v1', extracted_title: 'Different title' },
    { id: 'movie', import_source: 'letterboxd', selected_type: 'movies', extracted_title: 'Film', parsed_year: 2001 },
    { id: 'wrong-year', import_source: 'letterboxd', selected_type: 'movies', extracted_title: 'Film', parsed_year: 2002 },
  ];
  const media = {
    vn: [{ id: 'v1', provider_id: 'v1', type: 'vn', title: 'VN' }],
    movies: [{ id: '10', provider_id: '10', type: 'movies', title: 'Film', year: '2001' }],
  };
  const matched = matchExternalItemsToLibrary(items, media);
  assert.equal(matched[0].ready_to_commit, true);
  assert.equal(matched[1].ready_to_commit, true);
  assert.equal(Boolean(matched[2].ready_to_commit), false);
});

test('Import Terminal routes Library-only external entries through the awaited canonical save path', async () => {
  const terminalSource = await readFile(new URL('../src/pages/ImportTerminal.jsx', import.meta.url), 'utf8');
  const layoutSource = await readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8');
  const storeSource = await readFile(new URL('../src/store/useMediaStore.js', import.meta.url), 'utf8');
  assert.match(terminalSource, /if \(intent\.create_diary === false\) \{[\s\S]*await saveMediaItem\(libraryPayload, selectedType\)/);
  assert.match(terminalSource, /parseExternalImportFile\(file/);
  assert.match(storeSource, /saveMediaItem: async \(item, category\)/);
  assert.match(storeSource, /await queueMediaMutation\(canonicalItem\.media_key/);
  assert.match(terminalSource, /authMode !== 'admin' && authMode !== 'guest'/);
  assert.match(terminalSource, /Guest import sandbox/);
  assert.match(terminalSource, /isComicGeeks \? \(/);
  assert.match(terminalSource, /source_read_count \|\| 0/);
  assert.match(terminalSource, /!isExternalImport && <div className="flex flex-wrap gap-2 items-center/);
  assert.match(terminalSource, /Find match/);
  assert.match(layoutSource, /authMode === 'admin' \|\| authMode === 'guest'/);
});
