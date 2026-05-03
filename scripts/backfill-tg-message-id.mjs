/**
 * backfill-tg-message-id.mjs
 *
 * Одноразовый: проставляет `tgMessageId: NNN` в frontmatter постов, у которых
 * slug заканчивается на `-NNN`, а в frontmatter ещё не указан tgMessageId.
 *
 * Это нужно для sync-tg-metrics.mjs (он берёт tg id ТОЛЬКО из frontmatter,
 * чтобы не путать с миграционными файлами из чужих каналов).
 *
 * Запуск: node scripts/backfill-tg-message-id.mjs
 *         node scripts/backfill-tg-message-id.mjs --dry
 *
 * Если у поста slug-суффикс — НЕ TG id (миграция из другого канала),
 * скрипт всё равно добавит. Перед запуском убедись что среди файлов
 * нет таких — либо вручную убери у них суффикс перед прогоном,
 * либо потом откати tgMessageId у битых.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = join(__dirname, '..', 'src/content/blog');
const DRY = process.argv.includes('--dry');

const files = (await readdir(BLOG_DIR)).filter((f) => f.endsWith('.md'));
let added = 0;
let alreadyHave = 0;
let noSuffix = 0;

for (const f of files) {
	const slug = basename(f, '.md');
	const m = slug.match(/-(\d+)$/);
	if (!m) {
		noSuffix++;
		continue;
	}
	const id = Number(m[1]);

	const path = join(BLOG_DIR, f);
	const raw = await readFile(path, 'utf8');

	if (/^tgMessageId:\s*\d+\s*$/m.test(raw)) {
		alreadyHave++;
		continue;
	}

	// Вставляем после pubDate
	const updated = raw.replace(
		/^(pubDate:.*)$/m,
		`$1\ntgMessageId: ${id}`,
	);
	if (updated === raw) {
		console.warn(`⚠️  ${slug} — нет pubDate, пропуск`);
		continue;
	}

	if (DRY) {
		console.log(`[would-add] ${slug} → tgMessageId: ${id}`);
	} else {
		await writeFile(path, updated, 'utf8');
		console.log(`✓ ${slug} → tgMessageId: ${id}`);
	}
	added++;
}

console.log(`\nDRY: ${DRY}`);
console.log(`Added: ${added} · Already had: ${alreadyHave} · Slug без суффикса: ${noSuffix}`);
