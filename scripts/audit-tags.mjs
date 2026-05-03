/**
 * Audit-режим — для каждого тега показывает посты, где тег есть, но в body
 * ОЧЕНЬ слабые сигналы (≤1 матч паттерна). Эти кандидаты на удаление —
 * надо посмотреть глазами.
 *
 * Запуск: node scripts/audit-tags.mjs [tag]
 *   без аргумента — пробег по всем тегам
 *   с тегом — полный листинг постов с этим тегом и кол-вом матчей
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const BLOG = path.resolve(process.cwd(), 'src/content/blog');
const TARGET = process.argv[2];

function wb(re) { return new RegExp(`(?<![\\p{L}\\p{N}])(?:${re})(?![\\p{L}\\p{N}])`, 'iu'); }
function ws(re) { return new RegExp(`(?<![\\p{L}\\p{N}])(?:${re})`, 'iu'); }

const TAG_RULES = [
	{ tag: 'продакт',     patterns: [ws('продакт'), wb('pm'), /кейс[- ]интерв/iu, ws('стажиров'), wb('джуна?'), ws('мидл'), ws('оффер'), ws('резюм'), ws('тестов[оыуая]'), ws('собес'), ws('вакан'), /менедж[\s\S]{0,20}продукт/iu] },
	{ tag: 'карьера',     patterns: [ws('карьер'), ws('яндекс'), ws('авито'), wb('работ[ауые]'), wb('CV'), ws('отбор'), /найти работ/iu, ws('увольн'), /поиск.{0,5}работ/iu, ws('стажировк')] },
	/* «уроки жизни» — manual-only тег. Правила тут только для подсказки кандидатов
	   (`node scripts/audit-tags.mjs уроки жизни`), auto-tag.mjs его НЕ ставит. */
	{ tag: 'уроки жизни', patterns: [
		/школ[аыу]\s+жизни/iu,
		/урок[аиовы]?\s+жизни/iu,
		/жизн[ьеи]\s+(?:меня\s+)?научил/iu,
		/извлек[лао]?\s+(?:из\s+этого\s+)?урок/iu,
		/на\s+собственн[ыоа][ймх]\s+(?:шкуре|опыт)/iu,
		/жизненн[ыоа][ехйм]?\s+(?:урок|опыт|мудрост)/iu,
		/научил[оа]?\s+меня/iu,
		/важн[ыоа][ехйм]?\s+(?:урок|вывод)/iu,
		/главн[ыоа][ехйм]?\s+(?:урок|вывод)/iu,
		/что\s+я\s+(?:понял|осознал|усвоил|вынес)\s+из/iu,
	] },
	{ tag: 'вуз',         patterns: [ws('ВУЗ'), ws('бакалавр'), ws('университет'), ws('студент'), /поступлени.{0,15}в.{0,5}топ/iu, ws('ИТМО'), ws('МФТИ'), ws('МИСиС'), ws('МИФИ'), ws('ЦУ'), ws('диплом'), ws('диссертац'), ws('курсовая')] },
	{ tag: 'школа',       patterns: [
		/(?:[1-9]|1[01])[-\s]?(?:го|й|ый|ом|ого|ому|ой)?\s*клас/iu,
		/физмат(?:овск[а-я]+|ный|ная|ной|ном)?\s*класс/iu,
		ws('физтех'),
		ws('физмат'),
		new RegExp('(?<![\\p{L}\\p{N}])школьн', 'iu'),
		ws('олимпиад'),
		ws('абитуриент'),
		ws('гимназ'),
		/\bЕГЭ\b/iu,
	] },
	{ tag: 'менторство',  patterns: [ws('менторств'), wb('ментор[ауеы]?'), ws('менти')] },
	{ tag: 'нетворкинг',  patterns: [ws('нетворк'), ws('тус[аоиыeу]'), ws('знакомств'), ws('SNS'), ws('колливинг'), ws('перезнаком'), /рандом.?кофе/iu, /random.?coffee/i] },
	{ tag: 'друзья',      patterns: [ws('друз[ьея]'), ws('дружб'), wb('бро')] },
	{ tag: 'рефлексия',   patterns: [ws('рефлекс'), /схема.?терап/iu, ws('КПТ'), /уязвимый.?ребен/iu, /внутренн.{0,5}опор/iu] },
	{ tag: 'психология',  patterns: [ws('психолог'), ws('мантр'), /принят(?:ие|ия|ием|ии)\s+(?:себя|реальност|мира|обстоятел|чувств)/iu, ws('благодарност'), ws('эмпати'), ws('самооценк'), ws('одиночеств'), ws('страх'), ws('терапи'), ws('ДБТ')] },
	{ tag: 'медитация',   patterns: [ws('медитац'), ws('осознанност')] },
	{ tag: 'випассана',   patterns: [ws('випассан')] },
	{ tag: 'мужские круги', patterns: [/мужск.{0,8}круг/iu] },
	{ tag: 'танцы',       patterns: [ws('бачат'), ws('танц'), ws('кизомб'), ws('сальс')] },
	{ tag: 'контактная импровизация', patterns: [/контактн[аоуыие].{0,8}импровизац/iu] },
	{ tag: 'трипы',       patterns: [ws('трип'), ws('автостоп'), ws('путешеств'), ws('поездка'), ws('малошуйк'), /белое море/iu, /поехал[а]?\s+(?:в|на)\s+(?:москв|питер|сочи|тбилиси|тур|город|деревн|поход|кавказ|алтай|байкал|карели|хиб|крым|калинин|казах|армен|грузи)/iu] },
	{ tag: 'автостоп',    patterns: [ws('автостоп')] },
	{ tag: 'летняя школа', patterns: [/летн(?:яя|юю|ей|ие)\s+школ/iu, /(?<![\p{L}\p{N}])лш(?![\p{L}\p{N}])/iu] },
	{ tag: 'творчество',  patterns: [ws('творчеств'), /пет[-_ ]проект/iu, ws('футболк'), ws('принт'), ws('фигм[ае]'), /(?:придумал|сшил|нарисовал|снял|написал|сочинил)[а]?\s+(?:футболк|принт|песн|стих|сценари|клип|короткометражк|логотип|сайт|пост\b|серию)/iu] },
	{ tag: 'театр',       patterns: [ws('театр'), ws('актёр'), ws('актер'), ws('пьес'), ws('спектакл'), /(?:сыграл|играл|играю)[а]?\s+роль/iu, /театральн[ыоуа][хеймй]/iu] },
	{ tag: 'клоунада',    patterns: [ws('клоун')] },
	{ tag: 'безумие',     patterns: [ws('безуми'), ws('проявленн'), wb('столб'), ws('упорин'), ws('короткометражк')] },
	{ tag: 'ии',          patterns: [wb('ai'), wb('ии'), wb('agent'), wb('llm'), ws('вайбкод'), wb('claude'), wb('gpt'), /n8n/i, ws('нейросет'), ws('промпт'), /ии.?агент/iu, /вайб.?код/iu] },
	{ tag: 'боты',        patterns: [ws('бот[а-яё]+'), /telegram[- ]?бот/iu, /tg[- ]?бот/iu, /dogpsybot/i, /projectgrateful/i, /hubhub/i, /edulix/i] },
	{ tag: 'жизнь',       patterns: [/смысл\s+жизни/iu, /образ\s+жизни/iu, /качество\s+жизни/iu, /(?:моя|своя|вся|новая)\s+жизн[ьи]/iu, /жизн[еи]\s+(?:после|до|вне|между)/iu, /прожит[ая]?\s+жизнь/iu, /жизненн[ыоа][ехйм]?\s+(?:путь|выбор|опыт|цел[ьи]|приоритет|ценност)/iu] },
	{ tag: 'мнения',      patterns: [ws('мнени[ея]'), /точк.{0,4}зрени/iu, /\bИМХ?О\b/i] },
	{ tag: 'анонс',       patterns: [
		/\[анонс\]/i,
		/приходите?\s+(?:на|в|ко)/iu,
		/приглаша[юе][тм]?\s+(?:вас|тебя|всех|на|в)/iu,
		/регистрац[ии][яюи]\s+(?:на|по|тут|здесь)/iu,
		/(?:будет|пройдёт|состоится|проведу)\s+(?:в\s+)?(?:[а-я]+\s+)?(?:встреч|митап|воркшоп|сессия|круг|тус|конференц|вечер)/iu,
		/заходи(?:те)?\s+(?:на|в|посмотреть)/iu,
		/зов[иёу](?:те)?\b/iu,
		/(?:могу|хочу|готов[а]?)\s+(?:прийти|выступить|рассказать|провести|сделать)/iu,
		/(?:в|во)\s+(?:эт[уоа][тйм])?\s*(?:субботу|воскресенье|пятницу|четверг)\b/iu,
		/расскажу\s+на/iu,
		/набираю\s+(?:в|на|группу|команду)/iu,
	] },
];

function countMatches(text, patterns) {
	let n = 0;
	for (const p of patterns) {
		const re = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g');
		const matches = text.match(re);
		if (matches) n += matches.length;
	}
	return n;
}

const files = (await readdir(BLOG)).filter((f) => f.endsWith('.md'));
const posts = [];
for (const f of files) {
	const raw = await readFile(path.join(BLOG, f), 'utf8');
	const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!m) continue;
	const [, fm, body] = m;
	const titleM = fm.match(/^title:\s*'((?:[^']|'')*)'/m);
	const tagsM = fm.match(/^tags:\s*\[([^\]]*)\]/m);
	const tags = tagsM
		? [...tagsM[1].matchAll(/'((?:[^']|'')*)'/g)].map((mm) => mm[1].replace(/''/g, "'"))
		: [];
	const text = (titleM ? titleM[1].replace(/''/g, "'") : '') + '\n' + body.replace(/[\*\[\]\(\)`>#]/g, ' ');
	posts.push({ id: f.replace('.md', ''), title: titleM ? titleM[1].slice(0, 50) : '?', tags, text });
}

const ruleByTag = new Map(TAG_RULES.map((r) => [r.tag, r.patterns]));

if (TARGET) {
	const patterns = ruleByTag.get(TARGET);
	if (!patterns) { console.log(`Unknown tag: ${TARGET}`); process.exit(1); }
	const matched = posts.filter((p) => p.tags.includes(TARGET));
	console.log(`\n=== ${TARGET} (${matched.length} posts) ===`);
	matched
		.map((p) => ({ ...p, n: countMatches(p.text, patterns) }))
		.sort((a, b) => a.n - b.n)
		.forEach((p) => {
			const flag = p.n === 0 ? ' ⚠️ NO MENTIONS' : p.n === 1 ? ' ⚠️ weak (1 mention)' : '';
			console.log(`  [${p.n.toString().padStart(2)}] ${p.id}${flag}`);
		});
} else {
	console.log('\n=== suspect posts (tag set but ≤1 body mention) per tag ===\n');
	for (const { tag, patterns } of TAG_RULES) {
		const tagged = posts.filter((p) => p.tags.includes(tag));
		const suspect = tagged
			.map((p) => ({ ...p, n: countMatches(p.text, patterns) }))
			.filter((p) => p.n <= 1)
			.sort((a, b) => a.n - b.n);
		if (!suspect.length) continue;
		console.log(`▼ ${tag} — ${suspect.length}/${tagged.length} suspect:`);
		for (const p of suspect.slice(0, 6)) {
			console.log(`   [${p.n}] ${p.id}`);
		}
		if (suspect.length > 6) console.log(`   …и ещё ${suspect.length - 6}`);
		console.log();
	}
}
