/**
 * llm-tag.mjs — LLM-based tagger для постов блога.
 *
 * Зачем: regex-теггер из auto-tag.mjs/suggest-tags.mjs не различал «пост ПРО X»
 * и «упомянул X в перечислении» — давал ложноположительные теги (пост про
 * ДБТ-практику получал теги «клоунада»/«контактная импровизация» из фразы
 * «как было на клоунаде, КИ и др»). LLM с closed-vocabulary решает это.
 *
 * Использование:
 *   node scripts/llm-tag.mjs --all-missing          # тегать только посты без тегов
 *   node scripts/llm-tag.mjs --all                  # перетегать ВСЁ (bulk)
 *   node scripts/llm-tag.mjs --file path/to/post.md # один пост (для теста)
 *   --dry                                           # не писать в файл, только вывод
 *
 * Env:
 *   OR_LLM_API_KEY — OpenRouter API key (обязательно)
 *   LLM_MODEL      — override (default: google/gemini-2.5-flash)
 *
 * Семантика по тегам — та же, что у auto-tag.mjs:
 *   - MANAGED_TAGS полностью пересчитываются LLM'ом;
 *   - PRESERVE_TAGS / любые теги вне vocab — оставляются нетронутыми
 *     (исторические/ручные теги).
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const BLOG = path.resolve(process.cwd(), 'src/content/blog');
const API_KEY = process.env.OR_LLM_API_KEY;
const MODEL = process.env.LLM_MODEL || 'google/gemini-2.5-flash';
const DRY = process.argv.includes('--dry');

if (!API_KEY) { console.error('💥 OR_LLM_API_KEY не задан'); process.exit(1); }

/* Закрытая таксономия тегов с описаниями. Описание — критерий «пост ДЕЙСТВИТЕЛЬНО
   про это» а не «упомянул вскользь». LLM использует именно эти описания для
   решения. Менять описание = менять поведение тегера для всех будущих постов.

   Источники: scripts/auto-tag.mjs MANAGED_TAGS + наблюдаемая частотность тегов
   в корпусе (см. `grep '^tags:' src/content/blog/*.md`). */
const VOCAB = {
	'продакт': 'продакт-менеджмент: кейс-интервью, стажировки, оффер, тестовое, собес, работа PM-ом',
	'карьера': 'поиск работы, увольнение, оффер, конкретная компания (яндекс/авито), CV, отбор',
	'вуз': 'университет/бакалавриат/диплом — ИТМО, МФТИ, МИСиС, диссертация, курсовая, поступление',
	'школа': 'литеральная школьная пора (1-11 класс, физмат-класс, физтех, ЕГЭ, олимпиады, гимназия). НЕ "летняя школа", НЕ "школа танцев"',
	'менторство': 'менторство как практика, менти, я кого-то менторю или меня менторят',
	'нетворкинг': 'тусовки, знакомства, перезнакомства, рандом-кофе, колливинг — основная тема поста',
	'друзья': 'основная тема — про друзей, дружбу, отношения с конкретными людьми',
	'рефлексия': 'глубокая рефлексия о себе: схема-терапия, КПТ, внутренние опоры, уязвимый ребёнок',
	'психология': 'психология как тема: терапия, мантры, эмпатия, страхи, самооценка, одиночество, ДБТ-навыки',
	'медитация': 'медитация / осознанность — основная тема',
	'випассана': 'конкретно випассана как опыт',
	'мужские круги': 'мужские круги как практика',
	'танцы': 'танцы (бачата/кизомба/сальса) как тема — занятия, фестивали, опыт',
	'контактная импровизация': 'КИ как практика, конкретные джемы/занятия по КИ. НЕ упоминание в перечислении',
	'трипы': 'путешествия, поездки, автостоп, конкретные локации (Питер/Тбилиси/Алтай/Карелия) как ОСНОВНАЯ тема',
	'автостоп': 'автостоп как способ путешествия — основная тема',
	'летняя школа': 'ЛШ (Летняя школа) как событие — основная тема',
	'творчество': 'pet-проекты, футболки, принты, написание песен/стихов, сценарии — что-то СОЗДАЛ',
	'театр': 'театр / актёрство / пьесы / спектакли / роли',
	'клоунада': 'клоунада как практика, конкретные занятия. НЕ упоминание в перечислении',
	'боты': 'про разработку/использование ботов (тг-боты, чат-боты)',
	'ии': 'AI / ML / LLM как тема — использование ИИ, агенты, GPT, Claude',
	'истории': 'личная история / рассказ из жизни как форма поста',
	'безумие': 'что-то безумное, безбашенное, "ну ты даёшь" — как осознанная характеристика опыта',
	'жизнь': 'общие размышления о жизни/смысле — но ТОЛЬКО если это центральная тема, не fallback',
	'мнения': 'мнение по широкой теме (политика, индустрия, технологии)',
	'анонс': 'анонс события — приглашение прийти куда-то',
	'школа жизни': 'жизненные уроки — формативный опыт, который чему-то научил',
	'уроки жизни': 'то же что школа жизни, исторический алиас',
	'рекомендации': 'рекомендации книг/фильмов/мест/курсов',
	'whois': 'про себя — кто я, что делаю, общее представление',
	'проекты': 'про конкретные мои проекты',
};

const VOCAB_KEYS = new Set(Object.keys(VOCAB));

function escapeYaml(s) { return (s || '').replace(/'/g, "''").replace(/[\r\n]+/g, ' ').trim(); }

function parseFm(raw) {
	const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!m) return null;
	return { fm: m[1], body: m[2] };
}

function getExistingTags(fm) {
	const m = fm.match(/^tags:\s*\[([^\]]*)\]/m);
	if (!m) return [];
	return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function getTitle(fm) {
	const m = fm.match(/^title:\s*'([\s\S]*?)'\s*$/m);
	return m ? m[1].replace(/''/g, "'") : '';
}

function getSubtitle(fm) {
	const m = fm.match(/^subtitle:\s*'([\s\S]*?)'\s*$/m);
	return m ? m[1].replace(/''/g, "'") : '';
}

const SYSTEM_PROMPT = `Ты теггер постов личного блога. Выбираешь 1-3 тега из закрытого списка по принципу «о ЧЁМ этот пост».

ГЛАВНЫЙ ТЕСТ для тега X: «Если убрать из поста все абзацы про X — пост развалится или станет бессмысленным?». Если ДА → ставь тег. Если НЕТ → не ставь.

АНТИ-ПАТТЕРНЫ (НЕ ставить тег):
- Упоминание в перечислении: «было кайфово на летней школе, клоунаде и КИ» → НЕ ставить ни летнюю школу, ни клоунаду, ни КИ. Это сравнения, а не темы.
- Ссылка на прошлый опыт: «как я писал про випассану раньше» → НЕ ставить випассану.
- Метафора / аналогия: «это как танец двоих» в посте про работу → НЕ ставить танцы.
- Одно слово в скобках/сноске → НЕ повод для тега.
- Пост-перечисление активностей (буллит-список «чем я живу»): одна строчка «ору на театральных тренингах» в списке из 10 пунктов — это про whois/проекты, а НЕ про театр. Тегай такой пост по ФОРМЕ (whois/проекты/истории), а не по каждому буллиту.

ПРИМЕР:
Пост про вторую встречу группы практики ДБТ-навыков, наблюдение за собой, групповая динамика. Упоминает «нравилось на летней школе, клоунаде, КИ» как доказательство «я кайфую от групп».
ПРАВИЛЬНО: ["психология", "рефлексия"] — ДБТ это психология, наблюдение себя это рефлексия.
НЕПРАВИЛЬНО: ["летняя школа", "клоунада", "контактная импровизация"] — все три только в перечислении.

ОСТАЛЬНЫЕ ПРАВИЛА:
- Только теги из предоставленного списка, ничего своего.
- Если пост ни про что из списка — верни [].
- 1-3 тега обычно. 4-5 — только если пост реально про столько разных тем.
- Возвращай СТРОГО валидный JSON: {"tags": ["..."]}. Никаких комментариев.`;

function buildUserPrompt(title, subtitle, body) {
	const vocabBlock = Object.entries(VOCAB).map(([k, v]) => `- ${k}: ${v}`).join('\n');
	const fullText = [title, subtitle, body].filter(Boolean).join('\n\n');
	return `СПИСОК ТЕГОВ:
${vocabBlock}

ПОСТ:
${fullText.slice(0, 8000)}

Верни JSON {"tags": [...]} с 1-5 тегами (или пустой массив если не подходит ни один).`;
}

async function callLLM(title, subtitle, body, attempt = 1) {
	let res;
	try {
		res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: MODEL,
				messages: [
					{ role: 'system', content: SYSTEM_PROMPT },
					{ role: 'user', content: buildUserPrompt(title, subtitle, body) },
				],
				response_format: { type: 'json_object' },
				temperature: 0,
				max_tokens: 500,
			}),
		});
	} catch (e) {
		if (attempt < 3) {
			await new Promise((r) => setTimeout(r, 1000 * attempt));
			return callLLM(title, subtitle, body, attempt + 1);
		}
		throw e;
	}
	if (res.status === 429 || res.status >= 500) {
		if (attempt < 3) {
			await new Promise((r) => setTimeout(r, 1500 * attempt));
			return callLLM(title, subtitle, body, attempt + 1);
		}
	}
	if (!res.ok) {
		const t = await res.text();
		throw new Error(`LLM ${res.status}: ${t.slice(0, 200)}`);
	}
	const data = await res.json();
	const content = data.choices?.[0]?.message?.content || '{}';
	let parsed;
	try { parsed = JSON.parse(content); } catch (e) {
		// Иногда модель добавляет ```json ... ``` обёртку — выдираем.
		const m = content.match(/\{[\s\S]*\}/);
		if (!m) throw new Error(`bad JSON from LLM: ${content.slice(0, 200)}`);
		parsed = JSON.parse(m[0]);
	}
	const raw = Array.isArray(parsed.tags) ? parsed.tags : [];
	// Фильтр: только теги из vocab (LLM иногда галлюцинирует, несмотря на инструкцию).
	const valid = raw.filter((t) => VOCAB_KEYS.has(t));
	const dropped = raw.filter((t) => !VOCAB_KEYS.has(t));
	return { tags: valid, dropped, usage: data.usage };
}

async function tagFile(file, opts = {}) {
	const p = path.join(BLOG, file);
	const raw = await readFile(p, 'utf8');
	const parsed = parseFm(raw);
	if (!parsed) { console.warn(`  skip ${file} — no frontmatter`); return null; }
	const { fm, body } = parsed;
	const existing = getExistingTags(fm);
	const hasManaged = existing.some((t) => VOCAB_KEYS.has(t));

	if (opts.onlyMissing && hasManaged) return null;

	const title = getTitle(fm);
	const subtitle = getSubtitle(fm);
	const { tags, dropped, usage } = await callLLM(title, subtitle, body);

	// Сохраняем теги вне нашего vocab (исторические/ручные).
	const preserved = existing.filter((t) => !VOCAB_KEYS.has(t));
	const merged = [...new Set([...tags, ...preserved])];
	const tagsLine = merged.length === 0
		? null
		: `tags: [${merged.map((t) => `'${escapeYaml(t)}'`).join(', ')}]`;

	const hasTagsLine = /^tags:\s*\[[^\]]*\]/m.test(fm);
	let newFm;
	if (hasTagsLine) {
		newFm = tagsLine
			? fm.replace(/^tags:\s*\[[^\]]*\]/m, tagsLine)
			: fm.replace(/^tags:\s*\[[^\]]*\]\n?/m, '');
	} else if (tagsLine) {
		// Вставляем после pubDate, чтобы соблюсти порядок полей.
		newFm = /^pubDate:/m.test(fm)
			? fm.replace(/^(pubDate:.*)$/m, `$1\n${tagsLine}`)
			: `${fm}\n${tagsLine}`;
	} else {
		newFm = fm;
	}

	const out = `---\n${newFm}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
	if (!DRY && newFm !== fm) await writeFile(p, out, 'utf8');

	const tokenInfo = usage ? `${usage.total_tokens}t` : '?t';
	const slug = file.replace(/\.md$/, '');
	console.log(`  ${DRY ? '[DRY] ' : '✓ '}${slug.slice(0, 50).padEnd(50)} → [${merged.join(', ') || '∅'}] (${tokenInfo})${dropped.length ? ` | dropped: ${dropped.join(',')}` : ''}`);
	return { file, tags: merged, usage };
}

async function main() {
	const args = process.argv.slice(2);
	const fileArg = args.find((a, i) => args[i - 1] === '--file');
	const onlyMissing = args.includes('--all-missing');
	const all = args.includes('--all');

	if (!fileArg && !onlyMissing && !all) {
		console.error('Usage: --file <path> | --all-missing | --all  [--dry]');
		process.exit(2);
	}

	let files;
	if (fileArg) {
		files = [path.basename(fileArg)];
	} else {
		files = (await readdir(BLOG)).filter((f) => f.endsWith('.md')).sort();
	}

	let processed = 0, totalTokens = 0;
	for (const f of files) {
		try {
			const r = await tagFile(f, { onlyMissing });
			if (r) { processed++; totalTokens += r.usage?.total_tokens || 0; }
		} catch (e) {
			console.error(`  ✗ ${f}: ${e.message}`);
		}
	}
	console.log(`\n📊 processed ${processed}/${files.length} · ${totalTokens} tokens`);
}

main();
