/*
 * Notion database → Astro blog sync.
 *
 * Queries a Notion DATABASE for blog posts and writes them as markdown files
 * to src/content/blog/<slug>.md. Images are downloaded to /public/img/notion/<slug>/.
 *
 * Expected Notion database schema (user creates this DB and shares with integration):
 *   - "Title"      (title)               — post title
 *   - "Subtitle"   (rich_text, optional) — subtitle
 *   - "Slug"       (rich_text, optional) — custom slug; auto-generated from title if empty
 *   - "Tags"       (multi_select, opt)   — tags
 *   - "PubDate"    (date)                — publication date
 *   - "Published"  (checkbox)            — only pages with true are synced
 *
 * Env:
 *   NOTION_TOKEN        — Internal Integration Secret
 *   NOTION_DATABASE_ID  — the database id (UUID with or without dashes)
 *   DRY_RUN=1           — skip writes, log only
 */

import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import crypto from 'node:crypto';
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(REPO_ROOT, 'src', 'content', 'blog');
const IMAGES_DIR = path.join(REPO_ROOT, 'public', 'img', 'notion');

const DRY_RUN = !!process.env.DRY_RUN;
const TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_DATABASE_ID;

if (!DRY_RUN && !TOKEN) { console.error('NOTION_TOKEN required'); process.exit(1); }
if (!DRY_RUN && !DB_ID) { console.error('NOTION_DATABASE_ID required'); process.exit(1); }

const notion = DRY_RUN ? null : new Client({ auth: TOKEN, notionVersion: '2026-03-11' });

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

function slugify(text) {
	return (text || '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60) || 'post';
}
function shortHash(s, n = 8) {
	return crypto.createHash('sha256').update(s).digest('hex').slice(0, n);
}
function escapeYaml(s) {
	return (s || '').replace(/'/g, "''").replace(/[\r\n]+/g, ' ').trim();
}
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

function getPlain(prop) {
	if (!prop) return '';
	if (prop.type === 'title') return prop.title.map((t) => t.plain_text).join('');
	if (prop.type === 'rich_text') return prop.rich_text.map((t) => t.plain_text).join('');
	if (prop.type === 'multi_select') return prop.multi_select.map((t) => t.name);
	if (prop.type === 'date') return prop.date?.start || null;
	if (prop.type === 'checkbox') return prop.checkbox;
	if (prop.type === 'url') return prop.url || '';
	return '';
}

async function downloadImage(url, abs) {
	if (existsSync(abs)) return;
	await mkdir(path.dirname(abs), { recursive: true });
	await new Promise((resolve, reject) => {
		https.get(url, (res) => {
			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				return downloadImage(res.headers.location, abs).then(resolve, reject);
			}
			if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
			const chunks = [];
			let bytes = 0;
			res.on('data', (c) => {
				bytes += c.length;
				if (bytes > MAX_IMAGE_BYTES) { res.destroy(); return reject(new Error('image too big')); }
				chunks.push(c);
			});
			res.on('end', async () => { try { await writeFile(abs, Buffer.concat(chunks)); resolve(); } catch (e) { reject(e); } });
			res.on('error', reject);
		}).on('error', reject);
	});
}

async function getAllPublished() {
	const results = [];
	let cursor;
	do {
		const res = await notion.databases.query({
			database_id: DB_ID,
			page_size: 100,
			start_cursor: cursor,
			filter: { property: 'Published', checkbox: { equals: true } },
		});
		results.push(...res.results);
		cursor = res.has_more ? res.next_cursor : undefined;
	} while (cursor);
	return results;
}

async function syncPage(page) {
	const p = page.properties;
	const title = getPlain(p.Title);
	const subtitle = getPlain(p.Subtitle);
	const customSlug = getPlain(p.Slug);
	const tags = getPlain(p.Tags) || [];
	const pubDate = getPlain(p.PubDate);

	if (!title) { console.warn(`  ⚠ skipping ${page.id} — no title`); return false; }
	if (!pubDate) { console.warn(`  ⚠ skipping ${page.id} — no PubDate`); return false; }

	const slug = customSlug || `${slugify(title)}-${shortHash(page.id, 6)}`;
	const imageTasks = [];

	const n2m = new NotionToMarkdown({ notionClient: notion });
	n2m.setCustomTransformer('image', async (block) => {
		const img = block.image;
		const url = img.type === 'file' ? img.file.url : img.external.url;
		const caption = img.caption?.map((t) => t.plain_text).join('') || '';
		const ext = (url.split('?')[0].match(/\.([a-z0-9]{3,4})$/i)?.[1] || 'jpg').toLowerCase();
		const filename = `${shortHash(block.id)}.${ext}`;
		const rel = `/pioblog/img/notion/${slug}/${filename}`;
		const abs = path.join(IMAGES_DIR, slug, filename);
		imageTasks.push({ url, abs });
		return `![${caption}](${rel})\n\n`;
	});

	const mdblocks = await n2m.pageToMarkdown(page.id);
	const mdStr = n2m.toMarkdownString(mdblocks).parent || '';

	const fm = buildFrontmatter({
		title,
		subtitle,
		pubDate,
		tags,
		heroImage: imageTasks[0] ? `/pioblog/img/notion/${slug}/${shortHash(imageTasks[0].url, 8)}.jpg` : undefined,
	});

	const dst = path.join(POSTS_DIR, `${slug}.md`);
	await writeFile(dst, `${fm}\n\n${mdStr}\n`);

	for (const t of imageTasks) {
		try { await downloadImage(t.url, t.abs); } catch (e) { console.warn(`    ⚠ image fail: ${e.message}`); }
	}
	console.log(`  ✓ ${slug}.md (${imageTasks.length} imgs)`);
	return true;
}

async function main() {
	console.log(`🚀 Notion sync ${DRY_RUN ? '[DRY]' : '[LIVE]'}`);
	if (DRY_RUN) {
		console.log('(dry run — would query database and write files)');
		return;
	}
	const pages = await getAllPublished();
	console.log(`  ${pages.length} published pages`);
	let ok = 0, fail = 0;
	for (const page of pages) {
		try { if (await syncPage(page)) ok++; }
		catch (e) { console.error(`  ✗ ${page.id}: ${e.message}`); fail++; }
	}
	console.log(`\n📊 ${ok}/${pages.length} OK, ${fail} failed`);
	if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
