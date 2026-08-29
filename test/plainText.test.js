import test from 'node:test';
import assert from 'node:assert/strict';

import { plainTextFromMarkup } from '../src/utils/plainText.js';
import { normalizeAniList } from '../src/utils/normalizers.js';
import { readFile } from 'node:fs/promises';

const detailSource = await readFile(new URL('../src/pages/Pages.jsx', import.meta.url), 'utf8');
const registrySource = await readFile(new URL('../src/services/apiRegistry.js', import.meta.url), 'utf8');

test('provider HTML becomes readable plain text with paragraph breaks', () => {
  assert.equal(
    plainTextFromMarkup('<p>First paragraph.</p><p>Second<br>line.</p>'),
    'First paragraph.\nSecond\nline.',
  );
});

test('backslash-escaped AniList tags do not leak into descriptions', () => {
  const description = String.raw`A story.\\<br>Another line.\\</p>`;
  const normalized = normalizeAniList({
    id: 1,
    title: { english: 'Example' },
    description,
    coverImage: {},
    startDate: {},
  }, 'anime');

  assert.equal(normalized.description, 'A story.\nAnother line.');
  assert.doesNotMatch(normalized.description, /<\/?(?:br|p)>|\\/iu);
});

test('markup text remains inert after normalization', () => {
  assert.equal(plainTextFromMarkup('<script>alert(1)</script><b>Safe</b>'), 'Safe');
});

test('AniList detail and staff descriptions render normalized text instead of raw provider HTML', () => {
  assert.match(detailSource, /formatMarkdownLinks\(overviewText\)/u);
  assert.doesNotMatch(detailSource, /formatMarkdownLinks\(rawDesc\)/u);
  assert.match(registrySource, /biography: plainTextFromMarkup\(staff\.description\)/u);
});
