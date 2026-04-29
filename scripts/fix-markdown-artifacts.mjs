#!/usr/bin/env node
/**
 * Audit and fix common markdown rendering artifacts across all blog posts.
 *
 * Usage:
 *   node scripts/fix-markdown-artifacts.mjs        # audit + apply fixes
 *   node scripts/fix-markdown-artifacts.mjs --dry  # audit only
 *
 * Issues handled:
 *   1. Backtick-dash pseudo-bullets:   `-` Foo   →   - Foo            (auto-fixed)
 *   2. Double-dash pseudo-hr lines:    --        →   ---              (auto-fixed)
 *   3. Orphan [label] lines (no link target):    [some text]          (audit only)
 *   4. Misc suspicious artifacts (backticked single chars, escaped
 *      leading hyphen `\-`, etc.)                                      (audit only)
 *
 * Constraints:
 *   - Idempotent: re-running on already-fixed file is a no-op.
 *   - Skips frontmatter (between the first two `---` lines).
 *   - Skips fenced code blocks (```...```).
 *   - Node 20+, ESM, stdlib only.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(REPO_ROOT, 'src/content/blog');

const DRY = process.argv.includes('--dry');

// --- Patterns -----------------------------------------------------------

// Issue 1: a literal backticked dash at the start of a line, possibly preceded
// by a `**Title**:` chunk on the same line. Captures both forms:
//   `-` Foo                  →  - Foo
//   **Title**`-` Foo         →  **Title**\n- Foo
const BACKTICK_DASH_LINE = /^`-`\s?/;
const BACKTICK_DASH_INLINE = /`-`\s?/;

// Issue 2: a line that is exactly `--` (no leading/trailing space).
const DOUBLE_DASH_LINE = /^--$/;

// Issue 3: a line whose entire content is `[...]` with no following `(...)`.
// We only flag when the line starts with `[` and ends with `]`, and the next
// non-whitespace char isn't `(` (i.e. not a markdown link).
const ORPHAN_LABEL = /^\[[^\]]+\]\s*$/;

// Issue 4 candidates: backticked single non-letter chars (`*`, `+`, `_`, `~`, `>`),
// escaped leading hyphen `\-`, and stray `\*` at line start.
const SUSPICIOUS_PATTERNS = [
	{ name: 'backticked single special char (`*`/`+`/`_`/`~`/`>`)', re: /`[*+_~>]`/ },
	{ name: 'escaped leading hyphen (\\-)', re: /^\\-/ },
	{ name: 'escaped leading asterisk (\\*)', re: /^\\\*/ },
];

// --- Helpers ------------------------------------------------------------

/**
 * Split text into [frontmatter, body] preserving frontmatter exactly.
 * If no frontmatter, frontmatter is empty string and body is the whole file.
 */
function splitFrontmatter(text) {
	const m = text.match(/^---\n[\s\S]*?\n---\n/);
	if (!m) return ['', text];
	return [text.slice(0, m[0].length), text.slice(m[0].length)];
}

/**
 * Walk body lines and produce a parallel boolean array marking which
 * lines are *inside* a fenced code block (so callers can skip them).
 * The fence lines themselves are also marked as in-fence.
 */
function markFencedLines(lines) {
	const inFence = new Array(lines.length).fill(false);
	let open = false;
	for (let i = 0; i < lines.length; i++) {
		if (/^```/.test(lines[i])) {
			inFence[i] = true;
			open = !open;
			continue;
		}
		if (open) inFence[i] = true;
	}
	return inFence;
}

// --- Audit / fix --------------------------------------------------------

/**
 * Audit a single file's body. Returns counts and locations.
 * Does NOT mutate.
 */
function auditBody(body, relPath) {
	const lines = body.split('\n');
	const inFence = markFencedLines(lines);

	let backtickDash = 0;
	let doubleDash = 0;
	const orphanLabels = []; // {line, text}
	const suspicious = []; // {line, text, kind}

	for (let i = 0; i < lines.length; i++) {
		if (inFence[i]) continue;
		const line = lines[i];

		// Issue 1
		if (BACKTICK_DASH_INLINE.test(line)) {
			// Count every occurrence on the line.
			const matches = line.match(/`-`/g);
			if (matches) backtickDash += matches.length;
		}

		// Issue 2: line is exactly `--` AND has a blank line before it
		// (or is at file start). That's the "pseudo-hr" shape — the line
		// after may be content (typical) or also blank.
		if (DOUBLE_DASH_LINE.test(line)) {
			const prev = i > 0 ? lines[i - 1] : '';
			if (prev.trim() === '') {
				doubleDash += 1;
			}
		}

		// Issue 3: orphan [label]
		if (ORPHAN_LABEL.test(line)) {
			orphanLabels.push({ line: i + 1, text: line });
		}

		// Issue 4: suspicious patterns
		for (const { name, re } of SUSPICIOUS_PATTERNS) {
			if (re.test(line)) {
				suspicious.push({ line: i + 1, text: line, kind: name });
			}
		}
	}

	return {
		path: relPath,
		backtickDash,
		doubleDash,
		orphanLabels,
		suspicious,
	};
}

/**
 * Apply fixes for issues 1 & 2 to a body string.
 * Returns { body, fixedBacktickDash, fixedDoubleDash } where body is the
 * transformed text. Idempotent.
 */
function applyFixes(body) {
	const lines = body.split('\n');
	const inFence = markFencedLines(lines);
	let fixedBacktickDash = 0;
	let fixedDoubleDash = 0;
	const out = [];

	for (let i = 0; i < lines.length; i++) {
		if (inFence[i]) {
			out.push(lines[i]);
			continue;
		}
		let line = lines[i];

		// Issue 1: replace `-` pseudo-bullets.
		if (BACKTICK_DASH_INLINE.test(line)) {
			// (a) `Title`...`-` rest  → if `-` appears mid-line preceded by non-empty
			//     text, split into two lines: the prefix, then "- rest".
			//     Specifically the pattern  **Title**`-` Foo
			//     becomes  **Title**\n- Foo
			// We do this only when there's at least one non-space char before `-`.
			// Loop because a single line could (theoretically) have several.
			const segments = [];
			let rest = line;
			while (true) {
				const idx = rest.search(BACKTICK_DASH_INLINE);
				if (idx === -1) break;
				const prefix = rest.slice(0, idx);
				const after = rest.slice(idx).replace(BACKTICK_DASH_INLINE, '');
				if (idx === 0) {
					// Line (or remaining segment) starts with `-`: just bullet form.
					segments.push('- ' + after.replace(/^\s+/, ''));
					rest = '';
					fixedBacktickDash += 1;
					break;
				} else {
					// Mid-line: emit the prefix as its own line, then continue with
					// the "- ..." part as the next line to process.
					segments.push(prefix.replace(/\s+$/, ''));
					rest = '- ' + after.replace(/^\s+/, '');
					fixedBacktickDash += 1;
				}
			}
			if (rest !== '') segments.push(rest);
			for (const s of segments) out.push(s);
			continue;
		}

		// Issue 2: `--` line with blank before → `---`.
		if (DOUBLE_DASH_LINE.test(line)) {
			const prev = i > 0 ? lines[i - 1] : '';
			if (prev.trim() === '') {
				out.push('---');
				fixedDoubleDash += 1;
				continue;
			}
		}

		out.push(line);
	}

	return {
		body: out.join('\n'),
		fixedBacktickDash,
		fixedDoubleDash,
	};
}

// --- Main ---------------------------------------------------------------

const files = (await fs.readdir(BLOG_DIR))
	.filter((f) => f.endsWith('.md'))
	.sort();

const audits = [];
for (const file of files) {
	const fp = path.join(BLOG_DIR, file);
	const text = await fs.readFile(fp, 'utf8');
	const [, body] = splitFrontmatter(text);
	const rel = path.relative(REPO_ROOT, fp);
	audits.push(auditBody(body, rel));
}

// --- Print audit --------------------------------------------------------

function printSection(title, rows) {
	console.log(`\n=== ${title} ===`);
	if (rows.length === 0) {
		console.log('  (none)');
		return;
	}
	console.log(`Found in ${rows.length} files:`);
	for (const r of rows) console.log(`  ${r}`);
}

const issue1 = audits
	.filter((a) => a.backtickDash > 0)
	.map((a) => `${a.path} (${a.backtickDash} occurrence${a.backtickDash === 1 ? '' : 's'})`);

const issue2 = audits
	.filter((a) => a.doubleDash > 0)
	.map((a) => `${a.path} (${a.doubleDash} occurrence${a.doubleDash === 1 ? '' : 's'})`);

printSection('Issue 1: Backtick-dash bullets', issue1);
printSection('Issue 2: Double-dash hr', issue2);

// Issue 3 & 4 are listed verbosely per-line.
console.log('\n=== Issue 3: Orphan [label] lines (audit only — review manually) ===');
let issue3Total = 0;
for (const a of audits) {
	if (a.orphanLabels.length === 0) continue;
	console.log(`  ${a.path}:`);
	for (const o of a.orphanLabels) {
		console.log(`    L${o.line}: ${o.text}`);
		issue3Total += 1;
	}
}
if (issue3Total === 0) console.log('  (none)');

console.log('\n=== Issue 4: Other suspicious artifacts (audit only) ===');
let issue4Total = 0;
for (const a of audits) {
	if (a.suspicious.length === 0) continue;
	console.log(`  ${a.path}:`);
	for (const s of a.suspicious) {
		console.log(`    L${s.line} [${s.kind}]: ${s.text}`);
		issue4Total += 1;
	}
}
if (issue4Total === 0) console.log('  (none)');

// --- Apply fixes (unless --dry) -----------------------------------------

if (DRY) {
	console.log('\n--dry: no changes written.');
	process.exit(0);
}

let changedFiles = 0;
let totalBacktickDashFixes = 0;
let totalDoubleDashFixes = 0;
const changedList = [];

for (const file of files) {
	const fp = path.join(BLOG_DIR, file);
	const text = await fs.readFile(fp, 'utf8');
	const [head, body] = splitFrontmatter(text);
	const { body: newBody, fixedBacktickDash, fixedDoubleDash } = applyFixes(body);
	if (fixedBacktickDash === 0 && fixedDoubleDash === 0) continue;
	if (newBody === body) continue;
	await fs.writeFile(fp, head + newBody);
	changedFiles += 1;
	totalBacktickDashFixes += fixedBacktickDash;
	totalDoubleDashFixes += fixedDoubleDash;
	changedList.push({
		path: path.relative(REPO_ROOT, fp),
		backtick: fixedBacktickDash,
		dhr: fixedDoubleDash,
	});
}

console.log(`\nFixed ${changedFiles} files`);
console.log(`  backtick-dash bullets fixed: ${totalBacktickDashFixes}`);
console.log(`  double-dash hr fixed:        ${totalDoubleDashFixes}`);
for (const c of changedList) {
	console.log(`  - ${c.path}  (\`-\` x${c.backtick}, -- x${c.dhr})`);
}
