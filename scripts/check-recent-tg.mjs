/**
 * Quick debug: спрашивает у канала @pioblog последние N сообщений через MTProto
 * и показывает какие из них уже есть в репо, а какие пропущены.
 *
 * Запуск (в GH Action через workflow_dispatch или локально с тем же env):
 *   TG_API_ID=... TG_API_HASH=... TG_SESSION_STRING=... node scripts/check-recent-tg.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = join(__dirname, '..', 'src/content/blog');
const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const sessionString = process.env.TG_SESSION_STRING;
if (!apiId || !apiHash || !sessionString) {
	console.error('💥 Need TG_API_ID/HASH/SESSION_STRING'); process.exit(1);
}

const N = Number(process.env.N || 20);

const ids = new Set();
for (const f of (await readdir(BLOG_DIR)).filter((x) => x.endsWith('.md'))) {
	const raw = await readFile(join(BLOG_DIR, f), 'utf8');
	const m = raw.match(/^tgMessageId:\s*(\d+)/m);
	if (m) ids.add(Number(m[1]));
}

const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, { connectionRetries: 5 });
await client.connect();
const channel = await client.getEntity('pioblog');
console.log(`Channel: @pioblog · в репо: ${ids.size} постов`);

const messages = await client.getMessages(channel, { limit: N });
console.log(`\nПоследние ${N} сообщений в @pioblog:\n`);
for (const msg of messages) {
	const inRepo = ids.has(msg.id) ? '✓ в репо' : '✗ ПРОПУЩЕН';
	const text = (msg.message || '').replace(/\n/g, ' ').slice(0, 70) || '<media-only>';
	const date = new Date(msg.date * 1000).toISOString().slice(0, 16).replace('T', ' ');
	console.log(`  ${msg.id.toString().padStart(4)} · ${date} · ${inRepo} · ${text}`);
}

await client.disconnect();
process.exit(0);
