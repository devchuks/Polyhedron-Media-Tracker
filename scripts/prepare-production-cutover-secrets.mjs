import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';

const parseEnv = (source = '') => Object.fromEntries(
  source.split(/\r?\n/u)
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const readEnv = async (url) => {
  try { return parseEnv(await readFile(url, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
};

const legacy = await readEnv(new URL('../.env', import.meta.url));
const stagingFunctions = await readEnv(new URL('../.env.staging.functions.local', import.meta.url));
const targetUrl = new URL('../.env.production-cutover.local', import.meta.url);
const existing = await readEnv(targetUrl);

const firstValue = (...values) => values.find(value => typeof value === 'string' && value.length > 0);
const prepared = {
  TWITCH_CLIENT_ID: firstValue(existing.TWITCH_CLIENT_ID, legacy.VITE_TWITCH_CLIENT_ID, stagingFunctions.TWITCH_CLIENT_ID),
  TWITCH_CLIENT_SECRET: firstValue(existing.TWITCH_CLIENT_SECRET, legacy.VITE_TWITCH_CLIENT_SECRET, stagingFunctions.TWITCH_CLIENT_SECRET),
  METRON_USERNAME: firstValue(existing.METRON_USERNAME, legacy.VITE_METRON_USERNAME, stagingFunctions.METRON_USERNAME),
  METRON_PASSWORD: firstValue(existing.METRON_PASSWORD, legacy.VITE_METRON_PASSWORD, stagingFunctions.METRON_PASSWORD),
  TELEGRAM_WEBHOOK_SECRET: /^[a-f0-9]{64}$/u.test(existing.TELEGRAM_WEBHOOK_SECRET || '')
    ? existing.TELEGRAM_WEBHOOK_SECRET
    : randomBytes(32).toString('hex'),
};

for (const [name, value] of Object.entries(prepared)) assert.ok(value, `${name} could not be recovered or generated`);
assert.match(prepared.TELEGRAM_WEBHOOK_SECRET, /^[a-f0-9]{64}$/u);

const output = [
  '# LOCAL PRODUCTION CUTOVER INPUTS — ignored by Git; never commit or print this file.',
  ...Object.entries(prepared).map(([name, value]) => `${name}=${value}`),
  '',
].join('\n');
const temporaryUrl = new URL('../.env.production-cutover.local.tmp', import.meta.url);
await writeFile(temporaryUrl, output, { encoding: 'utf8', mode: 0o600 });
await rename(temporaryUrl, targetUrl);
await chmod(targetUrl, 0o600).catch(() => {});

for (const name of Object.keys(prepared)) {
  console.log(`${name}: ${name === 'TELEGRAM_WEBHOOK_SECRET' ? 'securely prepared locally' : 'recoverable locally'}`);
}
