#!/usr/bin/env node
// Smoke-test для sync-telegram pipeline. Проверяет:
//   - fixBody (paragraphize + splitMultilineEmphasis, BEZ unwrapBracketKickers)
//   - slugify (cyrillic → translit, no breaks mid-word)
//   - title extraction с kicker `[часть N]` → subtitle
//   - dedup первого параграфа body, если он совпадает с title
//   - listExistingTgIds — читает frontmatter из существующих постов

import { fixBody, paragraphize, splitMultilineEmphasis, unwrapBracketKickers } from './lib/markdown.mjs';
import { readdir, readFile, open as fsOpen } from 'node:fs/promises';
import path from 'node:path';

let pass = 0, fail = 0;
function check(name, expected, actual) {
	if (expected === actual) { console.log(`  ✓ ${name}`); pass++; }
	else { console.log(`  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`); fail++; }
}

console.log('\n[1] fixBody — single newline → paragraph break');
check(
	'plain text',
	'foo\n\nbar',
	fixBody('foo\nbar'),
);

console.log('\n[2] fixBody — keeps [**label**] kickers (TG style, not unwrapped)');
check(
	'kicker brackets preserved',
	'[**что меня туда привело**]\n\nbody...',
	fixBody('[**что меня туда привело**]\nbody...'),
);

console.log('\n[3] fixBody — multi-line bold split per-line');
check(
	'multi-line bold',
	'**foo**\n\n**bar**',
	fixBody('**foo\nbar**'),
);

console.log('\n[4] slugify — cyrillic title');
const TRANSLIT = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'iu',я:'ia'};
function slugify(title, maxLen = 60) {
	let s = (title || '').toLowerCase();
	s = s.split('').map((c) => (TRANSLIT[c] !== undefined ? TRANSLIT[c] : c)).join('');
	s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	if (s.length > maxLen) s = s.slice(0, maxLen).replace(/-[^-]*$/, '');
	return s || 'tg';
}
check('short title', 'kak-naiti-rabotu', slugify('Как найти работу'));
check('with punctuation', 'foo-bar-baz', slugify('foo, bar — baz!'));
check('cyrillic + numbers', '0-lidov-za-2-mesiatsa', slugify('0 лидов за 2 месяца'));
check('truncated at word boundary', slugify('Ситуации новые а когнитивные баги одни и те же буквально хожу кругами не ощущаю динамики').length <= 60, true);

console.log('\n[5] kicker extraction (title vs subtitle)');
function extractTitleSubtitle(rawFirstLine) {
	let title = rawFirstLine, subtitle = '';
	const m = rawFirstLine.match(/^(.*?)\s*\[([^\[\]]{1,40})\]\s*$/);
	if (m && m[1].trim()) {
		title = m[1].trim();
		subtitle = m[2].replace(/\\[nrt]/g, '').replace(/\s+/g, ' ').trim();
	}
	return { title, subtitle };
}
check('with [часть 1\\n]', JSON.stringify({ title: 'Сходил на терапию', subtitle: 'часть 1' }),
	JSON.stringify(extractTitleSubtitle('Сходил на терапию [часть 1\\n]')));
check('with [1/3]', JSON.stringify({ title: 'Анонс', subtitle: '1/3' }),
	JSON.stringify(extractTitleSubtitle('Анонс [1/3]')));
check('no kicker', JSON.stringify({ title: 'Просто заголовок', subtitle: '' }),
	JSON.stringify(extractTitleSubtitle('Просто заголовок')));

console.log('\n[6] first-body-paragraph dedup');
function dedupFirstPara(body, title) {
	const cleanForCompare = (s) => s
		.replace(/\*+/g, '').replace(/\\[nrt]/g, '').replace(/\[[^\[\]]{1,40}\]/g, '')
		.replace(/\s+/g, ' ').trim().toLowerCase();
	const firstBodyPara = (body.split(/\n{2,}/)[0] || '').trim();
	if (firstBodyPara && cleanForCompare(firstBodyPara).startsWith(cleanForCompare(title).slice(0, 40))) {
		return body.replace(/^[\s\S]*?(\n{2,}|$)/, '').trimStart();
	}
	return body;
}
check(
	'drops duplicate first paragraph',
	'[**что меня туда привело**]\n\nзаметил, что...',
	dedupFirstPara('**Сходил на терапию **[часть 1\\n]\n\n[**что меня туда привело**]\n\nзаметил, что...', 'Сходил на терапию'),
);
check(
	'keeps body when first paragraph differs',
	'это начало поста\n\nи тело',
	dedupFirstPara('это начало поста\n\nи тело', 'Совсем другой title'),
);

console.log('\n[7] listExistingTgIds — реальные файлы');
const POSTS_DIR = path.resolve(process.cwd(), 'src/content/blog');
async function listExistingTgIds() {
	const ids = new Set();
	const files = await readdir(POSTS_DIR);
	for (const f of files) {
		if (!f.endsWith('.md')) continue;
		const legacy = f.match(/^tg-(\d+)\.md$/);
		if (legacy) { ids.add(Number(legacy[1])); continue; }
		try {
			const fh = await fsOpen(path.join(POSTS_DIR, f), 'r');
			const buf = Buffer.alloc(800);
			await fh.read(buf, 0, 800, 0);
			await fh.close();
			const txt = buf.toString('utf8');
			const fm = txt.match(/^---\n([\s\S]*?)\n---/);
			if (fm) {
				const idMatch = fm[1].match(/^tgMessageId:\s*(\d+)/m);
				if (idMatch) ids.add(Number(idMatch[1]));
			}
		} catch {}
	}
	return ids;
}
const ids = await listExistingTgIds();
console.log(`  detected ${ids.size} TG msg IDs (from frontmatter + legacy tg-NNN.md)`);
check('contains 434', true, ids.has(434));
check('contains 432', true, ids.has(432));
check('contains 431', true, ids.has(431));
check('contains 426', true, ids.has(426));
check('contains 142', true, ids.has(142));
check('does NOT contain 999 (sentinel)', false, ids.has(999));

console.log(`\n${'='.repeat(40)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
