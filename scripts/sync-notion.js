/*
 * Notion wiki → Astro pages sync.
 *
 * Reads `scripts/notion-pages.json` — список страниц Notion с target-файлами.
 * Каждая страница тянется через Notion API, конвертируется в markdown,
 * картинки (подписанные S3 URL с TTL 1ч) скачиваются в public/img/notion/<slug>/,
 * sub-pages (вложенные child_pages) становятся отдельными файлами в src/content/pages/cases/.
 *
 * Итог:
 *   /pioblog/wiki/          — корневая wiki
 *   /pioblog/wiki/about/    — «Чем могу быть полезен»
 *   /pioblog/wiki/portfolio/ — портфолио с ссылками на cases
 *   /pioblog/wiki/mentoring/
 *   /pioblog/wiki/cases/<slug>/ — вложенные старые кейсы
 *
 * Все картинки и текст отдаются с GitHub Pages → читается из России без VPN.
 *
 * Env:
 *   NOTION_TOKEN — Internal Integration Secret
 *   DRY_RUN=1    — не делает реальных запросов, пишет fixture
 */

import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(await fs.readFile(path.join(__dirname, 'notion-pages.json'), 'utf8'));

const DRY_RUN = !!process.env.DRY_RUN;
const TOKEN = process.env.NOTION_TOKEN;
if (!DRY_RUN && !TOKEN) { console.error('NOTION_TOKEN required'); process.exit(1); }

const notion = DRY_RUN ? null : new Client({ auth: TOKEN, notionVersion: '2026-03-11' });

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_HOSTS = [/\.amazonaws\.com$/i, /\.notion\.so$/i, /\.notion-static\.com$/i];

function slugify(text) {
	return (text || '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60) || 'page';
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
		lines.push(`${k}: '${escapeYaml(String(v))}'`);
	}
	lines.push('---');
	return lines.join('\n');
}
async function writeFile(abs, content) {
	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, content, 'utf8');
}

async function downloadImage(url, abs) {
	try {
		const st = await fs.stat(abs);
		if (st.size > 0) return;
	} catch {}
	const u = new URL(url);
	if (u.protocol !== 'https:') throw new Error('https only');
	const hostOk = IMAGE_HOSTS.some((rx) => rx.test(u.hostname));
	if (!hostOk) throw new Error(`host not allowlisted: ${u.hostname}`);
	await fs.mkdir(path.dirname(abs), { recursive: true });
	const tmp = `${abs}.tmp-${process.pid}`;
	return new Promise((resolve, reject) => {
		const req = https.get(url, { timeout: 30000 }, (res) => {
			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				return downloadImage(res.headers.location, abs).then(resolve, reject);
			}
			if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
			const chunks = [];
			let bytes = 0;
			res.on('data', (c) => {
				bytes += c.length;
				if (bytes > MAX_IMAGE_BYTES) { res.destroy(); return reject(new Error('too big')); }
				chunks.push(c);
			});
			res.on('end', async () => {
				try {
					await fs.writeFile(tmp, Buffer.concat(chunks));
					await fs.rename(tmp, abs);
					resolve();
				} catch (e) { reject(e); }
			});
			res.on('error', reject);
		});
		req.on('timeout', () => req.destroy(new Error('timeout')));
		req.on('error', reject);
	});
}

async function fetchAllChildren(blockId) {
	const all = [];
	let cursor;
	do {
		const res = await notion.blocks.children.list({ block_id: blockId, page_size: 100, start_cursor: cursor });
		all.push(...res.results);
		cursor = res.has_more ? res.next_cursor : undefined;
	} while (cursor);
	return all;
}

function getExt(url) {
	const clean = url.split('?')[0];
	return (clean.match(/\.([a-z0-9]{3,4})$/i)?.[1] || 'png').toLowerCase();
}

function createN2M(pageSlug, imageTasks, subPageIdByTitle) {
	const n2m = new NotionToMarkdown({
		notionClient: notion,
		config: { parseChildPages: true, separateChildPage: true },
	});

	// Wrap rich_text run in markdown markers, but move whitespace OUTSIDE the
	// markers — `**text **` is invalid markdown (trailing space breaks bold).
	const wrap = (s, open, close = open) => {
		if (!s) return s;
		const leading = s.match(/^\s*/)[0];
		const trailing = s.match(/\s*$/)[0];
		const core = s.slice(leading.length, s.length - trailing.length);
		if (!core) return s;
		return `${leading}${open}${core}${close}${trailing}`;
	};
	const richText = (arr) => (arr || []).map((t) => {
		let s = t.plain_text;
		if (t.annotations?.code) s = wrap(s, '`');
		if (t.annotations?.bold) s = wrap(s, '**');
		if (t.annotations?.italic) s = wrap(s, '*');
		if (t.annotations?.strikethrough) s = wrap(s, '~~');
		if (t.href) s = `[${s}](${t.href})`;
		return s;
	}).join('');

	n2m.setCustomTransformer('callout', async (block) => {
		const c = block.callout;
		const color = (c.color || 'gray_bg').replace(/[^a-z_]/g, '');
		let icon = '';
		if (c.icon?.type === 'emoji') icon = c.icon.emoji;
		const text = richText(c.rich_text);
		return `<div class="callout ${color}">\n\n${icon} ${text}\n\n</div>\n\n`;
	});

	/* Toggle: не трогаем кастом (ломает вложение в списки); пост-процессим. */

	n2m.setCustomTransformer('image', async (block) => {
		const img = block.image;
		const url = img.type === 'file' ? img.file.url : img.external.url;
		const caption = img.caption?.map((t) => t.plain_text).join('') || '';
		const ext = getExt(url);
		const filename = `${shortHash(block.id)}.${ext}`;
		const rel = `/pioblog/img/notion/${pageSlug}/${filename}`;
		const abs = path.join(REPO_ROOT, config.options.imageDir, pageSlug, filename);
		imageTasks.push({ url, abs });
		return `![${caption}](${rel})\n\n`;
	});

	n2m.setCustomTransformer('child_page', async (block) => {
		const title = block.child_page?.title || '';
		if (title) subPageIdByTitle.set(title, block.id);
		return false; // fallback to library default
	});

	return n2m;
}

async function syncPage(pageId, pageConfig) {
	const { target, slug, title, isRoot } = pageConfig;

	if (DRY_RUN) {
		console.log(`[DRY] ${title} → ${target}`);
		const fm = buildFrontmatter({ title, notion_id: pageId, notion_last_edited: '2026-04-24T00:00:00.000Z' });
		await writeFile(path.join(REPO_ROOT, target), `${fm}\n\n## ${title} (DRY_RUN fixture)\n\nЗаглушка для dry run.\n`);
		return { imageCount: 0, subPageCount: 0 };
	}

	const imageTasks = [];
	const subPageIdByTitle = new Map();
	const n2m = createN2M(slug, imageTasks, subPageIdByTitle);

	const pageMeta = await notion.pages.retrieve({ page_id: pageId });
	const mdblocks = await n2m.pageToMarkdown(pageId);
	const mdObject = n2m.toMarkdownString(mdblocks);

	let parentContent = mdObject.parent || '';

	// Post-process 1: внутри <details>...</details> убрать `> ` префикс
	// (notion-to-md по умолчанию превращает дочерние блоки toggle в blockquote)
	// и поставить пустую строку между контентными строками — чтобы markdown
	// в Astro распознавал их как отдельные параграфы.
	parentContent = parentContent.replace(/<details>([\s\S]*?)<\/details>/g, (m, inner) => {
		const stripped = inner
			.split('\n')
			.map((l) => l.replace(/^>\s?/, ''))
			.join('\n')
			.replace(/  +$/gm, '')        // убрать trailing `  ` (markdown <br>)
			.replace(/\n(?!\n)/g, '\n\n') // force blank line between stripped lines
			.replace(/\n{3,}/g, '\n\n');
		// гарантируем пустую строку между summary и первым параграфом
		const fixed = stripped.replace(/(<\/summary>)\n(?!\n)/, '$1\n\n');
		return `<details>${fixed}</details>`;
	});

	// Post-process 2: внутренние ссылки на Notion-страницы (из rich_text `href`)
	// приходят вида `/{32-char-uuid}` — перепишем в наши локальные URL по конфигу.
	const pageUrlById = new Map();
	for (const [id, pc] of Object.entries(config.pages)) {
		pageUrlById.set(id.replace(/-/g, ''), pc.isRoot ? '/pioblog/wiki/' : `/pioblog/wiki/${pc.slug}/`);
	}
	parentContent = parentContent.replace(/\]\(\/([0-9a-f]{32})(\?[^)]*)?\)/g, (m, id) => {
		const url = pageUrlById.get(id);
		return url ? `](${url})` : m;
	});
	const subPages = [];
	for (const [subTitle, md] of Object.entries(mdObject)) {
		if (subTitle === 'parent' || !subTitle) continue;
		const subId = subPageIdByTitle.get(subTitle);
		const subSlug = subId ? `${slugify(subTitle)}-${shortHash(subId, 6)}` : `${slugify(subTitle)}-${shortHash(subTitle, 6)}`;
		subPages.push({ title: subTitle, slug: subSlug, content: md });

		const escaped = subTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		parentContent = parentContent.replace(
			new RegExp(`^## ${escaped}$`, 'm'),
			`- [${subTitle}](${config.options.subPagesUrlPrefix}${subSlug}/)`,
		);
	}

	const frontMatter = buildFrontmatter({
		title,
		notion_id: pageId,
		notion_last_edited: pageMeta.last_edited_time,
		isRoot: isRoot ? 'true' : undefined,
	});

	await writeFile(path.join(REPO_ROOT, target), `${frontMatter}\n\n${parentContent}\n`);

	for (const sp of subPages) {
		const subFm = buildFrontmatter({
			title: sp.title,
			parent_notion_id: pageId,
		});
		const subAbs = path.join(REPO_ROOT, config.options.subPagesDir, `${sp.slug}.md`);
		await writeFile(subAbs, `${subFm}\n\n${sp.content}\n`);
	}

	// Images — bounded concurrency
	let failed = 0;
	const limit = 4;
	const chunks = [];
	for (let i = 0; i < imageTasks.length; i += limit) chunks.push(imageTasks.slice(i, i + limit));
	for (const chunk of chunks) {
		const results = await Promise.allSettled(chunk.map((t) => downloadImage(t.url, t.abs)));
		for (const r of results) if (r.status === 'rejected') { failed++; console.warn('  ⚠ image fail:', r.reason.message); }
	}

	return { imageCount: imageTasks.length - failed, subPageCount: subPages.length };
}

async function main() {
	console.log(`🚀 Notion pages sync ${DRY_RUN ? '[DRY]' : '[LIVE]'}`);
	let totalImages = 0;
	let totalSubPages = 0;
	let failed = 0;
	const pageCount = Object.keys(config.pages).length;
	for (const [pageId, pageConfig] of Object.entries(config.pages)) {
		try {
			console.log(`→ ${pageConfig.title}`);
			const { imageCount, subPageCount } = await syncPage(pageId, pageConfig);
			totalImages += imageCount;
			totalSubPages += subPageCount;
			console.log(`  ✓ ${pageConfig.target} (${imageCount} imgs, ${subPageCount} sub-pages)`);
		} catch (e) {
			console.error(`  ✗ ${pageConfig.title}: ${e.message}`);
			failed++;
		}
	}
	console.log(`\n📊 ${pageCount - failed}/${pageCount} pages OK, ${totalImages} imgs, ${totalSubPages} sub-pages`);
	if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
