import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { selectVnBannerImage } from '../src/domain/mediaImages.js';

const registrySource = await readFile(new URL('../src/services/apiRegistry.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');

test('VNDB banner selection prefers a safe landscape image suited to a wide crop', () => {
  const selected = selectVnBannerImage([
    { url: 'https://images.example/first-explicit.jpg', dims: [1920, 1080], sexual: 2, violence: 0 },
    { url: 'https://images.example/portrait.jpg', dims: [800, 1200], sexual: 0, violence: 0 },
    { url: 'https://images.example/four-three.jpg', dims: [1600, 1200], sexual: 0, violence: 0 },
    { url: 'https://images.example/wide.jpg', dims: [1280, 720], sexual: 0, violence: 0 },
  ]);

  assert.equal(selected, 'https://images.example/wide.jpg');
});

test('VNDB banner selection declines unsafe or unclassified screenshots', () => {
  assert.equal(selectVnBannerImage([
    { url: 'https://images.example/unclassified.jpg', dims: [1920, 1080] },
    { url: 'https://images.example/violent.jpg', dims: [1920, 1080], sexual: 0, violence: 2 },
  ]), null);
});

test('VNDB details request supplies selection metadata and UI never uses screenshot zero directly', () => {
  for (const field of ['screenshots.dims', 'screenshots.sexual', 'screenshots.violence']) {
    assert.match(registrySource, new RegExp(field.replace('.', '\\.')));
  }
  assert.match(uiSource, /selectVnBannerImage\(raw\.screenshots\)/u);
  assert.doesNotMatch(uiSource, /type === 'vn'[\s\S]{0,100}screenshots\?\.\[0\]/u);
});
