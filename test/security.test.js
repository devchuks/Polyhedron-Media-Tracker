import test from 'node:test';
import assert from 'node:assert/strict';

import { formatSafeMarkup } from '../src/utils/safeMarkup.js';
import { safeExternalUrl } from '../src/utils/urlSafety.js';

test('untrusted HTML and event handlers are escaped before markup rendering', () => {
  const html = formatSafeMarkup('<img src=x onerror="globalThis.pwned=true"><script>alert(1)</script>');
  assert.doesNotMatch(html, /<img|<script/i);
  assert.match(html, /&lt;img/);
});

test('BBCode and Markdown links reject active schemes and attribute breaking', () => {
  const js = formatSafeMarkup('[url=javascript:alert(1)]click[/url]');
  const broken = formatSafeMarkup('[url=https://safe.test/" onmouseover="alert(1)]click[/url]');
  assert.doesNotMatch(js, /href=/i);
  assert.doesNotMatch(broken, /"\s+onmouseover=/i);
});

test('valid HTTPS and intended VNDB relative links remain safe', () => {
  assert.equal(safeExternalUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeExternalUrl('/v17', { relativeBase: 'https://vndb.org' }), 'https://vndb.org/v17');
  assert.equal(safeExternalUrl(' javascript:alert(1) '), null);
  assert.equal(safeExternalUrl('data:text/html,pwn'), null);
  assert.match(formatSafeMarkup('[safe](https://example.com/a)'), /href="https:\/\/example\.com\/a"/);
});
