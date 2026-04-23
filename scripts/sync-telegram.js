/*
 * Telegram → Astro blog sync.
 *
 * Scrapes https://t.me/s/<channel> (public preview page — no auth needed),
 * converts visible messages into markdown posts in src/content/blog/.
 *
 * Notes:
 *   - t.me/s/ preview shows only ~20 most recent messages. New posts get picked up
 *     on each run; very old posts need to be imported once via the one-time
 *     migrate-posts.mjs script from vedulix-blog.
 *   - Posts are de-duplicated by the TG message id embedded in the filename
 *     (`tg-<id>.md`). Existing files with the same id are skipped.
 *   - Images are downloaded once into /public/img/tg/<id>/ and referenced
 *     by relative URL in the markdown body.
 *
 * Env:
 *   TG_CHANNEL  — channel username (default: pioblog)
 *   DRY_RUN=1   — don't write files, just log what would happen
 */

import { load as loadHtml } from 'cheerio';
import { mkdir, stat, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(REPO_ROOT, 'src', 'content', 'blog');
const IMAGES_DIR = path.join(REPO_ROOT, 'public', 'img', 'tg');

const CHANNEL = process.env.TG_CHANNEL || 'pioblog';
const DRY_RUN = !!process.env.DRY_RUN;
const USER_AGENT = 'Mozilla/5.0 (compatible; pioblog-sync/1.0)';

async function httpGet(url) {
	return new Promise((resolve, reject) => {
		https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				return httpGet(res.headers.location).then(resolve, reject);
			}
			if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} ${url}`));
			const chunks = [];
			res.on('data', (c) => chunks.push(c));
			res.on('end', () => resolve(Buffer.concat(chunks)));
			res.on('error', reject);
		}).on('error', reject);
	});
}

async function downloadImage(url, targetPath) {
	if (existsSync(targetPath)) return;
	const buf = await httpGet(url);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, buf);
}

function slugifyTitle(text, fallback) {
	const cleaned = (text || '')
		.replace(/[\r\n]+/g, ' ')
		.replace(/[^\p{L}\p{N}\s-]+/gu, '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.slice(0, 60);
	return cleaned || fallback;
}

function extractFirstLine(text) {
	const line = text.split('\n')[0].trim();
	return line.slice(0, 120);
}

function escapeYaml(s) {
	return (s || '').replace(/'/g, "''").replace(/[\r\n]+/g, ' ').trim();
}

function buildFrontmatter(fields) {
	const lines = ['---'];
	for (const [k, v] of Object.entries(fields)) {
		if (v === undefined || v === null || v === '') continue;
		if (Array.isArray(v)) {
			lines.push(`${k}: [${v.map((x) => `'${escapeYaml(x)}'`).join(', ')}]`);
		} else {
			lines.push(`${k}: '${escapeYaml(String(v))}'`);
		}
	}
	lines.push('---');
	return lines.join('\n');
}

function messageUrlToId(href) {
	const m = href?.match(/\/([^/]+)\/(\d+)$/);
	return m ? Number(m[2]) : null;
}

function parseMessages(html) {
	const $ = loadHtml(html);
	const msgs = [];
	$('.tgme_widget_message').each((_, el) => {
		const $m = $(el);
		const href = $m.find('a.tgme_widget_message_date').attr('href') || '';
		const id = messageUrlToId(href);
		if (!id) return;
		const datetimeAttr = $m.find('a.tgme_widget_message_date time').attr('datetime');
		const date = datetimeAttr ? new Date(datetimeAttr) : new Date();

		const $text = $m.find('.tgme_widget_message_text').first();
		// Keep paragraph breaks: convert <br> to \n before extracting text
		$text.find('br').replaceWith('\n');
		const text = $text.text().trim();

		// Images via .tgme_widget_message_photo_wrap style="background-image:url('...')"
		const images = [];
		$m.find('.tgme_widget_message_photo_wrap').each((_, w) => {
			const style = $(w).attr('style') || '';
			const m2 = style.match(/url\(['"]?([^'")]+)['"]?\)/);
			if (m2) images.push(m2[1]);
		});

		msgs.push({ id, date, text, images, href });
	});
	return msgs;
}

async function listExistingTgIds() {
	try {
		const files = await readdir(POSTS_DIR);
		const ids = new Set();
		for (const f of files) {
			const m = f.match(/^tg-(\d+)\.md$/);
			if (m) ids.add(Number(m[1]));
		}
		return ids;
	} catch {
		return new Set();
	}
}

async function main() {
	console.log(`🚀 TG sync start ${DRY_RUN ? '[DRY_RUN]' : '[LIVE]'} channel=${CHANNEL}`);
	const html = (await httpGet(`https://t.me/s/${CHANNEL}`)).toString('utf8');
	const messages = parseMessages(html);
	console.log(`  parsed ${messages.length} messages from preview`);

	const existing = await listExistingTgIds();
	const newOnes = messages.filter((m) => !existing.has(m.id));
	console.log(`  new: ${newOnes.length}, existing: ${messages.length - newOnes.length}`);

	let wrote = 0;
	for (const msg of newOnes) {
		if (!msg.text && msg.images.length === 0) continue;

		const title = extractFirstLine(msg.text) || `Запись ${msg.id}`;
		const yy = msg.date.getFullYear();
		const mm = String(msg.date.getMonth() + 1).padStart(2, '0');
		const dd = String(msg.date.getDate()).padStart(2, '0');
		const pubDate = `${yy}-${mm}-${dd}`;

		// Images
		const imgRefs = [];
		let heroImage;
		for (let i = 0; i < msg.images.length; i++) {
			const url = msg.images[i];
			const ext = (url.match(/\.([a-z0-9]{3,4})(?:\?|$)/i)?.[1] || 'jpg').toLowerCase();
			const filename = `${i}.${ext}`;
			const rel = `/pioblog/img/tg/${msg.id}/${filename}`;
			const abs = path.join(IMAGES_DIR, String(msg.id), filename);
			if (!DRY_RUN) await downloadImage(url, abs);
			imgRefs.push(rel);
			if (i === 0) heroImage = rel;
		}

		const body = msg.text.split('\n').map((l) => l.trim()).join('\n').trim();
		const extraImages = imgRefs.slice(1).map((r) => `![](${r})`).join('\n\n');
		const fullBody = [body, extraImages].filter(Boolean).join('\n\n');

		const fm = buildFrontmatter({
			title,
			pubDate,
			tags: ['telegram'],
			heroImage,
		});

		const filePath = path.join(POSTS_DIR, `tg-${msg.id}.md`);
		const content = `${fm}\n\n${fullBody}\n`;
		if (DRY_RUN) {
			console.log(`  [DRY] would write ${filePath}`);
		} else {
			await writeFile(filePath, content, 'utf8');
			console.log(`  ✓ tg-${msg.id}.md — ${title.slice(0, 40)}`);
		}
		wrote++;
	}
	console.log(`\n📊 wrote ${wrote} new posts`);
}

main().catch((err) => {
	console.error('💥', err);
	process.exit(1);
});
