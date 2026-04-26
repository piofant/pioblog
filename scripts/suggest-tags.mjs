#!/usr/bin/env node
// Tag suggestion CLI — analyzes a post and recommends 3-7 tags from existing inventory.
// Usage:
//   node scripts/suggest-tags.mjs <path-to-md-file> [--apply] [--json]

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(REPO_ROOT, 'src/content/blog');

// ============================================================
// Tag inventory + signals
// ============================================================

// Canonical inventory (from migrate-tags.mjs review)
const TAG_INVENTORY = [
  'школа жизни', 'продакт', 'жизнь', 'карьера', 'рефлексия', 'трипы', 'нетворкинг',
  'психология', 'безумие', 'анонс', 'истории', 'творчество', 'вуз', 'театр', 'боты',
  'летняя школа', 'ии', 'контактная импровизация', 'танцы', 'автостоп',
  'мужские круги', 'менторство', 'клоунада', 'whois', 'рекомендации', 'випассана',
  'медитация',
];

// Slug-pattern rules (high confidence) — reuses migrate-tags.mjs ideas
const PATTERN_RULES = [
  { match: /avtostop/, tags: ['автостоп'], label: 'avtostop' },
  { match: /vipassan/, tags: ['випассана', 'медитация'], label: 'vipassan' },
  { match: /kontaktnoi-improvizatsii|kontaktnaia-improvizatsiia|kontaktnuiu/, tags: ['контактная импровизация'], label: 'kontaktnaia-improvizatsiia' },
  { match: /muzhsk(ikh|ie)-krug/, tags: ['мужские круги'], label: 'muzhskie-krugi' },
  { match: /klounad|klounsk/, tags: ['клоунада'], label: 'klounada' },
  { match: /letn(iuiu|ei)-shkol|summer-dream-school|zimniuiu-shkolu/, tags: ['летняя школа'], label: 'letniaia-shkola' },
  { match: /mentora|mentoring|kouchingovuiu|menti/, tags: ['менторство'], label: 'mentoring' },
  { match: /netvorking/, tags: ['нетворкинг'], label: 'netvorking' },
  { match: /prodakt|product/, tags: ['продакт'], label: 'prodakt' },
  { match: /refleks/, tags: ['рефлексия'], label: 'refleksiia' },
  { match: /shkol[a-z]*-zhizn/, tags: ['школа жизни'], label: 'shkola-zhizni' },
  { match: /vuz|universitet|fizmat/, tags: ['вуз'], label: 'vuz' },
  { match: /teatr|teatra/, tags: ['театр'], label: 'teatr' },
  { match: /tantsev|tantsy|bachata/, tags: ['танцы'], label: 'tantsy' },
  { match: /trip-|tripy|trip$/, tags: ['трипы'], label: 'trip' },
  { match: /anons/, tags: ['анонс'], label: 'anons' },
  { match: /whois|davaite-znakomitsia/, tags: ['whois'], label: 'whois' },
  { match: /\bbot[a-z]*\b|telegram-bot/, tags: ['боты'], label: 'boty' },
  { match: /meditats/, tags: ['медитация'], label: 'meditatsiia' },
];

// Keyword signals (medium confidence) — body lowercase substring matches
// Стеммированные основы: ловит словоформы (ловит -> ловит, ловить, ловлю и т.д.)
const KEYWORD_SIGNALS = {
  'продакт': ['продакт', 'product', 'pm ', 'фича', 'юзер', 'продукт', 'кейс-клуб', 'кастдев', 'cjm', 'дискавер'],
  'карьера': ['карьер', 'работ', 'офер', 'собес', 'найм', 'позиц', 'компани', 'миддл', 'сеньор', 'джун', 'резюме'],
  'трипы': ['поездк', 'путешеств', 'трип', 'отпуск', 'дорог', 'приключен'],
  'нетворкинг': ['знаком', 'нетворк', 'тус', 'комьюнити', 'сообществ', 'вечеринк', 'рандом-кофе', 'random-coffee'],
  'психология': ['психолог', 'терапи', 'эмоци', 'чувств', 'тревог', 'трав', 'самооценк', 'привязанн'],
  'безумие': ['безуми', 'неожиданн', 'странн', 'абсурд', 'крыш', 'дич'],
  'рефлексия': ['рефлекси', 'осозна', 'понимани', 'выводы', 'размышл', 'мысли', 'почему'],
  'жизнь': ['жизн', 'будн', 'повседн', 'обычн день'],
  'школа жизни': ['школ', 'учител', 'класс', 'одноклассн', 'физмат'],
  'истории': ['истори', 'случил', 'было это'],
  'творчество': ['творчеств', 'рисов', 'писа', 'стих', 'песн', 'арт', 'график'],
  'вуз': ['универ', 'вуз', 'студент', 'итмо', 'факультет', 'диплом', 'сесси'],
  'театр': ['театр', 'спектакл', 'актер', 'актёр', 'сцен'],
  'боты': ['телеграм-бот', 'бота', 'бот ', 'чат-бот', 'chatbot'],
  'летняя школа': ['летн', 'летняя школа', 'дедлайн', 'заявк'],
  'ии': [' ии ', 'нейросет', 'gpt', 'chatgpt', 'llm', 'клод', 'claude', 'ai ', ' ai,', ' ai.'],
  'контактная импровизация': ['контактн', 'импровизац', 'ки '],
  'танцы': ['танц', 'бачат', 'милонг'],
  'автостоп': ['автостоп', 'попутк', 'трасс', 'фур'],
  'мужские круги': ['мужск', 'мужчин', 'круг'],
  'менторство': ['менторств', 'ментор', 'коучин', 'менти', 'наставн'],
  'клоунада': ['клоунад', 'клоун', 'нос красн'],
  'whois': ['кто я', 'обо мне', 'знакомств'],
  'рекомендации': ['рекоменд', 'советую', 'почитай'],
  'випассана': ['випассан', 'vipassana', '10 дней', 'медитат'],
  'медитация': ['медитац', 'медитир', 'медитат'],
  'анонс': ['анонс', 'приходите', 'приглаша', 'регистрац', 'завтра ', 'уже завтра', 'эфир'],
};

// Co-occurrence map: if tag X is suggested by kw, often co-occurs with Y in inventory
const COOC = {
  'трипы': ['нетворкинг', 'школа жизни'],
  'летняя школа': ['нетворкинг', 'трипы'],
  'продакт': ['карьера'],
  'менторство': ['продакт', 'карьера'],
  'випассана': ['медитация', 'психология'],
  'мужские круги': ['психология', 'рефлексия'],
  'автостоп': ['трипы'],
  'школа жизни': ['рефлексия', 'истории'],
  'клоунада': ['театр'],
  'контактная импровизация': ['танцы'],
  'нетворкинг': ['анонс'],
};

// Weights
const W_SLUG = 10;
const W_KEYWORD = 1.0;
const W_COOC = 0.4;
const KW_CAP = 4; // max kw frequency contribution per tag

// ============================================================
// Frontmatter helpers (compatible with migrate-tags.mjs)
// ============================================================

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const [, yaml, body] = m;
  return { yaml, body };
}

function parseTags(yaml) {
  const m = yaml.match(/^tags:\s*\[([^\]]*)\]/m);
  if (!m) return null;
  const inner = m[1].trim();
  if (!inner) return [];
  return inner.split(',').map((t) => t.trim().replace(/^['"]|['"]$/g, ''));
}

function parseTitle(yaml) {
  const m = yaml.match(/^title:\s*['"]?(.*?)['"]?\s*$/m);
  return m ? m[1].replace(/^['"]|['"]$/g, '') : '(no title)';
}

function setTags(yaml, tags) {
  const tagsLine = tags.length === 0
    ? 'tags: []'
    : `tags: [${tags.map((t) => `'${t}'`).join(', ')}]`;
  if (yaml.match(/^tags:/m)) {
    return yaml.replace(/^tags:.*$/m, tagsLine);
  }
  return yaml.replace(/^(pubDate:.*)$/m, `$1\n${tagsLine}`);
}

// ============================================================
// Scoring
// ============================================================

function scoreTags(slug, body, title) {
  const scores = new Map(); // tag -> { score, reasons: [] }
  const ensure = (tag) => {
    if (!scores.has(tag)) scores.set(tag, { score: 0, reasons: [] });
    return scores.get(tag);
  };

  // 1) Slug pattern matches (high confidence)
  for (const rule of PATTERN_RULES) {
    if (rule.match.test(slug)) {
      for (const t of rule.tags) {
        if (!TAG_INVENTORY.includes(t)) continue;
        const e = ensure(t);
        e.score += W_SLUG;
        e.reasons.push({ kind: 'slug', detail: rule.label });
      }
    }
  }

  // 2) Keyword frequency in body + title (medium)
  const haystack = (title + '\n' + body).toLowerCase();
  for (const [tag, kws] of Object.entries(KEYWORD_SIGNALS)) {
    if (!TAG_INVENTORY.includes(tag)) continue;
    const hits = [];
    for (const kw of kws) {
      const re = new RegExp(escapeRegex(kw.toLowerCase()), 'g');
      const matches = haystack.match(re);
      if (matches && matches.length > 0) {
        hits.push({ kw, count: matches.length });
      }
    }
    if (hits.length === 0) continue;
    const totalCount = hits.reduce((a, h) => a + h.count, 0);
    const distinct = hits.length;
    // Normalized contribution: distinct keywords matter more than raw counts
    const contrib = Math.min(KW_CAP, distinct + Math.log2(1 + totalCount));
    const e = ensure(tag);
    e.score += W_KEYWORD * contrib;
    const top = hits.sort((a, b) => b.count - a.count).slice(0, 3).map((h) => h.kw.trim());
    e.reasons.push({ kind: 'kw', detail: top.join(', ') });
  }

  // 3) Co-occurrence — pull in friends of strong tags (low)
  // Snapshot current strong tags before adding cooc effects
  const strongNow = [...scores.entries()]
    .filter(([, v]) => v.score >= W_SLUG || v.score >= 1.5 * W_KEYWORD)
    .map(([k]) => k);

  for (const t of strongNow) {
    for (const friend of COOC[t] || []) {
      if (!TAG_INVENTORY.includes(friend)) continue;
      const e = ensure(friend);
      e.score += W_COOC;
      e.reasons.push({ kind: 'cooc', detail: `with ${t}` });
    }
  }

  return scores;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rankSuggestions(scores, { min = 3, max = 7, threshold = 1.0 } = {}) {
  const arr = [...scores.entries()]
    .map(([tag, v]) => ({ tag, ...v }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // Take all over threshold, but at least `min` and at most `max`
  let picked = arr.filter((s) => s.score >= threshold);
  if (picked.length < min) picked = arr.slice(0, min);
  if (picked.length > max) picked = picked.slice(0, max);
  return picked;
}

function tier(score) {
  if (score >= W_SLUG) return 'slug';
  if (score >= 1.5) return 'kw';
  return 'cooc';
}

function bullet(s) {
  switch (tier(s.score)) {
    case 'slug': return '⭐';
    case 'kw': return '✓';
    default: return '·';
  }
}

function reasonLabel(s) {
  // Prefer the strongest reason
  const slug = s.reasons.find((r) => r.kind === 'slug');
  if (slug) return `slug-match: ${slug.detail}`;
  const kw = s.reasons.find((r) => r.kind === 'kw');
  if (kw) return `kw: ${kw.detail}`;
  const cooc = s.reasons.find((r) => r.kind === 'cooc');
  if (cooc) return `cooc ${cooc.detail}`;
  return '';
}

// ============================================================
// CLI
// ============================================================

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { apply: false, json: false };
  const positional = [];
  for (const a of args) {
    if (a === '--apply') flags.apply = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else positional.push(a);
  }
  return { flags, positional };
}

function usage() {
  return `Usage: node scripts/suggest-tags.mjs <path-to-md-file> [--apply] [--json]

Suggests 3-7 tags from inventory based on slug patterns + body keywords + co-occurrence.

Options:
  --apply   Rewrite frontmatter with suggested tags (interactive confirm)
  --json    Output JSON (for scripting)
  -h        Show this help`;
}

async function confirm(question) {
  const rl = readline.createInterface({ input, output });
  const ans = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return ans === 'y' || ans === 'yes';
}

function diffTags(current, suggested) {
  const cur = new Set(current);
  const sug = new Set(suggested);
  const add = [...sug].filter((t) => !cur.has(t));
  const remove = [...cur].filter((t) => !sug.has(t));
  return { add, remove };
}

async function main() {
  const { flags, positional } = parseArgs(process.argv);
  if (flags.help || positional.length === 0) {
    console.log(usage());
    process.exit(positional.length === 0 ? 1 : 0);
  }

  const fileArg = positional[0];
  const fullPath = path.isAbsolute(fileArg) ? fileArg : path.resolve(process.cwd(), fileArg);

  // Validation
  if (!fullPath.endsWith('.md')) {
    fail(`Not a markdown file: ${fileArg}`, flags.json);
  }
  let stat;
  try {
    stat = await fs.stat(fullPath);
  } catch {
    fail(`File not found: ${fullPath}`, flags.json);
  }
  if (!stat.isFile()) {
    fail(`Not a regular file: ${fullPath}`, flags.json);
  }

  const content = await fs.readFile(fullPath, 'utf8');
  const fm = parseFrontmatter(content);
  if (!fm) {
    fail(`No frontmatter found in: ${fullPath}`, flags.json);
  }

  const slug = path.basename(fullPath, '.md');
  const title = parseTitle(fm.yaml);
  const currentTags = parseTags(fm.yaml) || [];
  const body = fm.body || '';

  const scores = scoreTags(slug, body, title);
  const suggestions = rankSuggestions(scores);
  const suggestedTags = suggestions.map((s) => s.tag);

  const diff = diffTags(currentTags, suggestedTags);

  if (flags.json) {
    const payload = {
      file: fullPath,
      slug,
      title,
      currentTags,
      suggestions: suggestions.map((s) => ({
        tag: s.tag,
        score: round(s.score),
        tier: tier(s.score),
        reasons: s.reasons,
      })),
      suggestedTags,
      diff,
      hasBody: body.trim().length > 0,
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  // Pretty output
  const relPath = path.relative(process.cwd(), fullPath) || fullPath;
  console.log(`📝 ./${relPath}`);
  console.log(`"${title}"`);
  if (!body.trim()) {
    console.log(`\n(no body — slug-match only)`);
  }
  console.log(`\nПредложенные теги (по убыванию релевантности):`);
  if (suggestions.length === 0) {
    console.log(`   (нет сигналов — попробуй проверить slug или ключевые слова в тексте)`);
  } else {
    const padLen = Math.max(...suggestions.map((s) => [...s.tag].length));
    for (const s of suggestions) {
      const pad = ' '.repeat(Math.max(0, padLen - [...s.tag].length));
      console.log(`  ${bullet(s)} ${s.tag}${pad}  (${reasonLabel(s)})  [score: ${round(s.score)}]`);
    }
  }

  console.log(`\nТекущие теги: [${currentTags.join(', ')}]`);
  if (diff.add.length === 0 && diff.remove.length === 0) {
    console.log(`Diff: (без изменений)`);
  } else {
    const parts = [];
    for (const t of diff.add) parts.push(`+${t}`);
    for (const t of diff.remove) parts.push(`-${t}`);
    console.log(`Diff: ${parts.join(' ')}`);
  }

  if (flags.apply) {
    if (suggestedTags.length === 0) {
      console.log(`\n⚠️  Нет тегов для применения, пропуск.`);
      return;
    }
    console.log('');
    const ok = await confirm(`Перезаписать frontmatter тегами [${suggestedTags.join(', ')}]?`);
    if (!ok) {
      console.log('Отменено.');
      return;
    }
    const newYaml = setTags(fm.yaml, suggestedTags);
    const newContent = `---\n${newYaml}\n---\n${fm.body}`;
    await fs.writeFile(fullPath, newContent);
    console.log(`✅ Записано: ${fullPath}`);
  }
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function fail(msg, asJson = false) {
  if (asJson) {
    console.log(JSON.stringify({ error: msg }));
  } else {
    console.error(`💥 ${msg}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('💥 Fatal:', err.message);
  process.exit(1);
});
