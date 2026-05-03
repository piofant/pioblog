/**
 * Re-tag всех постов на основе rule-based классификации.
 *
 * Ключевые принципы:
 * 1. Управляемые теги (`MANAGED_TAGS`) — только те, что попали в правила.
 *    При re-tag они ПОЛНОСТЬЮ перевычисляются (а не мержатся), так что
 *    устаревшие ложноположительные теги вычищаются.
 * 2. Неуправляемые теги (`PRESERVE_TAGS` + всё что не в managed) — как-то
 *    попали туда руками или из миграции, оставляем нетронутыми.
 * 3. Body анализируем целиком (раньше брали только первые 500 символов и
 *    из-за этого пропускали ключевые слова в глубине поста).
 *
 * Правила для тегов, требующих специфичных фраз (типа «контактная
 * импровизация»), пишутся СТРОГО, чтоб не ловить ложные срабатывания.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const BLOG = path.resolve(process.cwd(), 'src/content/blog');

/* Helper: cyrillic-aware "word boundary" via Unicode lookbehind/lookahead.
   JS `\b` опирается на ASCII `\w` и НЕ срабатывает на кириллице, поэтому
   `/\bтанц/i` не матчится в "танцевал". Обёртка использует /u и проверку
   через \p{L}/\p{N}. */
function wb(re) { return new RegExp(`(?<![\\p{L}\\p{N}])(?:${re})(?![\\p{L}\\p{N}])`, 'iu'); }
function ws(re) { return new RegExp(`(?<![\\p{L}\\p{N}])(?:${re})`, 'iu'); }  // word-start only (suffix can grow)

/* Правила: каждый тег → массив паттернов. Если ХОТЯ БЫ один матчится в
   title + subtitle + body, тег ставится. */
const TAG_RULES = [
	// — Тематические (карьера / продакт / учёба) —
	{ tag: 'продакт',     patterns: [ws('продакт'), wb('pm'), /кейс[- ]интерв/iu, ws('стажиров'), wb('джуна?'), ws('мидл'), ws('оффер'), ws('резюм'), ws('тестов[оыуая]'), ws('собес'), ws('вакан'), /менедж[\s\S]{0,20}продукт/iu] },
	{ tag: 'карьера',     patterns: [ws('карьер'), ws('яндекс'), ws('авито'), wb('работ[ауые]'), wb('CV'), ws('отбор'), /найти работ/iu, ws('увольн'), /поиск.{0,5}работ/iu, ws('стажировк')] },
	/* «школа жизни» — про жизненные уроки и экспириенсы, которые чему-то научили.
	   НЕ про литеральную школу (это тег `школа`) и не про вуз (тег `вуз`).
	   Ловится ТОЛЬКО по идиоматическим фразам — никаких «понял что», иначе
	   накроет любую рефлексию. Кому надо — добавит руками. */
	{ tag: 'школа жизни', patterns: [
		/школ[аыу]\s+жизни/iu,                                  // сама идиома
		/урок[аиовы]?\s+жизни/iu,                               // «урок жизни»
		/жизн[ьеи]\s+(?:меня\s+)?научил/iu,                     // «жизнь меня научила»
		/извлек[лао]?\s+(?:из\s+этого\s+)?урок/iu,              // «извлёк урок»
		/на\s+собственн[ыоа][ймх]\s+(?:шкуре|опыт)/iu,          // «на собственной шкуре»
		/жизненн[ыоа][ехйм]?\s+(?:урок|опыт|мудрост)/iu,        // «жизненный урок/опыт»
	] },
	{ tag: 'вуз',         patterns: [ws('ВУЗ'), ws('бакалавр'), ws('университет'), ws('студент'), /поступлени.{0,15}в.{0,5}топ/iu, ws('ИТМО'), ws("МФТИ"), ws("МИСиС"), ws("МИФИ"), ws("ЦУ"), ws('диплом'), ws('диссертац'), ws('курсовая')] },
	/* «школа» — литеральная школьная пора (1-11 классы, физмат, олимпиады).
	   Голое `школа` НЕ ловим — оно идиоматично («летняя школа», «школа танцев»,
	   «школа клоунады», «школа жизни»). Только школьно-специфичные сигналы. */
	{ tag: 'школа',       patterns: [
		/(?:[1-9]|1[01])[-\s]?(?:го|й|ый|ом|ого|ому|ой)?\s*клас/iu,   // "10 класс", "9-й класс"
		/физмат(?:овск[а-я]+|ный|ная|ной|ном)?\s*класс/iu,             // физмат класс
		ws('физтех'),
		ws('физмат'),
		new RegExp('(?<![\\p{L}\\p{N}])школьн', 'iu'),                  // школьный/школьник
		ws('олимпиад'),
		ws('абитуриент'),
		ws('гимназ'),
		/\bЕГЭ\b/iu,
	] },
	{ tag: 'менторство',  patterns: [ws('менторств'), wb('ментор[ауеы]?'), ws('менти')] },

	// — Сообщество / нетворк —
	{ tag: 'нетворкинг',  patterns: [ws('нетворк'), ws('тус[аоиыeу]'), ws('знакомств'), ws("SNS"), ws('колливинг'), ws('перезнаком'), /рандом.?кофе/iu, /random.?coffee/i] },
	{ tag: 'друзья',      patterns: [ws('друз[ьея]'), ws('дружб'), wb('бро')] },

	// — Психология / рефлексия —
	{ tag: 'рефлексия',   patterns: [ws('рефлекс'), /схема.?терап/iu, ws("КПТ"), /уязвимый.?ребен/iu, /внутренн.{0,5}опор/iu] },
	{ tag: 'психология',  patterns: [ws('психолог'), ws('мантр'), /принят(?:ие|ия|ием|ии)\s+(?:себя|реальност|мира|обстоятел|чувств)/iu, ws('благодарност'), ws('эмпати'), ws('самооценк'), ws('одиночеств'), ws('страх'), ws('терапи'), ws("ДБТ")] },
	{ tag: 'медитация',   patterns: [ws('медитац'), ws('осознанност')] },
	{ tag: 'випассана',   patterns: [ws('випассан')] },
	{ tag: 'мужские круги', patterns: [/мужск.{0,8}круг/iu] },

	// — Тело / движение —
	{ tag: 'танцы',       patterns: [ws('бачат'), ws('танц'), ws('кизомб'), ws('сальс')] },
	{ tag: 'контактная импровизация', patterns: [
		/контактн[аоуыие].{0,8}импровизац/iu,
		new RegExp('(?<![\\p{L}\\p{N}])КИ(?![\\p{L}\\p{N}])(?=.{0,40}(танец|танц|пара))', 'u'),
	] },

	// — Путешествия / трипы —
	{ tag: 'трипы',       patterns: [ws('трип'), ws('автостоп'), ws('путешеств'), ws('поездка'), ws('малошуйк'), /белое море/iu, /поехал[а]?\s+(?:в|на)\s+(?:москв|питер|сочи|тбилиси|тур|город|деревн|поход|кавказ|алтай|байкал|карели|хиб|крым|калинин|казах|армен|грузи)/iu] },
	{ tag: 'автостоп',    patterns: [ws('автостоп')] },
	{ tag: 'летняя школа', patterns: [/летн(?:яя|юю|ей|ие|ие)\s+школ/iu, /(?<![\p{L}\p{N}])лш(?![\p{L}\p{N}])/iu] },

	// — Творчество / самовыражение —
	{ tag: 'творчество',  patterns: [ws('создал'), ws('запустил'), /пет[-_ ]проект/iu, ws('футболк'), ws('принт'), ws('фигм[ае]'), ws('дизайн')] },
	{ tag: 'театр',       patterns: [ws('театр'), ws('актёр'), ws('актер'), ws('пьес'), ws('спектакл'), wb('роль')] },
	{ tag: 'клоунада',    patterns: [ws('клоун')] },
	{ tag: 'безумие',     patterns: [ws('безуми'), ws('проявленн'), wb('столб'), ws('упорин'), ws('короткометражк')] },

	// — Технологии —
	{ tag: 'ии',          patterns: [wb('ai'), wb('ии'), wb('agent'), wb('llm'), ws('вайбкод'), wb('claude'), wb('gpt'), /n8n/i, ws('нейросет'), ws('промпт'), /ии.?агент/iu, /вайб.?код/iu] },
	{ tag: 'боты',        patterns: [ws('бот[а-яё]+'), /telegram[- ]?бот/iu, /tg[- ]?бот/iu, /dogpsybot/i, /projectgrateful/i, /hubhub/i, /edulix/i] },

	// — Общее —
	{ tag: 'жизнь',       patterns: [ws('жизн[иьюе]'), /смысл жизни/iu, /образ жизни/iu] },
	{ tag: 'мнения',      patterns: [ws('мнени[ея]'), /точк.{0,4}зрени/iu, /\bИМХ?О\b/i] },
	{ tag: 'анонс',       patterns: [/\[анонс\]/i, ws('конференц'), ws('доклад'), ws('митап'), ws('презентаци'), ws('приходит[еь]'), ws('приглаша[юе]')] },
];

const MANAGED_TAGS = new Set(TAG_RULES.map((r) => r.tag));
/* Тег `telegram` исторически клеился синком — выкидываем как шумовой. */
const DROP_TAGS = new Set(['telegram']);

function classify(text) {
	const tags = new Set();
	for (const { tag, patterns } of TAG_RULES) {
		if (patterns.some((p) => p.test(text))) tags.add(tag);
	}
	return tags;
}

function escapeYaml(s) { return (s || '').replace(/'/g, "''").replace(/[\r\n]+/g, ' ').trim(); }

async function main() {
	const files = (await readdir(BLOG)).filter((f) => f.endsWith('.md'));
	let touched = 0;
	const stats = new Map();

	for (const f of files) {
		const p = path.join(BLOG, f);
		const raw = await readFile(p, 'utf8');
		const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!m) continue;
		const [, fm, body] = m;

		const title = fm.match(/^title:\s*'((?:[^']|'')*)'/m)?.[1]?.replace(/''/g, "'") || '';
		const subtitle = fm.match(/^subtitle:\s*'((?:[^']|'')*)'/m)?.[1]?.replace(/''/g, "'") || '';
		// Анализируем ВЕСЬ body (без markdown-обвязки)
		const bodyText = body.replace(/[\*\[\]\(\)`>#]/g, ' ');
		const text = `${title}\n${subtitle}\n${bodyText}`;

		const existingTagsM = fm.match(/^tags:\s*\[([^\]]*)\]/m);
		const existingTags = existingTagsM
			? [...existingTagsM[1].matchAll(/'((?:[^']|'')*)'/g)].map((mm) => mm[1].replace(/''/g, "'"))
			: [];

		const newAuto = classify(text);
		// Сохраняем «ручные» теги (не в managed-списке + не в drop-списке)
		const preserved = existingTags.filter((t) => !MANAGED_TAGS.has(t) && !DROP_TAGS.has(t));
		const merged = [...new Set([...preserved, ...newAuto])];
		// Сортируем: сначала managed (по rule-order), потом preserved
		const ruleOrder = new Map(TAG_RULES.map((r, i) => [r.tag, i]));
		merged.sort((a, b) => {
			const ai = ruleOrder.has(a) ? ruleOrder.get(a) : 1000;
			const bi = ruleOrder.has(b) ? ruleOrder.get(b) : 1000;
			return ai - bi;
		});

		for (const t of merged) stats.set(t, (stats.get(t) || 0) + 1);

		const tagsLine = merged.length === 0
			? null
			: `tags: [${merged.map((t) => `'${escapeYaml(t)}'`).join(', ')}]`;

		let newFm = fm;
		if (existingTagsM) {
			newFm = tagsLine ? fm.replace(/^tags:\s*\[[^\]]*\]/m, tagsLine) : fm.replace(/^tags:\s*\[[^\]]*\]\n?/m, '');
		} else if (tagsLine) {
			newFm = fm + '\n' + tagsLine;
		}
		if (newFm === fm) continue;

		await writeFile(p, `---\n${newFm}\n---\n${body}`);
		touched++;
	}

	console.log(`retagged ${touched} files\n`);
	console.log('tag distribution:');
	const sorted = [...stats.entries()].sort((a, b) => b[1] - a[1]);
	for (const [t, n] of sorted) console.log(`  ${n.toString().padStart(3)} ${t}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
