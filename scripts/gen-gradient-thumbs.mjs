/**
 * Генерирует уникальный мягкий градиент-thumbnail для постов без heroImage.
 *
 * - Базовый цвет = primary tag категория (продуктовое/трипы/творчество/жизнь)
 * - Угол + позиция радиального света = hash от slug (детерминированный)
 * - Размер 1200×630 (стандарт OG)
 * - Сохраняется в public/img/og/gradients/<slug>.png
 *
 * Запуск: node scripts/gen-gradient-thumbs.mjs       # настоящий прогон
 *         node scripts/gen-gradient-thumbs.mjs --dry # только показать что будет
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const ROOT = '/Users/piofant/cursor/pioblog';
const BLOG_DIR = join(ROOT, 'src/content/blog');
const OUT_DIR = join(ROOT, 'public/img/og/gradients');
const DRY = process.argv.includes('--dry');

const W = 1200;
const H = 630;

// Дублируем TAG_CATEGORIES — простая мапа tag → color чтобы не тянуть TS
const TAG_TO_COLOR = (() => {
	const cats = [
		{ color: '#2563eb', tags: ['продакт', 'карьера', 'менторство', 'ии', 'боты'] },
		{ color: '#ea580c', tags: ['трипы', 'автостоп', 'летняя школа', 'мужские круги', 'безумие', 'випассана', 'медитация'] },
		{ color: '#db2777', tags: ['творчество', 'театр', 'танцы', 'контактная импровизация', 'клоунада'] },
		{ color: '#7c3aed', tags: ['рефлексия', 'психология', 'истории', 'школа жизни', 'нетворкинг', 'вуз', 'жизнь', 'жизнь в настоящем', 'whois', 'анонс', 'рекомендации'] },
	];
	const m = new Map();
	for (const { color, tags } of cats) for (const t of tags) m.set(t, color);
	return m;
})();
const META_TAGS = new Set(['whois', 'telegram', 'анонс', 'жизнь', 'школа жизни', 'истории', 'рекомендации']);
const FALLBACK_COLOR = '#64748b'; // нейтральный серо-голубой если тег не нашёлся

function primaryColorFor(tags) {
	if (!tags || tags.length === 0) return FALLBACK_COLOR;
	// Сначала пробуем не-мета теги
	for (const t of tags) {
		if (!META_TAGS.has(t) && TAG_TO_COLOR.has(t)) return TAG_TO_COLOR.get(t);
	}
	// Потом любые
	for (const t of tags) {
		if (TAG_TO_COLOR.has(t)) return TAG_TO_COLOR.get(t);
	}
	return FALLBACK_COLOR;
}

function hashSlug(slug) {
	const h = createHash('sha1').update(slug).digest();
	// возвращаем 32-bit число
	return h.readUInt32BE(0);
}

/** Парсим простой YAML frontmatter для tags + heroImage check */
function parseFrontmatter(raw) {
	const m = raw.match(/^---\n([\s\S]*?)\n---/);
	if (!m) return null;
	const fm = m[1];
	const hasHero = /^heroImage:/m.test(fm);
	let tags = [];
	const inlineTags = fm.match(/^tags:\s*\[(.+)\]\s*$/m);
	if (inlineTags) {
		tags = inlineTags[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
	} else {
		const blockTags = fm.match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
		if (blockTags) {
			tags = blockTags[1].split('\n').map((l) => l.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '')).filter(Boolean);
		}
	}
	return { hasHero, tags };
}

function injectHeroImage(raw, thumbUrl) {
	const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) return null;
	const fm = fmMatch[1];
	if (/^heroImage:/m.test(fm)) return null;
	const lines = fm.split('\n');
	const newLine = `heroImage: '${thumbUrl}'`;
	const out = [];
	let inserted = false;
	for (const line of lines) {
		out.push(line);
		if (!inserted && /^pubDate:/.test(line)) {
			out.push(newLine);
			inserted = true;
		}
	}
	if (!inserted) out.unshift(newLine);
	return raw.replace(/^---\n[\s\S]*?\n---/, `---\n${out.join('\n')}\n---`);
}

/**
 * SVG градиент: linear-gradient (от base-цвета 35% → 10%) + radial overlay
 * (белый свет в одной из 4 областей, радиус ~70% от меньшей стороны).
 * Угол и позиция света берутся из hash, поэтому каждый slug → уникальный.
 */
function buildSvg(baseColor, hash) {
	const angle = hash % 360;
	// 8 предустановленных позиций для радиального света — равномерно по канвасу
	const positions = [
		{ cx: 20, cy: 20 }, { cx: 75, cy: 15 }, { cx: 50, cy: 30 }, { cx: 85, cy: 50 },
		{ cx: 15, cy: 60 }, { cx: 60, cy: 75 }, { cx: 30, cy: 85 }, { cx: 80, cy: 80 },
	];
	const pos = positions[(hash >>>8) % positions.length];
	// Лёгкая вариация в радиусе света
	const radius = 50 + ((hash >>>16) % 30); // 50..80%

	// XML-escape не нужен — мы не используем пользовательский ввод
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="base" gradientTransform="rotate(${angle} 0.5 0.5)">
      <stop offset="0%"   stop-color="${baseColor}" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="${baseColor}" stop-opacity="0.08"/>
    </linearGradient>
    <radialGradient id="light" cx="${pos.cx}%" cy="${pos.cy}%" r="${radius}%">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="60%"  stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#fafafa"/>
  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect width="${W}" height="${H}" fill="url(#light)"/>
</svg>`;
}

async function main() {
	if (!existsSync(OUT_DIR) && !DRY) await mkdir(OUT_DIR, { recursive: true });

	const files = (await readdir(BLOG_DIR)).filter((f) => f.endsWith('.md'));
	let created = 0;
	let updated = 0;
	let skipped = 0;
	let alreadyHave = 0;

	for (const f of files) {
		const fullPath = join(BLOG_DIR, f);
		const raw = await readFile(fullPath, 'utf8');
		const fm = parseFrontmatter(raw);
		if (!fm) { skipped++; continue; }
		if (fm.hasHero) { alreadyHave++; continue; }

		const slug = basename(f, '.md');
		const color = primaryColorFor(fm.tags);
		const hash = hashSlug(slug);
		const outFile = join(OUT_DIR, `${slug}.png`);
		const thumbUrl = `/img/og/gradients/${slug}.png`;

		if (DRY) {
			console.log(`[would-create] ${slug}  base=${color}  angle=${hash % 360}°`);
			created++;
			continue;
		}

		// Генерация PNG из SVG через sharp
		if (!existsSync(outFile)) {
			const svg = buildSvg(color, hash);
			await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outFile);
			created++;
		} else {
			alreadyHave++;
		}

		const updatedRaw = injectHeroImage(raw, thumbUrl);
		if (updatedRaw) {
			await writeFile(fullPath, updatedRaw, 'utf8');
			updated++;
		}
	}

	console.log(`\n${'='.repeat(50)}\nDRY: ${DRY}\nGradients created: ${created}\nFrontmatter updated: ${updated}\nAlready had hero/thumb: ${alreadyHave}\nSkipped: ${skipped}\n${'='.repeat(50)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
