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

/* TG хранит пользовательский текст с одиночными `\n` между визуально-
   разделёнными строками. TG клиент рендерит их с визуальным зазором →
   пользователь воспринимает как абзацы. Markdown же трактует single `\n`
   как soft-break (тот же параграф). Превращаем каждый \n в \n\n вне code
   fences, плюс заранее разбиваем многострочные bold/italic spans на
   per-line чтобы `*`-маркеры не осиротели. */
function splitMultilineEmphasis(body) {
	// **text** first (to avoid consuming single `*`)
	body = body.replace(/\*\*([^*][\s\S]*?[^*]|[^*])\*\*/g, (m, inner) => {
		if (!inner.includes('\n')) return m;
		return inner.split('\n')
			.map((l) => l.trim() ? `**${l.trim()}**` : '')
			.join('\n');
	});
	// Single *text*  (not preceded/followed by another *)
	body = body.replace(/(?<!\*)\*([^*][\s\S]*?[^*]|[^*])\*(?!\*)/g, (m, inner) => {
		if (!inner.includes('\n')) return m;
		return inner.split('\n')
			.map((l) => l.trim() ? `*${l.trim()}*` : '')
			.join('\n');
	});
	return body;
}

function paragraphize(body) {
	// Разбиваем по ```code fences``` — внутри них newlines не трогаем.
	const parts = body.split(/(```[\s\S]*?```)/g);
	return parts.map((part, i) => {
		if (i % 2 === 1) return part; // code fence — as is
		return part.replace(/\n+/g, '\n\n');
	}).join('');
}

function fixParagraphs(body) {
	return paragraphize(splitMultilineEmphasis(body));
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
			case 'text_link':     wrapped = `[${inner}](${e.url})`; break;
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

async function listExistingTgIds() {
	try {
		const files = await readdir(POSTS_DIR);
		const ids = new Set();
		for (const f of files) {
			if (!f.endsWith('.md')) continue;
			const m = f.match(/-(\d+)\.md$/);
			if (m) ids.add(Number(m[1]));
		}
		return ids;
	} catch { return new Set(); }
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
	const body = fixParagraphs(entitiesToMarkdown(text, entities));

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
		const rel = `/pioblog/img/tg/${msg.message_id}/${filename}`;
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
	// Document (для video/file — не скачиваем пока, только метка)
	// Animation/video — пропускаем, можно добавить позже

	const date = new Date(msg.date * 1000);
	const pubDate = date.toISOString().slice(0, 10);
	// Для title берём первую строку из ПЛЕЙНОГО текста (без markdown-разметки),
	// иначе title начнётся с *bold* или подобного маркера.
	const plain = text || '';
	const firstLine = (plain.split('\n')[0] || '').slice(0, 120) || `Запись ${msg.message_id}`;

	const fm = buildFrontmatter({
		title: firstLine,
		pubDate,
		heroImage,
	});

	const extraImages = imgRefs.slice(1).map((r) => `![](${r})`).join('\n\n');
	const fullBody = [body, extraImages].filter(Boolean).join('\n\n');
	const content = `${fm}\n\n${fullBody}\n`;

	const dst = path.join(POSTS_DIR, `tg-${msg.message_id}.md`);
	if (DRY_RUN) {
		console.log(`  [DRY] would write ${dst}\n    ${firstLine.slice(0, 60)}`);
	} else {
		await writeFile(dst, content, 'utf8');
		console.log(`  ✓ tg-${msg.message_id}.md — ${firstLine.slice(0, 40)}`);
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
