/**
 * Генерирует thumbnail-кадр для постов где есть <video>, но нет heroImage.
 *
 * Алгоритм:
 *   1. Сканирует src/content/blog/*.md
 *   2. Для каждого поста с <video> и без heroImage:
 *      a. Находит первый <source src="..." type="video/mp4">
 *      b. Через ffmpeg извлекает кадр на 0.5 сек (пропускаем чёрные кадры в начале)
 *      c. Сохраняет JPG в public/img/posts/<dir>/<basename>_thumb.jpg
 *      d. Прописывает heroImage в frontmatter
 *
 * Запуск: node scripts/gen-video-thumbs.mjs
 *         node scripts/gen-video-thumbs.mjs --dry  (без записи)
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = '/Users/piofant/cursor/pioblog';
const BLOG_DIR = join(ROOT, 'src/content/blog');
const PUBLIC_DIR = join(ROOT, 'public');
const DRY = process.argv.includes('--dry');

const SOURCE_RE = /<source\s+src="([^"]+)"\s+type="video\/mp4"/i;
const HERO_RE = /^heroImage:\s*['"]?([^'"\n]+)['"]?\s*$/m;

async function processPost(filePath) {
	const raw = await readFile(filePath, 'utf8');
	if (!raw.includes('<video')) return { status: 'no-video', file: filePath };
	if (HERO_RE.test(raw)) return { status: 'has-hero', file: filePath };

	const m = raw.match(SOURCE_RE);
	if (!m) return { status: 'no-source', file: filePath };

	const videoUrl = m[1]; // e.g. /video/posts/2024-../file.mp4
	const videoPath = join(PUBLIC_DIR, videoUrl);
	if (!existsSync(videoPath)) {
		return { status: 'video-missing', file: filePath, videoPath };
	}

	// Имя thumbnail: тот же basename + _thumb.jpg, кладём в /img/posts/<dir>/
	const dirName = basename(dirname(videoUrl)); // 2024-11-19-chto-delat-...
	const baseName = basename(videoUrl, extname(videoUrl));
	const thumbDir = join(PUBLIC_DIR, 'img', 'posts', dirName);
	const thumbFile = `${baseName}_thumb.jpg`;
	const thumbPath = join(thumbDir, thumbFile);
	const thumbUrl = `/img/posts/${dirName}/${thumbFile}`;

	if (existsSync(thumbPath)) {
		return { status: 'thumb-exists', file: filePath, thumbUrl, willUpdate: true };
	}

	if (DRY) {
		return { status: 'would-process', file: filePath, videoUrl, thumbUrl };
	}

	// Извлекаем кадр через ffmpeg
	await mkdir(thumbDir, { recursive: true });
	try {
		execFileSync(
			'ffmpeg',
			[
				'-ss', '0.5',           // пропустить первые 0.5 сек (часто чёрный кадр)
				'-i', videoPath,
				'-frames:v', '1',
				'-q:v', '2',            // hi quality (2-5 хорошо)
				'-vf', "scale='min(1280,iw)':-2",  // ограничить ширину 1280
				'-y',
				thumbPath,
			],
			{ stdio: 'pipe' },
		);
	} catch (err) {
		return { status: 'ffmpeg-failed', file: filePath, error: err.message };
	}

	if (!existsSync(thumbPath)) {
		return { status: 'thumb-not-created', file: filePath };
	}

	const sz = (await stat(thumbPath)).size;
	return { status: 'created', file: filePath, thumbUrl, sizeKb: Math.round(sz / 1024), willUpdate: true };
}

function injectHeroImage(raw, thumbUrl) {
	// Вставляем heroImage сразу после pubDate (если есть) или после title
	const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) return null;
	const fm = fmMatch[1];
	if (/^heroImage:/m.test(fm)) return null; // уже есть, не трогаем

	const lines = fm.split('\n');
	const newLine = `heroImage: '${thumbUrl}'`;
	let inserted = false;

	const out = [];
	for (const line of lines) {
		out.push(line);
		if (!inserted && /^pubDate:/.test(line)) {
			out.push(newLine);
			inserted = true;
		}
	}
	if (!inserted) {
		// fallback: вставить в начало frontmatter
		out.unshift(newLine);
	}

	const newFm = out.join('\n');
	return raw.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
}

async function main() {
	const files = (await readdir(BLOG_DIR)).filter((f) => f.endsWith('.md'));
	const results = [];

	for (const f of files) {
		const fullPath = join(BLOG_DIR, f);
		const result = await processPost(fullPath);
		results.push(result);

		if (result.status === 'created' || result.status === 'thumb-exists') {
			if (!DRY && result.willUpdate) {
				const raw = await readFile(fullPath, 'utf8');
				const updated = injectHeroImage(raw, result.thumbUrl);
				if (updated) await writeFile(fullPath, updated, 'utf8');
			}
		}
	}

	// Отчёт
	console.log(`\n${'='.repeat(60)}\nDRY RUN: ${DRY}\n${'='.repeat(60)}`);
	for (const r of results) {
		if (['no-video', 'has-hero'].includes(r.status)) continue;
		const slug = basename(r.file, '.md');
		console.log(`[${r.status.padEnd(20)}] ${slug}`);
		if (r.thumbUrl) console.log(`  → ${r.thumbUrl}${r.sizeKb ? ` (${r.sizeKb}KB)` : ''}`);
		if (r.error) console.log(`  ! ${r.error}`);
	}

	const created = results.filter((r) => r.status === 'created').length;
	const exists = results.filter((r) => r.status === 'thumb-exists').length;
	const skipped = results.filter((r) => ['no-source', 'video-missing', 'ffmpeg-failed'].includes(r.status));
	console.log(`\nCreated: ${created} · Already had thumb: ${exists} · Skipped: ${skipped.length}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
