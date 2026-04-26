#!/usr/bin/env node
// Tag migration script — based on consolidated review of all 162 posts.
// Run: node scripts/migrate-tags.mjs [--dry-run]

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(REPO_ROOT, 'src/content/blog');
const DRY = process.argv.includes('--dry-run');

// ============================================================
// Transformation rules
// ============================================================

// Глобальные мерджи: старый тег → новый
const TAG_MERGES = {
  'история': 'истории',
  'жизнипост': 'жизнь',
  'по_жизни': 'жизнь',
  'intro': 'whois',
  'мысли': 'рефлексия',
};

// Удалить полностью (не заменяя)
const TAG_DELETE = new Set([
  'я_не_умру_с_голоду',
  'мнения',
]);

// Per-post specific fixes (точечные правки из ревью)
// Формат: { id: { remove: [...], add: [...] } }
const PER_POST_FIXES = {
  'chem-menia-tak-zatsepila-eta-ideia-postupleniia-na-419': { remove: ['ии'], add: ['рефлексия'] },
  'sns-birthday-tusa-v-moskve-7-go-iiunia-299': { remove: ['ии'], add: ['анонс'] },
  'I-can-not-relax-or-rest': { remove: ['танцы'], add: ['рефлексия', 'школа жизни'] },
  'i-can-not-relax-or-rest': { remove: ['танцы'], add: ['рефлексия', 'школа жизни'] },
  'moe-pervoe-polugodie-10-klassa-chto-ia-ponial-23': { remove: ['танцы'], add: ['вуз'] },
  'chat-privet-353': { remove: ['танцы'] },
  'u-menia-est-liubimyi-stolb-v-tsentre-pitera-363': { remove: ['танцы'] },
  'vozmozhnost-uvidet-blogera-vzhivuiu-v-pitere-408': { remove: ['танцы', 'трипы'], add: ['автостоп'] },
  'eto-samoe-produkt-kemp-leto-2023-129': { remove: ['танцы'] },
  'vov-otkuda-u-tebia-stolko-podpischikov-v-pioblog-281': { remove: ['боты'] },
};

// Pattern-based new tag rules (slug regex → теги для добавления)
const PATTERN_RULES = [
  { match: /avtostop/, addTags: ['автостоп'] },
  { match: /vipassan/, addTags: ['випассана', 'медитация'] },
  { match: /kontaktnoi-improvizatsii|kontaktnaia-improvizatsiia/, addTags: ['контактная импровизация'] },
  { match: /muzhsk(ikh|ie)-krug/, addTags: ['мужские круги'] },
  { match: /klounad|klounsk/, addTags: ['клоунада'] },
  { match: /letn(iuiu|ei|ei)-shkol/, addTags: ['летняя школа'] },
  { match: /summer-dream-school/, addTags: ['летняя школа'] },
  { match: /mentora|mentoring|kouchingovuiu/, addTags: ['менторство'] },
];

// Контент-based new tag rules (если в body встречается X — добавить тег)
// Применяется к постам где slug-pattern не сработал, но контент явно про тему
const CONTENT_RULES = [
  { id: 'ia-sbezhal-s-vipassany-ot-sebia-na-4-i-den-284', tags: ['випассана', 'медитация', 'психология', 'рефлексия'] },
  { id: 'trip-v-sebia-283', tags: ['випассана', 'медитация'] },
  { id: 'znakomtes-iura-moi-partner-po-avtostopu-326', tags: ['автостоп'] },
  { id: 'lektsiia-pro-moi-pervyi-opyt-avtostopa-s-329', tags: ['автостоп'] },
  { id: 'moi-pervyi-opyt-avtostopa-proverka-na-prochnost-i-307', tags: ['автостоп'] },
  { id: 'puteshestviia-v-rezhime-nabliudatelia-chast-2-375', tags: ['автостоп'] },
  { id: 'ia-skhodil-na-5-muzhskikh-krugov-i-pochuvstvoval-276', tags: ['мужские круги'] },
  { id: 'muzhskie-krugi-stali-chastiu-moei-zhizni-i-vot-333', tags: ['мужские круги'] },
  { id: 'ia-nashel-metriku-vnutrennei-opory-371', tags: ['мужские круги'] },
  { id: 'bezuslovnoe-priniatie-387', tags: ['мужские круги', 'контактная импровизация'] },
  { id: 'moi-put-k-kontaktnoi-improvizatsii-380', tags: ['контактная импровизация', 'клоунада', 'летняя школа'] },
  { id: 'znaete-v-chem-prikol-tantsevat-kontaktnuiu-409', tags: ['контактная импровизация'] },
  { id: 'trip-na-bessonnitsu-telesnye-praktiki-poliamory-i-319', tags: ['контактная импровизация'] },
  { id: 'ia-vse-eshche-ne-pridumal-kuda-poekhat-na-novyi-385', tags: ['контактная импровизация'] },
  { id: 'ishchu-analogichnyi-stolb-proiavlennosti-v-raione-379', tags: ['контактная импровизация'] },
  { id: 'trip-na-zimniuiu-shkolu-po-klounade-263', tags: ['клоунада', 'летняя школа', 'театр'] },
  { id: 'klounskii-nos-obediniaet-411', tags: ['клоунада'] },
  { id: 'privet-ia-seichas-na-letnei-shkole-v-tripe-v-moi-168', tags: ['летняя школа'] },
  { id: '2-dnia-do-dedlaina-podachi-zaiavki-na-letniuiu-127', tags: ['летняя школа'] },
  { id: 'go-na-letniuiu-shkolu-ostalas-nedelia-do-dedlaina-106', tags: ['летняя школа'] },
  { id: 'uporstvo-ne-srabotalo-5-redzhektov-na-letniuiu-340', tags: ['летняя школа'] },
  { id: '6-dnei-s-randomami-v-lesu-ili-zhizn-v-313', tags: ['летняя школа'] },
  { id: 'provel-pervuiu-kinda-kouchingovuiu-sessiiu-delius-369', tags: ['менторство'] },
  { id: 'vse-nachinaetsia-s-mentora-140', tags: ['менторство'] },
  { id: 'rezultaty-moikh-menti-chast-1-ot-direktora-261', tags: ['менторство'] },
  { id: 'zareshat-keis-i-otobratsia-na-dzhuna-prodakta-v-293', tags: ['менторство'] },
];

// Посты без тегов — добавить базовый набор по slug-паттерну
const ZAPIS_DEFAULT_TAGS = ['жизнь'];
const NO_TAGS_FIXES = {
  // explicit добавки для постов с пустыми тегами (из ревью)
  'iskat-liubov-u-shkolnykh-uchitelei-kazhetsia-73': ['рефлексия', 'школа жизни'],
  'k-zavtrashnemu-postu-141': ['анонс'],
  'kazhetsia-chto-khot-kaplia-samostoiatelnoi-22': ['рефлексия'],
  'my-v-zume-prisoediniaites-po-ssylke-246': ['анонс', 'нетворкинг'],
  'part-2-otnoshenie-k-obrazovatelnym-kursam-25': ['школа жизни', 'рефлексия'],
  'importnul-neskolko-starykh-telegram-kanalov-s-89': ['боты', 'безумие'],
  'real-plot-sqrt-cos-x-cos-200x-sqrt-abs-x-pi-4-4-x-13': ['безумие', 'творчество'],
  'riadom-s-kompami-stoiat-servaki-vot-eto-da-51': ['вуз'],
  'dve-takie-kazhetsia-ochevidnye-tsitaty-zakhotelos-20': ['рефлексия'],
  'tg-147': ['продакт', 'карьера', 'нетворкинг'],
  'vyiasnitsia-chto-uchitelnitsa-to-byla-nuzhna-ne-74': ['жизнь', 'истории'],
  'chat-napishite-v-kommentakh-kak-i-gde-vy-so-mnoi-413': ['анонс', 'нетворкинг'],
};

// ============================================================
// Frontmatter parsing
// ============================================================

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const [, yaml, body] = m;
  return { yaml, body };
}

function parseTags(yaml) {
  // tags: ['x', 'y'] OR tags: [] OR tags: undefined
  const m = yaml.match(/^tags:\s*\[([^\]]*)\]/m);
  if (!m) return null;
  const inner = m[1].trim();
  if (!inner) return [];
  return inner.split(',').map((t) => t.trim().replace(/^['"]|['"]$/g, ''));
}

function setTags(yaml, tags) {
  const tagsLine = tags.length === 0
    ? 'tags: []'
    : `tags: [${tags.map((t) => `'${t}'`).join(', ')}]`;
  if (yaml.match(/^tags:/m)) {
    return yaml.replace(/^tags:.*$/m, tagsLine);
  }
  // Add tags after pubDate
  return yaml.replace(/^(pubDate:.*)$/m, `$1\n${tagsLine}`);
}

// ============================================================
// Transformation pipeline
// ============================================================

function transformTags(originalTags, slug, body) {
  let tags = [...originalTags];

  // 1. Merges
  tags = tags.map((t) => TAG_MERGES[t] || t);

  // 2. Deletions
  tags = tags.filter((t) => !TAG_DELETE.has(t));

  // 3. Per-post specific fixes
  const fix = PER_POST_FIXES[slug];
  if (fix) {
    if (fix.remove) tags = tags.filter((t) => !fix.remove.includes(t));
    if (fix.add) tags.push(...fix.add);
  }

  // 4. Pattern-based slug rules
  for (const rule of PATTERN_RULES) {
    if (rule.match.test(slug)) tags.push(...rule.addTags);
  }

  // 5. Content-based rules (explicit list)
  const contentRule = CONTENT_RULES.find((r) => r.id === slug);
  if (contentRule) tags.push(...contentRule.tags);

  // 6. Empty-tag fixes
  if (tags.length === 0) {
    if (slug.startsWith('zapis-ot-')) {
      tags.push(...ZAPIS_DEFAULT_TAGS);
    } else if (NO_TAGS_FIXES[slug]) {
      tags.push(...NO_TAGS_FIXES[slug]);
    }
  }

  // 7. Dedupe
  tags = [...new Set(tags)];

  return tags;
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log(`🏷️  Tag migration ${DRY ? '[DRY-RUN]' : '[LIVE]'}\n`);

  const files = (await fs.readdir(BLOG_DIR)).filter((f) => f.endsWith('.md'));
  let changed = 0;
  let unchanged = 0;
  const stats = {
    merges: 0,
    deletions: 0,
    perPostFixes: 0,
    patternAdded: 0,
    contentAdded: 0,
    noTagsFilled: 0,
  };
  const tagBefore = new Map();
  const tagAfter = new Map();

  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    const fullPath = path.join(BLOG_DIR, file);
    const content = await fs.readFile(fullPath, 'utf8');
    const fm = parseFrontmatter(content);
    if (!fm) {
      console.warn(`⚠️  ${slug}: no frontmatter, skip`);
      continue;
    }
    const oldTags = parseTags(fm.yaml) || [];
    const newTags = transformTags(oldTags, slug, fm.body);

    // collect stats
    oldTags.forEach((t) => tagBefore.set(t, (tagBefore.get(t) || 0) + 1));
    newTags.forEach((t) => tagAfter.set(t, (tagAfter.get(t) || 0) + 1));

    const oldStr = JSON.stringify(oldTags);
    const newStr = JSON.stringify(newTags);
    if (oldStr === newStr) {
      unchanged++;
      continue;
    }
    changed++;
    if (oldTags.some((t) => TAG_MERGES[t])) stats.merges++;
    if (oldTags.some((t) => TAG_DELETE.has(t))) stats.deletions++;
    if (PER_POST_FIXES[slug]) stats.perPostFixes++;
    if (oldTags.length === 0 && newTags.length > 0) stats.noTagsFilled++;

    if (!DRY) {
      const newYaml = setTags(fm.yaml, newTags);
      const newContent = `---\n${newYaml}\n---\n${fm.body}`;
      await fs.writeFile(fullPath, newContent);
    }

    console.log(`📝 ${slug}`);
    console.log(`   - ${oldStr}`);
    console.log(`   + ${newStr}\n`);
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Changed: ${changed}, Unchanged: ${unchanged}`);
  console.log(`   • Merges applied: ${stats.merges}`);
  console.log(`   • Deletions: ${stats.deletions}`);
  console.log(`   • Per-post fixes: ${stats.perPostFixes}`);
  console.log(`   • No-tags filled: ${stats.noTagsFilled}`);

  console.log(`\n📈 Tag inventory diff:`);
  const allTags = new Set([...tagBefore.keys(), ...tagAfter.keys()]);
  const sorted = [...allTags].sort();
  for (const t of sorted) {
    const b = tagBefore.get(t) || 0;
    const a = tagAfter.get(t) || 0;
    if (b !== a) {
      const sign = a > b ? '+' : '';
      console.log(`   ${t.padEnd(30)} ${b} → ${a}  (${sign}${a - b})`);
    }
  }
}

main().catch((err) => {
  console.error('💥 Fatal:', err.message);
  process.exit(1);
});
