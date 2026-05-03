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

/* Правила: каждый тег → массив паттернов. Если ХОТЯ БЫ один матчится в
   title + subtitle + body, тег ставится. */
const TAG_RULES = [
	// — Тематические (карьера / продакт / учёба) —
	{ tag: 'продакт',     patterns: [/продакт/i, /\bpm\b/i, /кейс-интерв/i, /стажиров/i, /\bджуна?\b/i, /мидл/i, /оффер/i, /резюм/i, /тестов[оыуыя]/i, /собес/i, /вакан/i, /менедж.*продукт/i] },
	{ tag: 'карьера',     patterns: [/карьер/i, /яндекс/i, /авито/i, /\bработ[ауые]\b/i, /CV/i, /отбор/i, /найти работ/i, /увольн/i, /поиск.*работ/i, /стажировк/i] },
	{ tag: 'школа жизни', patterns: [/школ[аеы]/i, /\bкласс/i, /физтех/i, /физмат/i, /универ/i, /\bВУЗ/i, /ИТМО/i, /МИСиС/i, /\bЦУ\b/i, /\bстуден/i, /абитуриент/i, /олимпиад/i] },
	{ tag: 'вуз',         patterns: [/\bВУЗ/i, /бакалавр/i, /\bуниверситет/i, /\bстудент/i, /поступлени.*в.*топ/i, /ИТМО/i, /\bМФТИ\b/i, /\bМИСиС\b/i, /\bМИФИ\b/i, /\bЦУ\b/i, /диплом/i, /диссертац/i, /курсовая/i] },
	{ tag: 'менторство',  patterns: [/менторств/i, /\bментор[ауеы]?\b/i, /менти/i] },

	// — Сообщество / нетворк —
	{ tag: 'нетворкинг',  patterns: [/нетворк/i, /\bтус[аоиыe]/i, /знакомств/i, /\bSNS\b/i, /колливинг/i, /перезнаком/i, /рандом.?кофе/i, /random.?coffee/i] },
	{ tag: 'друзья',      patterns: [/\bдруз[ьея]/i, /дружб/i, /\bбро\b/i] },

	// — Психология / рефлексия —
	{ tag: 'рефлексия',   patterns: [/рефлекс/i, /схема.?терап/i, /\bКПТ\b/i, /уязвимый.?ребен/i, /внутренн.*опор/i] },
	{ tag: 'психология',  patterns: [/психолог/i, /мантр/i, /\bпринят/i, /благодарност/i, /эмпати/i, /самооценк/i, /одиночеств/i, /\bстрах[аоуыие]?\b/i, /терапи/i, /\bДБТ\b/i] },
	{ tag: 'медитация',   patterns: [/медитац/i, /осознанност/i] },
	{ tag: 'випассана',   patterns: [/випассан/i] },
	{ tag: 'мужские круги', patterns: [/мужск.{0,8}круг/i] },

	// — Тело / движение —
	{ tag: 'танцы',       patterns: [/бачат/i, /\bтанц[еуыюо]/i, /кизомб/i, /сальс/i] },
	{ tag: 'контактная импровизация', patterns: [
		/контактн[аоуыие].{0,8}импровизац/i,  // "контактная импровизация" во всех падежах
		/\bКИ\b(?=.{0,40}(танец|танц|пара))/i,  // КИ как сокращение, в контексте танца
	] },

	// — Путешествия / трипы —
	{ tag: 'трипы',       patterns: [/\bтрип/i, /автостоп/i, /путешеств/i, /поехал в/i, /поездка/i, /малошуйк/i, /белое море/i, /фестивал/i] },
	{ tag: 'автостоп',    patterns: [/автостоп/i] },
	{ tag: 'летняя школа', patterns: [/\bлетняя школа\b/i, /\bлетней школы\b/i, /\bлетнюю школу\b/i, /\bна лш\b/i, /\bлш\b/i] },

	// — Творчество / самовыражение —
	{ tag: 'творчество',  patterns: [/\bсоздал\b/i, /\bзапустил\b/i, /\bпет[-_ ]проект/i, /футболк/i, /принт/i, /фигм[ае]/i, /дизайн/i] },
	{ tag: 'театр',       patterns: [/театр/i, /актёр/i, /актер/i, /пьес/i, /спектакл/i, /\bроль\b/i] },
	{ tag: 'клоунада',    patterns: [/клоун/i] },
	{ tag: 'безумие',     patterns: [/безуми/i, /проявленн/i, /\bстолб\b/i, /упорин/i, /короткометражк/i] },

	// — Технологии —
	{ tag: 'ии',          patterns: [/\bai\b/i, /\bии\b/i, /\bagent/i, /\bllm\b/i, /вайбкод/i, /\bclaude\b/i, /\bgpt\b/i, /n8n/i, /нейросет/i, /промпт/i, /ии.?агент/i, /вайб.?код/i] },
	{ tag: 'боты',        patterns: [/\bбот[а-я]+\b/i, /telegram-бот/i, /tg-бот/i, /dogpsybot/i, /projectgrateful/i, /hubhub/i, /edulix/i] },

	// — Общее —
	{ tag: 'жизнь',       patterns: [/\bжизн[иьюе]\b/i, /смысл жизни/i, /образ жизни/i] },
	{ tag: 'мнения',      patterns: [/\bмнени[ея]\b/i, /точк.{0,4}зрени/i, /\bИМХ?О\b/i] },
	{ tag: 'анонс',       patterns: [/\[анонс\]/i, /\bконференц/i, /\bдоклад/i, /\bмитап\b/i, /\bпрезентаци/i, /приходит[еь]/i, /приглаша[юе]/i] },
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
