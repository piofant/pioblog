/**
 * gen-stats-charts.mjs — генерирует SVG-графики для /stats страницы.
 *
 * Запускается еженедельно в GH Action (.github/workflows/gen-stats-charts.yml)
 * или локально:
 *   node scripts/gen-stats-charts.mjs
 *
 * Читает src/data/metrics.json + посты из src/content/blog/*.md (тэги/даты),
 * генерит 4 SVG в public/img/stats/:
 *   - reactions-pie.svg     — pie реакций (топ-эмодзи)
 *   - err-by-tag.svg         — bar: средний ERR по тегам
 *   - posts-per-month.svg    — line: число постов в месяц
 *   - top-views.svg          — bar: top-10 постов по просмотрам
 *
 * Использует @observablehq/plot + jsdom (server-side рендер SVG).
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Plot from '@observablehq/plot';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BLOG_DIR = join(ROOT, 'src/content/blog');
const METRICS_PATH = join(ROOT, 'src/data/metrics.json');
const OUT_DIR = join(ROOT, 'public/img/stats');

// Палитра — из tag-categories
const COLORS = {
	product: '#2563eb',
	creative: '#db2777',
	trips: '#ea580c',
	life: '#7c3aed',
	muted: '#9ba1a3',
	text: '#0e0f10',
	border: '#e6e7e9',
};

const TAG_CATEGORY = (() => {
	const m = new Map();
	[
		['продакт', 'product'], ['карьера', 'product'], ['менторство', 'product'],
		['ии', 'product'], ['боты', 'product'],
		['трипы', 'trips'], ['автостоп', 'trips'], ['летняя школа', 'trips'],
		['мужские круги', 'trips'], ['безумие', 'trips'], ['випассана', 'trips'], ['медитация', 'trips'],
		['творчество', 'creative'], ['театр', 'creative'], ['танцы', 'creative'],
		['контактная импровизация', 'creative'], ['клоунада', 'creative'],
		['рефлексия', 'life'], ['психология', 'life'], ['нетворкинг', 'life'], ['вуз', 'life'],
		['жизнь в настоящем', 'life'], ['истории', 'life'],
	].forEach(([t, c]) => m.set(t, c));
	return m;
})();
const META_TAGS = new Set(['whois', 'telegram', 'анонс', 'жизнь', 'школа жизни', 'истории', 'рекомендации']);

/* JSDOM-based document — Plot нужен document для создания SVG. */
function createDom() {
	const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
	return dom.window.document;
}

function svgString(svgEl) {
	const serializer = new svgEl.ownerDocument.defaultView.XMLSerializer();
	return '<?xml version="1.0" encoding="UTF-8"?>\n' + serializer.serializeToString(svgEl);
}

async function loadPostsMeta() {
	const files = (await readdir(BLOG_DIR)).filter((f) => f.endsWith('.md'));
	const posts = [];
	for (const f of files) {
		const raw = await readFile(join(BLOG_DIR, f), 'utf8');
		const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
		if (!fmMatch) continue;
		const fm = fmMatch[1];
		const tg = fm.match(/^tgMessageId:\s*(\d+)\s*$/m)?.[1];
		const date = fm.match(/^pubDate:\s*['"]?(\d{4}-\d{2}-\d{2})/m)?.[1];
		const title = fm.match(/^title:\s*['"]?(.+?)['"]?\s*$/m)?.[1];
		// Tags inline или block
		let tags = [];
		const inline = fm.match(/^tags:\s*\[(.+)\]\s*$/m);
		if (inline) {
			tags = inline[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
		} else {
			const block = fm.match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
			if (block) tags = block[1].split('\n').map((l) => l.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '')).filter(Boolean);
		}
		posts.push({ slug: basename(f, '.md'), tg: tg ? Number(tg) : null, date, title, tags });
	}
	return posts;
}

// =============================================================
// Charts
// =============================================================

function chartReactionsPie(metrics, doc) {
	const counts = new Map();
	for (const id of Object.keys(metrics)) {
		for (const r of metrics[id].reactions || []) {
			counts.set(r.emoji, (counts.get(r.emoji) || 0) + r.count);
		}
	}
	const data = [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 8)
		.map(([emoji, count]) => ({ emoji, count }));
	if (data.length === 0) return null;

	// Plot не имеет нативный pie, рисуем horizontal bar с emoji-метками
	return Plot.plot({
		document: doc,
		width: 760,
		height: 280,
		marginLeft: 40,
		marginRight: 60,
		x: { label: 'количество реакций', tickFormat: 'd' },
		y: { label: null },
		marks: [
			Plot.barX(data, {
				x: 'count',
				y: 'emoji',
				fill: COLORS.creative,
				sort: { y: 'x', reverse: true },
			}),
			Plot.text(data, {
				x: 'count',
				y: 'emoji',
				text: (d) => d.count.toLocaleString('ru'),
				dx: 8,
				textAnchor: 'start',
				fill: COLORS.text,
			}),
		],
	});
}

function chartErrByTag(metrics, posts, doc) {
	// За тег: средний ERR по постам с тегом (только посты с ≥100 views)
	const byTag = new Map();
	for (const p of posts) {
		if (!p.tg) continue;
		const m = metrics[String(p.tg)];
		if (!m || m.err == null || m.views < 100) continue;
		for (const t of p.tags) {
			if (META_TAGS.has(t)) continue;
			if (!byTag.has(t)) byTag.set(t, []);
			byTag.get(t).push(m.err);
		}
	}
	const data = [...byTag.entries()]
		.map(([tag, arr]) => ({
			tag,
			err: arr.reduce((s, x) => s + x, 0) / arr.length,
			count: arr.length,
			color: COLORS[TAG_CATEGORY.get(tag) || 'muted'] || COLORS.muted,
		}))
		.filter((d) => d.count >= 3) // минимум 3 поста на тег чтобы попасть
		.sort((a, b) => b.err - a.err)
		.slice(0, 12);
	if (data.length === 0) return null;

	return Plot.plot({
		document: doc,
		width: 760,
		height: Math.max(200, data.length * 28 + 50),
		marginLeft: 140,
		marginRight: 60,
		x: { label: 'средний ERR, %', grid: true },
		y: { label: null },
		marks: [
			Plot.barX(data, {
				x: 'err',
				y: 'tag',
				fill: 'color',
				sort: { y: 'x', reverse: true },
			}),
			Plot.text(data, {
				x: 'err',
				y: 'tag',
				text: (d) => `${d.err.toFixed(1)}% (${d.count})`,
				dx: 6,
				textAnchor: 'start',
				fill: COLORS.text,
				fontSize: 11,
			}),
		],
	});
}

function chartPostsPerMonth(posts, doc) {
	const counts = new Map();
	for (const p of posts) {
		if (!p.date) continue;
		const month = p.date.slice(0, 7); // YYYY-MM
		counts.set(month, (counts.get(month) || 0) + 1);
	}
	const data = [...counts.entries()].sort().map(([month, count]) => ({
		month: new Date(month + '-01'),
		count,
	}));
	if (data.length === 0) return null;

	return Plot.plot({
		document: doc,
		width: 760,
		height: 240,
		marginBottom: 35,
		x: { label: null, type: 'time', tickFormat: '%b\n%Y' },
		y: { label: 'постов в месяц', grid: true },
		marks: [
			Plot.areaY(data, {
				x: 'month',
				y: 'count',
				fill: COLORS.product,
				fillOpacity: 0.18,
			}),
			Plot.lineY(data, {
				x: 'month',
				y: 'count',
				stroke: COLORS.product,
				strokeWidth: 2,
			}),
			Plot.dot(data, {
				x: 'month',
				y: 'count',
				fill: COLORS.product,
				r: 2.5,
			}),
		],
	});
}

function chartTopViews(metrics, posts, doc) {
	const lookup = new Map();
	for (const p of posts) if (p.tg) lookup.set(p.tg, p);
	const data = Object.entries(metrics)
		.map(([id, m]) => {
			const p = lookup.get(Number(id));
			if (!p) return null;
			return {
				title: p.title.length > 60 ? p.title.slice(0, 57) + '…' : p.title,
				views: m.views,
			};
		})
		.filter(Boolean)
		.sort((a, b) => b.views - a.views)
		.slice(0, 10);
	if (data.length === 0) return null;

	return Plot.plot({
		document: doc,
		width: 760,
		height: 360,
		marginLeft: 280,
		marginRight: 60,
		x: { label: 'просмотры', grid: true, tickFormat: 's' },
		y: { label: null },
		marks: [
			Plot.barX(data, {
				x: 'views',
				y: 'title',
				fill: COLORS.product,
				sort: { y: 'x', reverse: true },
			}),
			Plot.text(data, {
				x: 'views',
				y: 'title',
				text: (d) =>
					d.views >= 1000 ? `${(d.views / 1000).toFixed(1)}K` : String(d.views),
				dx: 6,
				textAnchor: 'start',
				fill: COLORS.text,
				fontSize: 11,
			}),
		],
	});
}

// =============================================================

async function main() {
	if (!existsSync(METRICS_PATH)) {
		console.error('💥 metrics.json не найден — запусти sync-tg-metrics сначала');
		process.exit(1);
	}
	const metrics = JSON.parse(await readFile(METRICS_PATH, 'utf8'));
	const posts = await loadPostsMeta();
	console.log(`📋 Posts: ${posts.length} · Metrics entries: ${Object.keys(metrics).length}`);

	await mkdir(OUT_DIR, { recursive: true });
	const doc = createDom();

	const charts = {
		'reactions-pie.svg': chartReactionsPie(metrics, doc),
		'err-by-tag.svg': chartErrByTag(metrics, posts, doc),
		'posts-per-month.svg': chartPostsPerMonth(posts, doc),
		'top-views.svg': chartTopViews(metrics, posts, doc),
	};

	for (const [name, svgEl] of Object.entries(charts)) {
		if (!svgEl) {
			console.log(`  · ${name} — нет данных, пропуск`);
			continue;
		}
		const out = join(OUT_DIR, name);
		await writeFile(out, svgString(svgEl), 'utf8');
		console.log(`  ✓ ${name}`);
	}
}

main().catch((err) => {
	console.error('💥 Fatal:', err);
	process.exit(1);
});
