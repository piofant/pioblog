/**
 * sync-tg-metrics.mjs
 *
 * Тянет метрики (views, forwards, replies, reactions) для всех TG-постов
 * @pioblog через MTProto (gramjs). Извлекает telegram_id из суффикса
 * slug'а (`-(\d+)$`), батчами вызывает channels.getMessages, мерджит в
 * src/data/metrics.json.
 *
 * Запускается:
 *   - Локально:  TG_API_ID=... TG_API_HASH=... TG_SESSION_STRING=... node scripts/sync-tg-metrics.mjs
 *   - В GH Action ежедневно (см. .github/workflows/sync-tg-metrics.yml)
 *
 * ENV:
 *   TG_API_ID / TG_API_HASH / TG_SESSION_STRING — обязательные
 *   TG_CHANNEL — опциональный override (по умолчанию `pioblog`)
 *   DRY_RUN=1 — не писать metrics.json
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BLOG_DIR = join(ROOT, 'src/content/blog');
const METRICS_PATH = join(ROOT, 'src/data/metrics.json');

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const sessionString = process.env.TG_SESSION_STRING;
const channelUsername = process.env.TG_CHANNEL || 'pioblog';
const DRY = process.env.DRY_RUN === '1';

if (!apiId || !apiHash || !sessionString) {
	console.error('💥 Missing TG_API_ID / TG_API_HASH / TG_SESSION_STRING');
	process.exit(1);
}

/** Берём telegram_id из frontmatter (`tgMessageId`) — single source of truth.
   То же поле читает `pages/blog/[...slug].astro` для pill «читать в TG».
   Старая «извлечь из суффикса slug'а» цепляла миграционные файлы из чужих
   каналов (`lsh-logbook-den-1-431` где `431` — не TG id @pioblog). */
function tgIdFromFrontmatter(rawText) {
	const m = rawText.match(/^tgMessageId:\s*(\d+)\s*$/m);
	return m ? Number(m[1]) : null;
}

/** Грузит существующий metrics.json (если есть), возвращает Map. */
async function loadExistingMetrics() {
	if (!existsSync(METRICS_PATH)) return {};
	try {
		const raw = await readFile(METRICS_PATH, 'utf8');
		return JSON.parse(raw);
	} catch (e) {
		console.warn(`⚠️  Не смог распарсить ${METRICS_PATH}, начинаю с пустого`);
		return {};
	}
}

/** Преобразует gramjs Message в нашу запись. */
function messageToMetrics(msg) {
	const reactions = (msg.reactions?.results || [])
		.map((r) => {
			const emoji = r.reaction?.emoticon ?? r.reaction?.documentId?.toString() ?? '?';
			return { emoji, count: r.count };
		})
		.sort((a, b) => b.count - a.count);

	const views = msg.views || 0;
	const forwards = msg.forwards || 0;
	const replies = msg.replies?.replies || 0;
	const reactionsTotal = reactions.reduce((s, r) => s + r.count, 0);
	const engagement = reactionsTotal + forwards + replies;
	const err = views > 0 ? Math.round((engagement / views) * 10000) / 100 : null;

	return {
		views,
		forwards,
		replies,
		reactions,
		err,
		last_updated: new Date().toISOString(),
	};
}

async function main() {
	// 1. Собираем все telegram_id из frontmatter постов
	const files = (await readdir(BLOG_DIR)).filter((f) => f.endsWith('.md'));
	const tgIds = [];
	const slugByTgId = {};
	for (const f of files) {
		const raw = await readFile(join(BLOG_DIR, f), 'utf8');
		const id = tgIdFromFrontmatter(raw);
		if (id) {
			tgIds.push(id);
			slugByTgId[id] = basename(f, '.md');
		}
	}
	console.log(`📋 Найдено ${tgIds.length} постов с tgMessageId (из ${files.length} файлов)`);

	// 2. Подключаемся к TG
	const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
		connectionRetries: 5,
	});
	await client.connect();
	console.log(`🔌 Connected to MTProto, channel = @${channelUsername}`);

	const channel = await client.getEntity(channelUsername);

	// 3. Тянем сообщения батчами по 100 (лимит Telegram)
	const existing = await loadExistingMetrics();
	const updated = { ...existing };
	let fetched = 0;
	let updatedCount = 0;

	const BATCH = 100;
	for (let i = 0; i < tgIds.length; i += BATCH) {
		const batch = tgIds.slice(i, i + BATCH);
		const result = await client.invoke(
			new Api.channels.GetMessages({
				channel,
				id: batch.map((id) => new Api.InputMessageID({ id })),
			}),
		);

		for (const msg of result.messages) {
			// MessageEmpty — пост был удалён в TG (оставляем старые метрики если есть)
			if (msg.className === 'MessageEmpty') continue;
			fetched++;
			const m = messageToMetrics(msg);
			const prev = existing[msg.id];
			// Считаем что обновилось если изменился views/forwards/reactions count
			const changed =
				!prev ||
				prev.views !== m.views ||
				prev.forwards !== m.forwards ||
				prev.replies !== m.replies ||
				JSON.stringify(prev.reactions) !== JSON.stringify(m.reactions);
			if (changed) updatedCount++;
			updated[msg.id] = m;
		}

		// Небольшая пауза между батчами (вежливость к API)
		if (i + BATCH < tgIds.length) await new Promise((r) => setTimeout(r, 500));
	}

	console.log(`📊 Получено метрик: ${fetched} · Обновлено: ${updatedCount}`);

	// 4. Sort keys numerically (читабельнее в diff'ах)
	const sortedKeys = Object.keys(updated).sort((a, b) => Number(a) - Number(b));
	const sortedJson = {};
	for (const k of sortedKeys) sortedJson[k] = updated[k];

	if (DRY) {
		console.log('🚫 DRY_RUN — не пишу файл');
		console.log('Sample (первые 3):');
		for (const k of sortedKeys.slice(0, 3)) {
			console.log(`  ${k}:`, JSON.stringify(sortedJson[k]));
		}
	} else {
		await mkdir(dirname(METRICS_PATH), { recursive: true });
		await writeFile(METRICS_PATH, JSON.stringify(sortedJson, null, 2) + '\n', 'utf8');
		console.log(`💾 Записано: ${METRICS_PATH}`);
	}

	await client.disconnect();
	process.exit(0);
}

main().catch((err) => {
	console.error('💥 Fatal:', err);
	process.exit(1);
});
