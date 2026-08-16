import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertAllowedMetronPath,
  assertAllowedTmdbRequest,
  buildIgdbRequest,
  enforceRateLimit,
  escapeTelegramHtml,
  verifyTelegramWebhookSecret,
} from '../supabase/functions/_shared/validation.js';

test('provider boundary allowlists reject arbitrary operations and oversized pages', () => {
  assert.equal(assertAllowedTmdbRequest('/movie/550', { append_to_response: 'credits,images' }).path, '/movie/550');
  assert.throws(() => assertAllowedTmdbRequest('/configuration', {}), /path/i);
  assert.throws(() => assertAllowedMetronPath('/api/issue/?page_size=500'), /page_size/i);
  assert.throws(() => assertAllowedMetronPath('/api/users/1/'), /path/i);
});

test('IGDB structured requests escape search text and validate identifiers', () => {
  const request = buildIgdbRequest('searchGames', { query: 'quote"; fields *;', page: 1 });
  assert.match(request.query, /search "quote\\"; fields \*;"/);
  assert.throws(() => buildIgdbRequest('gameDetails', { id: '1; delete' }), /identifier/i);
  assert.throws(() => buildIgdbRequest('arbitrary', {}), /operation/i);
});

test('Telegram webhook authentication and generated HTML fail closed', () => {
  assert.equal(verifyTelegramWebhookSecret('secret', 'secret'), true);
  assert.equal(verifyTelegramWebhookSecret('', 'secret'), false);
  assert.equal(verifyTelegramWebhookSecret('secret', ''), false);
  assert.equal(escapeTelegramHtml('<b>unsafe & title</b>'), '&lt;b&gt;unsafe &amp; title&lt;/b&gt;');
});

test('Edge rate limiter rejects excess requests and supplies retry metadata', () => {
  const request = new Request('https://edge.test', { headers: { 'x-forwarded-for': '203.0.113.88' } });
  enforceRateLimit(request, { keyPrefix: 'test', limit: 1, now: 1_000, windowMs: 10_000 });
  assert.throws(
    () => enforceRateLimit(request, { keyPrefix: 'test', limit: 1, now: 1_001, windowMs: 10_000 }),
    error => error.status === 429 && error.retryAfterSeconds > 0,
  );
});
