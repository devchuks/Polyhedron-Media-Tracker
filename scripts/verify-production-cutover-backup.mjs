import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [file] = process.argv.slice(2);
assert.ok(file, 'Usage: node scripts/verify-production-cutover-backup.mjs <query-output.json>');
const source = await readFile(file, 'utf8');
const start = source.indexOf('{');
const end = source.lastIndexOf('}');
assert.ok(start >= 0 && end > start, 'Backup output does not contain a JSON envelope');
const envelope = JSON.parse(source.slice(start, end + 1));
const backup = envelope.rows?.[0]?.production_cutover_backup;
assert.ok(backup, 'Backup payload is missing');
assert.ok(Array.isArray(backup.media_library) && Array.isArray(backup.media_logs), 'Backup row arrays are missing');
assert.equal(backup.media_count, backup.media_library.length, 'Media backup count mismatch');
assert.equal(backup.log_count, backup.media_logs.length, 'Diary backup count mismatch');
assert.ok(backup.media_library.every(row => row.user_id && row.id && row.type), 'Media owner/identity data is incomplete');
assert.ok(backup.media_logs.every(row => row.user_id && row.log_id && row.media_id), 'Diary owner/identity data is incomplete');
console.log(`Verified readable production backup: ${backup.media_count} media / ${backup.log_count} logs.`);
