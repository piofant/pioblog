#!/usr/bin/env node
/**
 * Fix missing paragraph breaks across all blog posts.
 *
 * Pattern: a "section label" line wrapped in `[...]` (often `[**...**]`)
 * is followed immediately by content on the next line, with no blank line between.
 * Markdown treats single newline as soft break (renders as space) — so the label
 * and the content collapse into one paragraph visually.
 *
 * Fix: insert a blank line between the label line and its content.
 *
 * Patterns handled:
 *   [**в школьные годы**]\nя настроил...   →   [**в школьные годы**]\n\nя настроил...
 *   [сегодня]\nшколу я уже закончил...     →   [сегодня]\n\nшколу...
 *
 * Also:
 *   - skip if the next line starts with a list marker / heading / code fence /
 *     blockquote / image — those don't suffer the soft-break collapse
 *   - skip if a blank line already exists
 *   - don't touch frontmatter (between --- markers)
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const BLOG = 'src/content/blog';

// Lines that look like a "section label" — short standalone line that should
// stand on its own as a paragraph. Three forms:
//   [**something**]  — bracketed bold label  (TG-style)
//   **something**    — bold-only label
//   *something*      — italic-only label
const LABEL_RE = new RegExp(
	'^(' +
		// 1. bracketed (any content inside)
		'\\[.+\\]' +
		'|' +
		// 2. pure-bold standalone, ≤60 chars
		'\\*\\*[^*]{1,60}\\*\\*' +
		'|' +
		// 3. pure-italic standalone, ≤60 chars (avoid catching * lists by requiring no leading/trailing space)
		'\\*[^*\\s][^*]{0,58}[^*\\s]\\*' +
	')\\s*$',
);
// Lines that already produce their own block — no fix needed:
const STARTS_BLOCK = /^(#{1,6}\s|>{1,3}\s?|[-*+]\s|\d+\.\s|`{3,}|!\[|<details|\[!\[|\s*$)/;

let updatedFiles = 0;
let updatedSpots = 0;

const files = (await fs.readdir(BLOG)).filter((f) => f.endsWith('.md'));
for (const file of files) {
	const fp = path.join(BLOG, file);
	const txt = await fs.readFile(fp, 'utf8');
	const m = txt.match(/^---\n([\s\S]*?)\n---\n/);
	if (!m) continue;
	const head = txt.slice(0, m[0].length);
	const body = txt.slice(m[0].length);
	const lines = body.split('\n');
	const out = [];
	let touched = 0;

	for (let i = 0; i < lines.length; i++) {
		out.push(lines[i]);
		// Is this a label line?
		if (!LABEL_RE.test(lines[i])) continue;
		// Is there a next line and is it non-empty + doesn't start its own block?
		const next = lines[i + 1];
		if (next === undefined) continue;
		if (next.trim() === '') continue; // already a blank line — fine
		if (STARTS_BLOCK.test(next)) continue;
		// Insert blank line.
		out.push('');
		touched += 1;
	}

	if (touched > 0) {
		await fs.writeFile(fp, head + out.join('\n'));
		updatedFiles += 1;
		updatedSpots += touched;
		console.log(`  ${file}: +${touched} blank line(s)`);
	}
}

console.log(`\n✓ ${updatedFiles} files updated, ${updatedSpots} paragraph breaks added.`);
