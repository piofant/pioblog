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

const SRC = '/Users/piofant/cursor/vedulix-blog/_posts';
const DST = '/Users/piofant/cursor/pioblog/src/content/blog';

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

function rewriteImagePaths(body) {
	// /assets/img/xxx.jpg → /pioblog/img/xxx.jpg (учитываем `base: /pioblog`)
	return body.replace(/\/assets\/img\//g, '/pioblog/img/');
}

function rewriteHero(url) {
	if (!url) return undefined;
	if (url.startsWith('http')) return url;
	return url.replace(/^\/assets\/img\//, '/pioblog/img/');
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

		const newBody = rewriteImagePaths(body).trimStart();
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
