#!/usr/bin/env node
// One-shot: переименовывает src/content/blog/tg-NNN.md → {slug}-NNN.md
// и добавляет `tgMessageId: NNN` во frontmatter (если ещё нет).

import { readdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

const POSTS = path.resolve(process.cwd(), 'src/content/blog');

const TRANSLIT = {
	а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',
	к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
	х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'iu',я:'ia',
};
function slugify(title, maxLen = 60) {
	let s = (title || '').toLowerCase();
	s = s.split('').map((c) => (TRANSLIT[c] !== undefined ? TRANSLIT[c] : c)).join('');
	s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	if (s.length > maxLen) s = s.slice(0, maxLen).replace(/-[^-]*$/, '');
	return s || 'tg';
}

const files = (await readdir(POSTS)).filter((f) => /^tg-\d+\.md$/.test(f));
let renamed = 0;

for (const f of files) {
	const id = Number(f.match(/^tg-(\d+)\.md$/)[1]);
	const abs = path.join(POSTS, f);
	let txt = await readFile(abs, 'utf8');
	const fm = txt.match(/^---\n([\s\S]*?)\n---\n/);
	if (!fm) continue;
	const head = fm[1];
	const body = txt.slice(fm[0].length);
	const titleM = head.match(/^title:\s*['"]?(.+?)['"]?\s*$/m);
	const title = titleM ? titleM[1].replace(/''/g, "'") : '';
	const slug = slugify(title);
	const newName = `${slug}-${id}.md`;
	const newAbs = path.join(POSTS, newName);

	// Add tgMessageId if not already present
	let newHead = head;
	if (!/^tgMessageId:/m.test(head)) {
		// Insert after pubDate (or at end)
		if (/^pubDate:/m.test(head)) {
			newHead = head.replace(/^(pubDate:.*)$/m, `$1\ntgMessageId: ${id}`);
		} else {
			newHead = head + `\ntgMessageId: ${id}`;
		}
	}

	const newTxt = `---\n${newHead}\n---\n${body}`;
	await writeFile(newAbs, newTxt);
	if (newName !== f) await rename(abs, newAbs).catch(() => {}); // already wrote, but rename old to be safe
	console.log(`✓ ${f} → ${newName}`);
	renamed++;
}
console.log(`\nMigrated ${renamed} tg-NNN.md files.`);
