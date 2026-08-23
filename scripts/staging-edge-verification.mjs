import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const parseEnv = (source) => Object.fromEntries(
  source.split(/\r?\n/u)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);
const staging = parseEnv(await readFile(new URL('../.env.staging.local', import.meta.url), 'utf8'));
const edgeSecrets = parseEnv(await readFile(new URL('../.env.staging.functions.local', import.meta.url), 'utf8'));
for (const name of [
  'SUPABASE_STAGING_PROJECT_REF', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_STAGING_SERVICE_ROLE_KEY', 'STAGING_USER_A_EMAIL', 'STAGING_USER_A_PASSWORD',
]) assert.ok(staging[name], `Missing ignored staging setting: ${name}`);
assert.ok(edgeSecrets.TELEGRAM_WEBHOOK_SECRET, 'Missing ignored staging Telegram test secret');
assert.equal(new URL(staging.VITE_SUPABASE_URL).hostname.split('.')[0], staging.SUPABASE_STAGING_PROJECT_REF);

const authClient = createClient(staging.VITE_SUPABASE_URL, staging.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
  email: staging.STAGING_USER_A_EMAIL,
  password: staging.STAGING_USER_A_PASSWORD,
});
assert.ifError(authError);
const accessToken = authData.session.access_token;
const baseUrl = `${staging.VITE_SUPABASE_URL}/functions/v1`;
const observedResponseBodies = [];

const invoke = async (name, body, { authenticated = true, headers = {}, method = 'POST' } = {}) => {
  const requestHeaders = {
    apikey: staging.VITE_SUPABASE_ANON_KEY,
    ...headers,
  };
  if (authenticated) requestHeaders.Authorization = `Bearer ${accessToken}`;
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}/${name}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  observedResponseBodies.push(text);
  return { status: response.status, text };
};

const providers = ['tmdb', 'igdb', 'metron', 'vn'];
for (const name of providers) {
  const response = await invoke(name, {}, { authenticated: false });
  assert.equal(response.status, 401, `${name} accepted a request without a user JWT`);
}
console.log('PASS provider Edge Functions reject requests without a user JWT.');

const invalidRequests = [
  ['tmdb', { path: '/configuration', query: {} }, /not allowed/iu],
  ['igdb', { operation: 'rawQuery', params: {} }, /not allowed/iu],
  ['metron', { endpoint: '/admin/users/' }, /not allowed/iu],
  ['vn', { operation: 'details', params: { id: 'not-a-vndb-id' } }, /invalid/iu],
];
for (const [name, body, pattern] of invalidRequests) {
  const response = await invoke(name, body);
  assert.equal(response.status, 400, `${name} did not reject an unallowlisted operation`);
  assert.match(response.text, pattern);
}
console.log('PASS provider operation/path allowlists reject structured invalid requests.');

const oversized = await invoke('tmdb', JSON.stringify({ path: '/movie/550', padding: 'x'.repeat(33_000) }));
assert.equal(oversized.status, 400);
assert.match(oversized.text, /too large/iu);
console.log('PASS Edge request payload bound rejects a body above 32,000 bytes.');

const successfulRequests = [
  ['tmdb', { path: '/movie/550', query: { language: 'en-US' } }],
  ['igdb', { operation: 'gameDetails', params: { id: 1942 } }],
  ['metron', { endpoint: '/issue/?series_name=Batman&page_size=1' }],
  ['vn', { operation: 'details', params: { id: 'v17' } }],
];
const providerResults = [];
for (const [name, body] of successfulRequests) {
  const response = await invoke(name, body);
  assert.equal(response.status, 200, `${name} provider runtime returned ${response.status}`);
  assert.doesNotThrow(() => JSON.parse(response.text), `${name} did not return JSON`);
  providerResults.push(name);
}
console.log(`PASS live staging provider proxy requests: ${providerResults.join(', ')}.`);

const telegramMethod = await invoke('telegram-logger', undefined, { authenticated: false, method: 'GET' });
assert.equal(telegramMethod.status, 405);
const telegramUnauthorized = await invoke('telegram-logger', { update_id: 1 }, { authenticated: false });
assert.equal(telegramUnauthorized.status, 401);
const telegramConfiguredGate = await invoke('telegram-logger', { update_id: 1 }, {
  authenticated: false,
  headers: { 'x-telegram-bot-api-secret-token': edgeSecrets.TELEGRAM_WEBHOOK_SECRET },
});
assert.equal(telegramConfiguredGate.status, 500);
assert.match(telegramConfiguredGate.text, /Configuration Error/iu);
console.log('PASS Telegram staging endpoint enforces POST and webhook secret; live bot configuration remains intentionally absent.');

const serviceClient = createClient(
  staging.VITE_SUPABASE_URL,
  staging.SUPABASE_STAGING_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);
const quotaHash = createHash('sha256').update(`staging-edge-${randomUUID()}`).digest('hex');
const firstQuota = await serviceClient.rpc('consume_edge_quota', {
  p_scope: 'tmdb', p_subject_hash: quotaHash, p_limit: 1,
});
assert.ifError(firstQuota.error);
assert.equal(firstQuota.data, true);
const secondQuota = await serviceClient.rpc('consume_edge_quota', {
  p_scope: 'tmdb', p_subject_hash: quotaHash, p_limit: 1,
});
assert.ifError(secondQuota.error);
assert.equal(secondQuota.data, false);
const invalidQuota = await serviceClient.rpc('consume_edge_quota', {
  p_scope: 'unrestricted', p_subject_hash: quotaHash, p_limit: 1,
});
assert.ok(invalidQuota.error);
console.log('PASS durable quota RPC allows the first request, denies the second, and rejects an invalid scope.');

for (const secret of Object.values(edgeSecrets)) {
  if (secret) assert.equal(observedResponseBodies.some((body) => body.includes(secret)), false);
}
await authClient.auth.signOut();
authClient.realtime.disconnect();
console.log('PASS Edge error responses did not expose configured staging secrets.');
console.log('PASS staging Edge verification (JWT, allowlists, bounds, providers, Telegram gate, quota, errors).');
