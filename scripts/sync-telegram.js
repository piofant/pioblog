/*
 * Telegram Bot API → Astro blog sync.
 *
 * Бот `@pioblog_bot` добавлен админом в канал `@pioblog`. Workflow по cron
 * делает `getUpdates` — Telegram отдаёт все новые `channel_post` events
 * (появившиеся с момента как бот стал админом). Для каждого поста:
 *   - текст + entities (bold/italic/code/links/mentions) → markdown
 *   - фото → скачиваем через getFile в public/img/tg/<id>/
 *   - пишем src/content/blog/tg-<id>.md
 *
 * Дедуп: если файл tg-<id>.md уже есть — пропускаем. Это даёт устойчивость
 * к повторным запускам.
 *
 * Ограничение Bot API: бот не видит историю до момента, когда его сделали
 * админом. Для старых постов — одноразовый импорт через migrate-posts.mjs.
 *
 * Env:
 *   TG_BOT_TOKEN — токен бота (от @BotFather)
 *   TG_CHANNEL   — username канала, default: pioblog
 *   DRY_RUN=1    — не пишем файлы, только логируем
 */

import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { fixBody as fixParagraphs } from './lib/markdown.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(REPO_ROOT, 'src', 'content', 'blog');
const IMAGES_DIR = path.join(REPO_ROOT, 'public', 'img', 'tg');

const TOKEN = process.env.TG_BOT_TOKEN;
const CHANNEL = (process.env.TG_CHANNEL || 'pioblog').toLowerCase();
const DRY_RUN = !!process.env.DRY_RUN;

if (!TOKEN) { console.error('TG_BOT_TOKEN required'); process.exit(1); }

const API = `https://api.telegram.org/bot${TOKEN}`;
const FILE = `https://api.telegram.org/file/bot${TOKEN}`;

async function apiCall(method, params = {}) {
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
	}
	return new Promise((resolve, reject) => {
		https.get(`${API}/${method}?${qs}`, (res) => {
			const chunks = [];
			res.on('data', (c) => chunks.push(c));
			res.on('end', () => {
				try {
					const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
					if (!body.ok) return reject(new Error(`${method}: ${body.description}`));
					resolve(body.result);
				} catch (e) { reject(e); }
			});
			res.on('error', reject);
		}).on('error', reject);
	});
}

async function downloadTo(url, abs) {
	if (existsSync(abs)) return;
	await mkdir(path.dirname(abs), { recursive: true });
	await new Promise((resolve, reject) => {
		https.get(url, (res) => {
			if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
			const chunks = [];
			res.on('data', (c) => chunks.push(c));
			res.on('end', async () => {
				try { await writeFile(abs, Buffer.concat(chunks)); resolve(); }
				catch (e) { reject(e); }
			});
			res.on('error', reject);
		}).on('error', reject);
	});
}

/* paragraphize/splitMultilineEmphasis перенесены в scripts/lib/markdown.mjs —
   общий lib для всех скриптов, которые пишут post bodies. */

/* TG-author может писать `t.me/<id>` как сокращение «текущий канал, пост N».
   Bot API возвращает URL как есть, и без префикса канала ссылка ломается.
   Раскрываем в полный `t.me/<channel>/<id>`. */
function normalizeChannelUrl(url) {
	if (!url) return url;
	const m = url.match(/^https?:\/\/t\.me\/(\d+)\/?$/);
	if (m) return `https://t.me/${CHANNEL}/${m[1]}`;
	return url;
}

function entitiesToMarkdown(text, entities) {
	if (!entities || !entities.length) return text;
	// Применяем с конца — чтобы offsets не смещались.
	const sorted = [...entities].sort((a, b) => b.offset - a.offset);
	// Для UTF-16 корректного slicing используем string как array-of-code-units.
	const units = Array.from({ length: text.length }, (_, i) => text[i]);
	for (const e of sorted) {
		const inner = text.slice(e.offset, e.offset + e.length);
		let wrapped = inner;
		switch (e.type) {
			case 'bold':          wrapped = `**${inner}**`; break;
			case 'italic':        wrapped = `*${inner}*`; break;
			case 'underline':     wrapped = `<u>${inner}</u>`; break;
			case 'strikethrough': wrapped = `~~${inner}~~`; break;
			case 'spoiler':       wrapped = `||${inner}||`; break;
			case 'code':          wrapped = `\`${inner}\``; break;
			case 'pre':           wrapped = `\`\`\`${e.language || ''}\n${inner}\n\`\`\``; break;
			case 'text_link':     wrapped = `[${inner}](${normalizeChannelUrl(e.url)})`; break;
			case 'url':           wrapped = `<${inner}>`; break;
			case 'mention':       wrapped = `[${inner}](https://t.me/${inner.replace(/^@/, '')})`; break;
			case 'text_mention':  wrapped = e.user?.id ? `[${inner}](tg://user?id=${e.user.id})` : inner; break;
			case 'blockquote':    wrapped = inner.split('\n').map((l) => `> ${l}`).join('\n'); break;
			case 'hashtag':
			case 'cashtag':
			case 'bot_command':
			case 'email':
			case 'phone_number':
			default: break; // оставляем как есть
		}
		text = text.slice(0, e.offset) + wrapped + text.slice(e.offset + e.length);
	}
	return text;
}

/* Транслитерация → латиница для slug'а filename'а. GOST 7.79 (~ISO9). */
const TRANSLIT = {
	а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',
	к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
	х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'iu',я:'ia',
};
function slugify(title, maxLen = 60) {
	let s = (title || '').toLowerCase();
	s = s.split('').map((c) => (TRANSLIT[c] !== undefined ? TRANSLIT[c] : c)).join('');
	s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	if (s.length > maxLen) {
		// don't break in the middle of a word — trim back to last `-`
		s = s.slice(0, maxLen).replace(/-[^-]*$/, '');
	}
	return s || 'tg';
}

import { open as fsOpen } from 'node:fs/promises';

async function listExistingTgIds() {
	// Дедуп по двум источникам:
	//   1. Legacy: filename `tg-NNN.md` (тот самый паттерн, что писал этот скрипт раньше)
	//   2. Новый: frontmatter поле `tgMessageId: NNN` — пишется в новые файлы
	//      с осмысленным slug'ом `{slug}-{msg_id}.md`.
	// Раньше regex `-(\d+)\.md$` ложно ловил миграционные файлы из других каналов
	// (типа `lsh-logbook-den-1-431.md` где `-431` — TG ID из другого канала) и
	// скипал новые посты с совпадающими ID — навсегда теряя их из getUpdates после ACK.
	const ids = new Set();
	try {
		const files = await readdir(POSTS_DIR);
		for (const f of files) {
			if (!f.endsWith('.md')) continue;
			const legacy = f.match(/^tg-(\d+)\.md$/);
			if (legacy) { ids.add(Number(legacy[1])); continue; }
			try {
				const fh = await fsOpen(path.join(POSTS_DIR, f), 'r');
				const buf = Buffer.alloc(800);
				await fh.read(buf, 0, 800, 0);
				await fh.close();
				const txt = buf.toString('utf8');
				const fm = txt.match(/^---\n([\s\S]*?)\n---/);
				if (fm) {
					const idMatch = fm[1].match(/^tgMessageId:\s*(\d+)/m);
					if (idMatch) ids.add(Number(idMatch[1]));
				}
			} catch {}
		}
	} catch {}
	return ids;
}

function escapeYaml(s) { return (s || '').replace(/'/g, "''").replace(/[\r\n]+/g, ' ').trim(); }
function buildFrontmatter(fields) {
	const lines = ['---'];
	for (const [k, v] of Object.entries(fields)) {
		if (v === undefined || v === null || v === '') continue;
		if (Array.isArray(v)) {
			if (v.length === 0) continue;
			lines.push(`${k}: [${v.map((x) => `'${escapeYaml(x)}'`).join(', ')}]`);
		} else {
			lines.push(`${k}: '${escapeYaml(String(v))}'`);
		}
	}
	lines.push('---');
	return lines.join('\n');
}

/* msg может быть из Updates (channel_post) или передан напрямую (media_group
   процессится как отдельный канальный post + attached photo). */
async function processPost(msg, existing) {
	if (existing.has(msg.message_id)) {
		console.log(`  skip tg-${msg.message_id} (exists)`);
		return false;
	}
	const text = msg.text || msg.caption || '';
	const entities = msg.entities || msg.caption_entities || [];
	let body = fixParagraphs(entitiesToMarkdown(text, entities));

	// Photo: собираем либо из msg._photos (media_group merged), либо из msg.photo (одиночный)
	const imgRefs = [];
	let heroImage;
	const photos = msg._photos && msg._photos.length
		? msg._photos
		: (msg.photo && msg.photo.length ? [msg.photo[msg.photo.length - 1]] : []);

	// Skip stub messages: no text and no media. They surface as "Запись N"
	// posts with empty bodies — useless on the feed.
	const hasMedia = photos.length > 0
		|| !!msg.video || !!msg.audio || !!msg.voice
		|| !!msg.video_note || !!msg.document || !!msg.animation;
	if (!text.trim() && !hasMedia) {
		console.log(`  skip tg-${msg.message_id} (no text + no media)`);
		return false;
	}
	for (let i = 0; i < photos.length; i++) {
		const p = photos[i];
		const filename = `${i}.jpg`;
		const rel = `/img/tg/${msg.message_id}/${filename}`;
		const abs = path.join(IMAGES_DIR, String(msg.message_id), filename);
		if (!DRY_RUN) {
			try {
				const info = await apiCall('getFile', { file_id: p.file_id });
				await downloadTo(`${FILE}/${info.file_path}`, abs);
			} catch (e) {
				console.warn(`    ⚠ photo fail: ${e.message}`);
			}
		}
		imgRefs.push(rel);
		if (i === 0) heroImage = rel;
	}

	// Voice (.ogg) — скачиваем и встраиваем <audio>. Bot API ограничивает getFile
	// 20MB, голосовые pioblog обычно ≤2MB.
	let voiceEmbed = '';
	if (msg.voice && msg.voice.file_id) {
		const v = msg.voice;
		const filename = 'voice.ogg';
		const rel = `/img/tg/${msg.message_id}/${filename}`;
		const abs = path.join(IMAGES_DIR, String(msg.message_id), filename);
		if (!DRY_RUN) {
			try {
				const info = await apiCall('getFile', { file_id: v.file_id });
				await downloadTo(`${FILE}/${info.file_path}`, abs);
			} catch (e) {
				console.warn(`    ⚠ voice fail: ${e.message}`);
			}
		}
		const dur = v.duration ? ` (${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, '0')})` : '';
		voiceEmbed = `<audio controls preload="metadata" src="${rel}"></audio>${dur ? `\n\n_голосовое${dur}_` : ''}`;
	}

	// Document (для video/file — не скачиваем пока, только метка)
	// Animation/video — пропускаем, можно добавить позже

	const date = new Date(msg.date * 1000);
	const pubDate = date.toISOString().slice(0, 10);
	// Title — первая строка ПЛЕЙНОГО текста. Если она заканчивается на kicker
	// `[часть N]` / `[N/M]` / `[анонс]` etc. — отрезаем его в subtitle.
	// Это убирает мусор типа `[часть 1\n]` из title и даёт visual subtitle.
	const plain = text || '';
	const rawFirstLine = (plain.split('\n')[0] || '').slice(0, 200);
	let title = rawFirstLine;
	let subtitle = '';
	const kickerMatch = rawFirstLine.match(/^(.*?)\s*\[([^\[\]]{1,40})\]\s*$/);
	if (kickerMatch && kickerMatch[1].trim()) {
		title = kickerMatch[1].trim();
		// Чистим литеральные `\n` / `\r` / лишние пробелы — авторы иногда так
		// маркируют незавершённую серию (`часть 1\n` — где N это placeholder).
		subtitle = kickerMatch[2].replace(/\\[nrt]/g, '').replace(/\s+/g, ' ').trim();
	}
	if (!title.trim()) title = `Запись ${msg.message_id}`;
	title = title.slice(0, 120);

	// Если первый параграф body дублирует title (с/без markdown-обрамления и
	// kicker-скобок) — выкидываем его, чтоб title не повторялся в excerpt'e.
	const cleanForCompare = (s) => s
		.replace(/\*+/g, '')
		.replace(/\\[nrt]/g, '')
		.replace(/\[[^\[\]]{1,40}\]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
	const firstBodyPara = (body.split(/\n{2,}/)[0] || '').trim();
	if (firstBodyPara && cleanForCompare(firstBodyPara).startsWith(cleanForCompare(title).slice(0, 40))) {
		body = body.replace(/^[\s\S]*?(\n{2,}|$)/, '').trimStart();
	}

	const fm = buildFrontmatter({
		title,
		subtitle: subtitle || undefined,
		pubDate,
		tgMessageId: msg.message_id,
		heroImage,
	});

	const extraImages = imgRefs.slice(1).map((r) => `![](${r})`).join('\n\n');
	const fullBody = [body, voiceEmbed, extraImages].filter(Boolean).join('\n\n');
	const content = `${fm}\n\n${fullBody}\n`;

	const slug = slugify(title);
	const dst = path.join(POSTS_DIR, `${slug}-${msg.message_id}.md`);
	if (DRY_RUN) {
		console.log(`  [DRY] would write ${dst}\n    ${title.slice(0, 60)}`);
	} else {
		await writeFile(dst, content, 'utf8');
		console.log(`  ✓ tg-${msg.message_id}.md — ${title.slice(0, 40)}`);
	}
	existing.add(msg.message_id);
	return true;
}

async function main() {
	console.log(`🚀 TG Bot API sync ${DRY_RUN ? '[DRY]' : '[LIVE]'}  channel=@${CHANNEL}`);

	// Sanity check
	const me = await apiCall('getMe');
	console.log(`  bot: @${me.username}  (id ${me.id})`);

	const existing = await listExistingTgIds();
	let written = 0;
	let offset = 0;
	let guard = 0;

	// Собираем все подходящие сообщения из updates — потом группируем по media_group_id.
	const buckets = new Map();  // key: groupKey → Array of normalized {msg, origId, origDate, mgid}
	const loose = [];           // посты без media_group
	const pushMsg = (msg, origId, origDate) => {
		const mgid = msg.media_group_id;
		const item = { msg, origId, origDate, mgid };
		if (mgid) {
			const key = `mg:${mgid}`;
			if (!buckets.has(key)) buckets.set(key, []);
			buckets.get(key).push(item);
		} else {
			loose.push(item);
		}
	};

	while (guard++ < 20) {
		const updates = await apiCall('getUpdates', {
			offset,
			limit: 100,
			timeout: 0,
			allowed_updates: ['channel_post', 'edited_channel_post', 'message'],
		});
		if (!updates.length) break;
		console.log(`  batch: ${updates.length} updates`);

		for (const u of updates) {
			offset = Math.max(offset, u.update_id + 1);

			const post = u.channel_post || u.edited_channel_post;
			if (post) {
				const uname = (post.chat && post.chat.username) || '';
				if (uname.toLowerCase() === CHANNEL) pushMsg(post, post.message_id, post.date);
				continue;
			}

			const msg = u.message;
			if (!msg) continue;
			const fo = msg.forward_origin;
			const legacyChat = msg.forward_from_chat;
			const fwdChannelUsername = (fo?.type === 'channel' ? fo.chat?.username : legacyChat?.username) || '';
			if (fwdChannelUsername.toLowerCase() !== CHANNEL) continue;
			const origId = fo?.message_id ?? msg.forward_from_message_id;
			const origDate = fo?.date ?? msg.forward_date ?? msg.date;
			if (!origId) continue;
			pushMsg(msg, origId, origDate);
		}
	}

	// Обработка: для каждой media-group склеиваем фото + caption из того, где он есть.
	for (const [key, items] of buckets) {
		// Сортируем по оригинальному id, чтобы порядок фоток сохранялся.
		items.sort((a, b) => a.origId - b.origId);
		const withText = items.find((i) => i.msg.caption || i.msg.text) || items[0];
		const merged = { ...withText.msg };
		// Собираем все фото из всех items (каждый item имеет свой msg.photo[])
		merged._photos = items.map((i) => i.msg.photo?.[i.msg.photo.length - 1]).filter(Boolean);
		merged.message_id = withText.origId;
		merged.date = withText.origDate;
		try {
			if (await processPost(merged, existing)) written++;
		} catch (e) { console.warn(`  ✗ tg-${withText.origId}: ${e.message}`); }
	}
	for (const item of loose) {
		const pseudo = { ...item.msg, message_id: item.origId, date: item.origDate };
		try {
			if (await processPost(pseudo, existing)) written++;
		} catch (e) { console.warn(`  ✗ tg-${item.origId}: ${e.message}`); }
	}

	// Подтверждаем offset — Telegram очистит очередь.
	if (offset > 0 && !DRY_RUN) {
		await apiCall('getUpdates', { offset, timeout: 0 });
	}

	console.log(`\n📊 wrote ${written} new posts`);
}

main().catch((err) => {
	console.error('💥', err);
	process.exit(1);
});
