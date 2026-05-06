/**
 * backfill-missing-tg.mjs
 *
 * Через MTProto (gramjs) тянет последние N сообщений @pioblog,
 * находит пропущенные относительно репо, и через ту же логику что
 * sync-telegram.js процессит и сохраняет как md.
 *
 * Запуск:
 *   N=50 TG_API_ID=... TG_API_HASH=... TG_SESSION_STRING=... node scripts/backfill-missing-tg.mjs
 *   DRY_RUN=1 — не писать
 */
import { readdir, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { fixBody, extractTitleAndKicker, dropDuplicateTitleFromBody } from './lib/markdown.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BLOG_DIR = join(ROOT, 'src/content/blog');
const TG_IMG_DIR = join(ROOT, 'public/img/tg');

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const sessionString = process.env.TG_SESSION_STRING;
const N = Number(process.env.N || 30);
const DRY = process.env.DRY_RUN === '1';
if (!apiId || !apiHash || !sessionString) { console.error('💥 Need TG_API_ID/HASH/SESSION_STRING'); process.exit(1); }

// 1. Собрать существующие tg id в репо
const existing = new Set();
for (const f of (await readdir(BLOG_DIR)).filter((x) => x.endsWith('.md'))) {
	const raw = await readFile(join(BLOG_DIR, f), 'utf8');
	const m = raw.match(/^tgMessageId:\s*(\d+)/m);
	if (m) existing.add(Number(m[1]));
}
console.log(`📋 В репо: ${existing.size} TG-постов`);

const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, { connectionRetries: 5 });
await client.connect();
const channel = await client.getEntity('pioblog');

const messages = await client.getMessages(channel, { limit: N });
console.log(`📥 Загружено ${messages.length} последних сообщений из @pioblog`);

// Группируем по grouped_id (media-group): один post может состоять из несколько Telegram-сообщений.
// Берём только тот id, на котором есть текст — он "первый" в группе. Остальные = attachments.
const groupParents = new Map(); // grouped_id → primary message_id
for (const msg of messages) {
	if (msg.groupedId) {
		const gid = msg.groupedId.toString();
		if (msg.message) groupParents.set(gid, msg.id);
		else if (!groupParents.has(gid)) groupParents.set(gid, msg.id);
	}
}

function isAttachmentOfGroup(msg) {
	if (!msg.groupedId) return false;
	const parentId = groupParents.get(msg.groupedId.toString());
	return parentId !== msg.id;
}

const candidates = messages.filter(
	(msg) => !existing.has(msg.id) && !isAttachmentOfGroup(msg) && (msg.message || msg.media),
);

if (candidates.length === 0) {
	console.log('✅ Пропущенных постов не найдено');
	await client.disconnect();
	process.exit(0);
}

console.log(`\n⚠️  Найдено ${candidates.length} пропущенных постов:\n`);
for (const msg of candidates) {
	const text = (msg.message || '').replace(/\n/g, ' ').slice(0, 70) || '<media-only>';
	console.log(`  ${msg.id} · ${new Date(msg.date * 1000).toISOString().slice(0, 10)} · ${text}`);
}

if (DRY) { console.log('\n🚫 DRY_RUN — не пишу'); await client.disconnect(); process.exit(0); }

// === Обработка пропущенных ===
function slugifyTitle(text) {
	const map = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'iu',я:'ia' };
	return text.toLowerCase().split('').map((c) => map[c] ?? c).join('')
		.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-[^-]*$/, '') || 'post';
}

function entitiesToMarkdown(text, entities) {
	if (!entities || !entities.length) return text;
	// gramjs entities имеют поля offset/length/type типов MessageEntityBold etc.
	// Конвертим в простую markdown-разметку (как в sync-telegram.js).
	const parts = [];
	let cursor = 0;
	const sorted = [...entities].sort((a, b) => a.offset - b.offset);
	for (const e of sorted) {
		if (e.offset > cursor) parts.push({ type: 'text', value: text.slice(cursor, e.offset) });
		const segment = text.slice(e.offset, e.offset + e.length);
		const cls = e.className || e.constructor?.name;
		let md = segment;
		if (cls?.includes('Bold')) md = `**${segment}**`;
		else if (cls?.includes('Italic')) md = `*${segment}*`;
		else if (cls?.includes('Code')) md = `\`${segment}\``;
		else if (cls?.includes('TextUrl') || cls?.includes('MessageEntityTextUrl')) md = `[${segment}](${e.url})`;
		else if (cls?.includes('Url')) md = segment;
		else if (cls?.includes('Mention')) md = segment;
		parts.push({ type: 'entity', value: md });
		cursor = e.offset + e.length;
	}
	if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) });
	return parts.map((p) => p.value).join('');
}

async function downloadPhoto(client, msg, dir) {
	if (!msg.photo) return null;
	await mkdir(dir, { recursive: true });
	const path = join(dir, `${msg.id}.jpg`);
	const buf = await client.downloadMedia(msg, {});
	if (buf) {
		await writeFile(path, buf);
		return path;
	}
	return null;
}

let written = 0;
for (const msg of candidates) {
	const text = msg.message || '';
	const entities = msg.entities || [];
	let body = fixBody(entitiesToMarkdown(text, entities));
	const rawFirstLine = (text.split('\n')[0] || '').slice(0, 200);
	let { title, subtitle } = extractTitleAndKicker(rawFirstLine);
	if (!title.trim()) title = `tg-${msg.id}`;
	title = title.slice(0, 120);
	body = dropDuplicateTitleFromBody(body, title);
	const titleEscaped = title.replace(/'/g, "''");
	const subtitleEscaped = subtitle ? subtitle.replace(/'/g, "''") : '';

	// Slug — slugified первой строки + tg id
	const slug = `${slugifyTitle(title)}-${msg.id}`;
	const file = join(BLOG_DIR, `${slug}.md`);
	const date = new Date(msg.date * 1000).toISOString().slice(0, 10);

	let heroImage = '';
	// Качаем фото если есть в этом или в группе
	const groupedId = msg.groupedId?.toString();
	const groupMessages = groupedId
		? messages.filter((m) => m.groupedId?.toString() === groupedId)
		: [msg];
	const photoMessages = groupMessages.filter((m) => m.photo);
	if (photoMessages.length) {
		const tgImgDir = join(TG_IMG_DIR, String(msg.id));
		const downloaded = [];
		for (let i = 0; i < photoMessages.length; i++) {
			const p = await downloadPhoto(client, photoMessages[i], tgImgDir);
			if (p) downloaded.push(`/img/tg/${msg.id}/${i}.jpg`);
		}
		// Renaming для consistency
		await mkdir(tgImgDir, { recursive: true });
		for (let i = 0; i < photoMessages.length; i++) {
			const src = join(tgImgDir, `${photoMessages[i].id}.jpg`);
			const dst = join(tgImgDir, `${i}.jpg`);
			try { await copyFile(src, dst); } catch {}
		}
		heroImage = `/img/tg/${msg.id}/0.jpg`;
	}

	const fmLines = [
		'---',
		`title: '${titleEscaped}'`,
	];
	if (subtitleEscaped) fmLines.push(`subtitle: '${subtitleEscaped}'`);
	fmLines.push(
		`pubDate: '${date}'`,
		`tgMessageId: ${msg.id}`,
	);
	if (heroImage) fmLines.push(`heroImage: '${heroImage}'`);
	fmLines.push('---', '', body);
	const content = fmLines.join('\n');

	await writeFile(file, content, 'utf8');
	console.log(`  ✓ Написал ${slug}.md (${msg.id})`);
	written++;
}

console.log(`\n💾 Записано ${written} новых постов`);
await client.disconnect();
process.exit(0);
