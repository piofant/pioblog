import { readFile, writeFile, readdir } from 'node:fs/promises';

const BLOG = '/Users/piofant/cursor/src/content/blog';

const TAG_RULES = [
	{ tag: 'театр',       patterns: [/театр/i, /актёр/i, /актер/i, /\bроль\b/i, /пьес/i, /спектакл/i, /pmf.*актёр/i, /исцеляющ/i, /рольная/i, /поступлени.*на.*актёр/i] },
	{ tag: 'продакт',     patterns: [/продакт/i, /\bpm\b/i, /кейс-интерв/i, /стажиров/i, /джуна?(?!а)/i, /мидл/i, /оффер/i, /резюм/i, /тестов[оыуыя]/i, /собес/i, /вакан/i, /нанимающ/i, /менедж.*продукт/i] },
	{ tag: 'нетворкинг',  patterns: [/нетворк/i, /тус[аоиые]/i, /знакомств/i, /\bSNS\b/i, /колливинг/i, /коворкинг/i, /контекст.*знаком/i, /перезнаком/i, /рандом.*кофе/i] },
	{ tag: 'рефлексия',   patterns: [/рефлекс/i, /схема.?терап/i, /КПТ/i, /уязвимый.?ребен/i, /мысли/i, /\bчувств/i, /\bэмоци/i, /состояни/i, /внутренн.*опор/i, /выводы/i] },
	{ tag: 'трипы',       patterns: [/трип/i, /автостоп/i, /путешеств/i, /випассан/i, /поехал в/i, /поездка/i, /малошуйк/i, /волг/i, /лес.?у/i, /белое море/i, /фестивал/i] },
	{ tag: 'безумие',     patterns: [/безуми/i, /проявленн/i, /столб/i, /упорин/i, /клоунск/i, /короткометражк/i, /странн/i, /рандом/i, /эксперимент/i] },
	{ tag: 'психология',  patterns: [/психолог/i, /мантр/i, /принят/i, /благодарност/i, /круг.*мужчин/i, /эмпати/i, /самооценк/i, /self\-/i, /одиночеств/i, /страх/i] },
	{ tag: 'ии',          patterns: [/\bai\b/i, /\bии\b/i, /\bagent/i, /\bllm\b/i, /вайбкод/i, /claude/i, /gpt/i, /джи.?пи.?титор/i, /n8n/i, /нейросет/i, /ии.?агент/i, /вайб.?коде/i, /промпт/i] },
	{ tag: 'карьера',     patterns: [/карьер/i, /яндекс/i, /авито/i, /работа/i, /позвал на собес/i, /CV/i, /отбор/i, /найти работ/i, /увольн/i, /поиск.*работ/i] },
	{ tag: 'школа жизни', patterns: [/школ[аеы]/i, /\bкласс/i, /физтех/i, /физмат/i, /универ/i, /\bВУЗ/i, /ИТМО/i, /МИСиС/i, /\bЦУ\b/i, /студен/i, /абитуриент/i, /олимпиад/i] },
	{ tag: 'вуз',         patterns: [/\bВУЗ/i, /бакалавр/i, /\bуниверситет/i, /\bстудент/i, /поступлени.*в.*топ/i, /ИТМО/i, /\bМФТИ\b/i, /\bМИСиС\b/i, /\bМИФИ\b/i, /\bЦУ\b/i, /диплом/i, /диссертац/i, /курсовая/i] },
	{ tag: 'анонс',       patterns: [/\[анонс\]/i, /приходит[еь]/i, /конференц/i, /\bдоклад/i, /митап/i, /приглаша/i, /завтра /i, /презентаци/i] },
	{ tag: 'боты',        patterns: [/\bбот[а-я]/i, /telegram-бот/i, /\btg-бот/i, /dogpsybot/i, /projectgrateful/i, /hubhub/i, /edulix/i] },
	{ tag: 'танцы',       patterns: [/бачат/i, /танц/i, /контактн/i, /класс.*бачат/i] },
	{ tag: 'творчество',  patterns: [/создал/i, /запустил/i, /\bпроект[а-я]/i, /футболк/i, /принт/i, /фигм[ае]/i, /сайт/i, /дизайн/i] },
	{ tag: 'друзья',      patterns: [/\bдруз(ь|ь)/i, /дружб/i, /партнер/i, /\bбро\b/i, /компани(я|и).{0,20}др/i] },
	{ tag: 'мнения',      patterns: [/мнени/i, /считаю/i, /точк.*зрени/i, /\bИМХ?О\b/i, /\bкажется\b/i, /я думаю/i] },
	{ tag: 'жизнь',       patterns: [/жизн[иьюе]/i, /по.?жизн/i, /жизнипост/i, /смысл жизни/i, /образ жизни/i] },
];

function classify(text) {
	const tags = new Set();
	for (const { tag, patterns } of TAG_RULES) {
		if (patterns.some((p) => p.test(text))) tags.add(tag);
	}
	return [...tags];
}

function escapeYaml(s) { return (s || '').replace(/'/g, "''").replace(/[\r\n]+/g, ' ').trim(); }

async function main() {
	const files = await readdir(BLOG);
	let touched = 0;
	const stats = new Map();
	for (const f of files) {
		if (!f.endsWith('.md')) continue;
		const p = `${BLOG}/${f}`;
		const raw = await readFile(p, 'utf8');
		const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!m) continue;
		const [, fm, body] = m;
		const title = fm.match(/^title:\s*'((?:[^']|'')*)'/m)?.[1]?.replace(/''/g, "'") || '';
		const subtitle = fm.match(/^subtitle:\s*'((?:[^']|'')*)'/m)?.[1]?.replace(/''/g, "'") || '';
		// strip markdown chars from first 500 body chars
		const bodyText = body.replace(/[\*\[\]\(\)`>#]/g, ' ').slice(0, 500);
		const text = `${title}\n${subtitle}\n${bodyText}`;
		const existingTagsM = fm.match(/^tags:\s*\[([^\]]*)\]/m);
		const existingTags = existingTagsM
			? [...existingTagsM[1].matchAll(/'((?:[^']|'')*)'/g)].map((mm) => mm[1].replace(/''/g, "'"))
			: [];
		const newTags = classify(text);
		// merge + dedupe + drop meta-tags we don't want (telegram)
		const merged = [...new Set([...existingTags, ...newTags])].filter((t) => t !== 'telegram');
		if (merged.length === 0) continue;
		for (const t of merged) stats.set(t, (stats.get(t) || 0) + 1);
		// rewrite frontmatter tags
		const tagsLine = `tags: [${merged.map((t) => `'${escapeYaml(t)}'`).join(', ')}]`;
		let newFm;
		if (existingTagsM) {
			newFm = fm.replace(/^tags:\s*\[[^\]]*\]/m, tagsLine);
		} else {
			newFm = fm + '\n' + tagsLine;
		}
		if (newFm === fm) continue;
		await writeFile(p, `---\n${newFm}\n---\n${body}`);
		touched++;
	}
	console.log(`retagged ${touched} files`);
	console.log('tag distribution:');
	const sorted = [...stats.entries()].sort((a, b) => b[1] - a[1]);
	for (const [t, n] of sorted) console.log(`  ${t}: ${n}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
