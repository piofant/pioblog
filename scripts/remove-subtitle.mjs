#!/usr/bin/env node
// Removes the `subtitle:` field from frontmatter of every post in
// src/content/blog/*.md. Idempotent: re-runs report 0.
//
// Usage:
//   node scripts/remove-subtitle.mjs           # apply in-place
//   node scripts/remove-subtitle.mjs --dry     # audit only

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = join(__dirname, '..', 'src', 'content', 'blog');

const DRY = process.argv.includes('--dry');

/**
 * Strip the `subtitle:` field from a frontmatter block.
 * Returns { content, changed }.
 *
 * Handles single-line YAML (only form present in this repo). Also tolerates
 * multi-line YAML scalars (folded `>` / literal `|` blocks, or continuation
 * lines indented deeper than the key) by consuming subsequent lines that
 * belong to the subtitle value.
 */
function stripSubtitle(raw) {
	const m = raw.match(/^(---\n)([\s\S]*?)(\n---(?:\n|$))([\s\S]*)$/);
	if (!m) return { content: raw, changed: false };

	const [, open, fmText, close, body] = m;
	const lines = fmText.split('\n');
	const out = [];
	let changed = false;
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (/^subtitle\s*:/.test(line)) {
			changed = true;
			i++;
			// Consume continuation lines (indented deeper than 0 = top-level key).
			// Top-level YAML keys at column 0 match /^[A-Za-z0-9_-]+\s*:/.
			while (i < lines.length) {
				const next = lines[i];
				if (next === '' || /^\s+\S/.test(next)) {
					i++;
					continue;
				}
				break;
			}
			continue;
		}
		out.push(line);
		i++;
	}

	if (!changed) return { content: raw, changed: false };
	return { content: open + out.join('\n') + close + body, changed: true };
}

async function main() {
	const entries = await readdir(BLOG_DIR);
	const files = entries.filter((f) => f.endsWith('.md'));
	let changedCount = 0;
	const changedFiles = [];

	for (const f of files) {
		const path = join(BLOG_DIR, f);
		const raw = await readFile(path, 'utf8');
		const { content, changed } = stripSubtitle(raw);
		if (changed) {
			changedCount++;
			changedFiles.push(f);
			if (!DRY) await writeFile(path, content, 'utf8');
		}
	}

	if (DRY) {
		console.log(`[dry] would change ${changedCount} of ${files.length} files`);
		for (const f of changedFiles) console.log(`  ${f}`);
	} else {
		console.log(`changed ${changedCount} of ${files.length} files`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
