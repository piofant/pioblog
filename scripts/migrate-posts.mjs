// Мигрирует посты из vedulix-blog/_posts/*.md в pioblog/src/content/blog/
// Frontmatter:
//   layout: post      → удаляем
//   title             → title
//   subtitle          → subtitle
//   tags: [...]       → tags
//   thumbnail-img / cover-img / thumb-img → heroImage
//   Дата из имени файла YYYY-MM-DD-slug.md → pubDate

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fixBody } from './lib/markdown.mjs';

const SRC = '/Users/piofant/cursor/vedulix-blog/_posts';
const DST = '/Users/piofant/cursor/src/content/blog';

function parseFrontmatter(raw) {
	const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return { fm: {}, body: raw };
	const fmText = match[1];
	const body = match[2];
	const fm = {};
	const lines = fmText.split('\n');
	for (const line of lines) {
		const m = line.match(/^([^:]+):\s*(.*)$/);
		if (!m) continue;
		const key = m[1].trim();
		let val = m[2].trim();
		if (val.startsWith('[') && val.endsWith(']')) {
			val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
		} else {
			val = val.replace(/^['"]|['"]$/g, '');
		}
		fm[key] = val;
	}
	return { fm, body };
}

function toYaml(obj) {
	const lines = ['---'];
	for (const [k, v] of Object.entries(obj)) {
		if (v === undefined || v === null) continue;
		if (Array.isArray(v)) {
			lines.push(`${k}: [${v.map(x => `'${String(x).replace(/'/g, "''")}'`).join(', ')}]`);
		} else if (v instanceof Date) {
			lines.push(`${k}: ${v.toISOString().slice(0, 10)}`);
		} else {
			// single-quoted YAML: backslashes are literal, only '' escapes apostrophe
			const escaped = String(v).replace(/'/g, "''");
			lines.push(`${k}: '${escaped}'`);
		}
	}
	lines.push('---');
	return lines.join('\n');
}

function rewriteAssetPaths(body) {
	// vedulix-blog emits /blog/assets/{img,video,audio,files}/... because Jekyll
	// is served at piofant.github.io/blog/. Pioblog is served at
	// piofant.github.io/ with its own public/ layout. Map accordingly.
	return body
		.replace(/\/blog\/assets\/img\//g, '/img/')
		.replace(/\/blog\/assets\/video\//g, '/video/')
		.replace(/\/blog\/assets\/audio\//g, '/audio/')
		.replace(/\/blog\/assets\/files\//g, '/files/')
		// keep legacy paths working for the hand-authored 15 posts
		.replace(/\/assets\/img\//g, '/img/');
}

function fixContent(body) {
	let out = body
		// 1) TG «bold-heading» склеенное со следующим абзацем
		.replace(/(\*\*[^*\n]+\*\*)([A-Za-zА-Яа-я0-9–—-])/g, '$1\n\n$2')
		// 2) sticker-ссылки: [🔵](stickers/…) / [😊](video_files/sticker.webm) → оставляем только эмодзи
		.replace(/\[([^\]]*)\]\(stickers\/[^\n]*?\.(webp|png|jpg|gif|tgs|lottie)\)/g, '$1')
		.replace(/\[([^\]]*)\]\(video_files\/sticker\.\w+\)/g, '$1')
		// 3) Jekyll-ссылки /blog/<slug>-YYYY-MM-DD/ → /blog/<slug>/
		.replace(/\]\(\/blog\/([a-z0-9-]+)-\d{4}-\d{2}-\d{2}\/?\)/g, '](/blog/$1/)')
		// 4) «разорванный» жирный: `**foo**\n\n**bar**` → `**foo bar**`
		.replace(/\*\*([^*\n]+?)\*\*\s*\n\s*\n\s*\*\*([^*\n]+?)\*\*/g, '**$1 $2**')
		// 5) пустой bold-блок на своей строке
		.replace(/^\s*\*\*\s*\*\*\s*$/gm, '')
		// 6) бэкслеш-разделитель между кириллицей: `одиночество\неопределенность` → `… / …`
		.replace(/([а-яёa-z0-9])\\([а-яёa-z])/gi, '$1 / $2')
		// 7) autolinks без схемы: `<domain.tld/path>` → `<https://domain.tld/path>`
		.replace(/<(?!https?:\/\/|mailto:|#)([a-z0-9][a-z0-9._-]*\.[a-z]{2,}(?:\/[^>\s]*)?)>/gi, '<https://$1>')
		// 8) лишние пустые строки после blockquote
		.replace(/^(>.*)\n\s*\n\s*\n/gm, '$1\n\n')
		// 9) несколько подряд пустых строк → максимум две
		.replace(/\n{4,}/g, '\n\n\n');
	// 10) Общий paragraphize + splitMultilineEmphasis (тот же lib что и в TG-синке).
	//     Превращает single `\n` → `\n\n` вне code fences. Без этого
	//     `[**label**]\nbody` рендерилось как один абзац (см. fix #1 — раньше ловил
	//     только `**bold**SOMETHING`, но не bracketed labels).
	return fixBody(out);
}

function rewriteHero(url) {
	if (!url) return undefined;
	if (url.startsWith('http')) return url;
	return url
		.replace(/^\/blog\/assets\/img\//, '/img/')
		.replace(/^\/assets\/img\//, '/img/');
}

async function main() {
	await mkdir(DST, { recursive: true });
	const files = (await readdir(SRC)).filter(f => /^\d{4}-\d{2}-\d{2}-.*\.md$/.test(f));
	let count = 0;
	for (const file of files) {
		const raw = await readFile(join(SRC, file), 'utf8');
		const { fm, body } = parseFrontmatter(raw);
		const m = file.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/);
		if (!m) continue;
		const [, y, mo, d, slug] = m;
		const pubDate = `${y}-${mo}-${d}`;

		const heroImage = rewriteHero(fm['thumbnail-img'] || fm['cover-img'] || fm['thumb-img']);

		const newFm = {
			title: fm.title,
			subtitle: fm.subtitle,
			pubDate,
			tags: fm.tags,
			heroImage,
		};
		// убираем undefined
		Object.keys(newFm).forEach(k => newFm[k] === undefined && delete newFm[k]);

		const newBody = fixContent(rewriteAssetPaths(body)).trimStart();
		const out = toYaml(newFm) + '\n\n' + newBody;
		const dstFile = join(DST, `${slug}.md`);
		await writeFile(dstFile, out, 'utf8');
		console.log(`✓ ${file} → ${slug}.md`);
		count++;
	}
	console.log(`\nMigrated ${count} posts.`);
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
