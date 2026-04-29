#!/usr/bin/env node
/**
 * dedupe-hero-from-body.mjs
 *
 * Removes a duplicate hero-image reference from the body of each blog post,
 * if (and only if) the FIRST `![alt](path)` in the body refers to exactly the
 * same path as the post's frontmatter `heroImage`.
 *
 * Soon BlogPost.astro will render `heroImage` as a top banner, so the inline
 * duplicate would cause a double-display.
 *
 * Rules:
 *   - skip posts whose heroImage starts with `/img/og/gradients/` (auto-generated)
 *   - only remove the FIRST inline image, and only if its path matches heroImage
 *   - never touch fenced code blocks (``` ... ```)
 *   - never touch frontmatter
 *   - if removing the image leaves a doubled blank line, collapse it to one
 *   - idempotent: re-runs are no-ops
 *
 * Usage:
 *   node scripts/dedupe-hero-from-body.mjs           # apply
 *   node scripts/dedupe-hero-from-body.mjs --dry     # audit only
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BLOG_DIR = join(__dirname, '..', 'src', 'content', 'blog');

const DRY = process.argv.includes('--dry');

// Match `heroImage: '...'` (single-quoted YAML string) on its own frontmatter line.
const HERO_RE = /^heroImage:\s*'([^']+)'\s*$/m;

// Match a markdown image line: `![alt](path)` or `![alt](path "title")`,
// possibly with surrounding spaces. We only consider full-line images.
// The capture group is the inner contents of `(...)`; we extract the URL
// portion separately (anything before the first whitespace).
const IMG_LINE_RE = /^\s*!\[[^\]]*\]\(([^)]+)\)\s*$/;

function extractUrl(inner) {
  // Markdown allows `(url "title")` or `(url 'title')`. Take everything up
  // to the first whitespace as the URL.
  const m = inner.match(/^\s*(\S+)/);
  return m ? m[1] : inner;
}

function splitFrontmatter(text) {
  // Posts start with `---\n...\n---\n`.
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) return null;
  const fm = text.slice(0, end + 5); // includes trailing `\n---\n`
  const body = text.slice(end + 5);
  return { fm, body };
}

/**
 * Walk body lines, tracking fenced code blocks. Return the index of the first
 * `![alt](path)` line that lives OUTSIDE a fenced code block, plus its parsed
 * path. Returns `{ index: -1 }` if none found.
 */
function findFirstImageLine(lines) {
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Toggle on lines starting with ``` (allow leading spaces to be safe).
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(IMG_LINE_RE);
    if (m) return { index: i, path: extractUrl(m[1]) };
  }
  return { index: -1 };
}

function processFile(filepath) {
  const original = readFileSync(filepath, 'utf8');
  const split = splitFrontmatter(original);
  if (!split) return { changed: false, reason: 'no-frontmatter' };

  const heroMatch = split.fm.match(HERO_RE);
  if (!heroMatch) return { changed: false, reason: 'no-hero' };
  const hero = heroMatch[1];

  if (hero.startsWith('/img/og/gradients/')) {
    return { changed: false, reason: 'gradient' };
  }

  // Split body into lines, preserving final newline behaviour.
  // Using a raw split keeps things simple — we'll rejoin with '\n'.
  const trailingNewline = split.body.endsWith('\n');
  const bodyText = trailingNewline ? split.body.slice(0, -1) : split.body;
  const lines = bodyText.split('\n');

  const found = findFirstImageLine(lines);
  if (found.index === -1) return { changed: false, reason: 'no-image' };
  if (found.path !== hero) return { changed: false, reason: 'first-image-differs' };

  // Remove the line at found.index.
  const i = found.index;
  lines.splice(i, 1);

  // If removing the image left two consecutive blank lines (i.e. the line
  // before AND the line at the now-shifted i are both blank), drop one.
  // Also handle the case where the image was at the very top (i=0) and now
  // the body starts with a blank line — strip that single leading blank.
  const isBlank = (s) => s !== undefined && s.trim() === '';
  if (i > 0 && isBlank(lines[i - 1]) && isBlank(lines[i])) {
    lines.splice(i, 1);
  } else if (i === 0 && isBlank(lines[0])) {
    lines.splice(0, 1);
  }

  let newBody = lines.join('\n');
  if (trailingNewline) newBody += '\n';

  if (newBody === split.body) return { changed: false, reason: 'noop' };

  const newText = split.fm + newBody;

  if (!DRY) {
    writeFileSync(filepath, newText, 'utf8');
  }

  return { changed: true, hero };
}

function main() {
  const files = readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const changed = [];
  let skipGradient = 0;
  let skipNoHero = 0;
  let skipNoImage = 0;
  let skipDiffers = 0;

  for (const f of files) {
    const filepath = join(BLOG_DIR, f);
    const res = processFile(filepath);
    if (res.changed) {
      changed.push({ file: f, hero: res.hero });
    } else {
      if (res.reason === 'gradient') skipGradient++;
      else if (res.reason === 'no-hero') skipNoHero++;
      else if (res.reason === 'no-image') skipNoImage++;
      else if (res.reason === 'first-image-differs') skipDiffers++;
    }
  }

  const verb = DRY ? 'WOULD CHANGE' : 'CHANGED';
  console.log(`\n${verb}: ${changed.length} file(s)\n`);
  for (const { file, hero } of changed) {
    console.log(`  ${file}`);
    console.log(`    - removed: ${hero}`);
  }

  console.log(`\nSummary:`);
  console.log(`  total posts:                ${files.length}`);
  console.log(`  changed:                    ${changed.length}${DRY ? ' (dry-run)' : ''}`);
  console.log(`  skipped (gradient hero):    ${skipGradient}`);
  console.log(`  skipped (no hero):          ${skipNoHero}`);
  console.log(`  skipped (no inline image):  ${skipNoImage}`);
  console.log(`  skipped (first img != hero):${skipDiffers}`);
}

main();
