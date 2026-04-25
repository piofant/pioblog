#!/usr/bin/env node
// Rename and merge tags across all posts.

import fs from 'node:fs';
import path from 'node:path';

const dir = 'src/content/blog';

// rename map: oldTag → newTag
const rename = new Map([
  ['учёба', 'школа жизни'],
  ['учеба', 'школа жизни'],
  ['рекомендую', 'рекомендации'],
  ['сторителл', 'история'],
  ['предыстория', 'история'],
]);

// posts that should additionally get the "вуз" tag (curated)
const VUZ_POSTS = new Set([
  '3-mira-shkola-vuz-rabota-247.md',
  'kak-postupit-v-top-vuzy-po-proektam-a-ne-ege-167.md',
  'moi-opyt-postupleniia-po-proektam-na-grant-v-top-163.md',
  'open-call-edtekham-i-vsem-ostalnym-go-dadim-306.md',
  'u-vovy-ostalos-2-mesiatsa-i-27-dnei-studencheskoi-404.md',
  'underground-robotics.md',
  'davaite-znakomitsia-ia-vova-i-ia-meniaius-177.md',
  'samye-populiarnye-posty-v-etom-kanale-4.md',
  'chto-proizoshlo-v-nashem-keis-klube-dlia-prodaktov-257.md',
  'eng-meetup.md',
  'kak-pereiti-iz-razrabotchika-v-prodakty-394.md',
]);

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
let renamed = 0;
let vuzAdded = 0;

for (const f of files) {
  const fp = path.join(dir, f);
  const txt = fs.readFileSync(fp, 'utf8');
  const fm = txt.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) continue;
  const head = fm[1];
  const body = txt.slice(fm[0].length);

  const tagsM = head.match(/^tags:\s*\[([^\]]*)\]\s*$/m);
  if (!tagsM) continue;

  const tags = tagsM[1]
    .split(',')
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);

  // apply rename
  const next = tags.map((t) => rename.get(t) ?? t);

  // optionally add вуз
  if (VUZ_POSTS.has(f) && !next.includes('вуз')) {
    next.push('вуз');
    vuzAdded += 1;
  }

  // dedupe (preserve order)
  const seen = new Set();
  const deduped = [];
  for (const t of next) {
    if (!seen.has(t)) {
      seen.add(t);
      deduped.push(t);
    }
  }

  if (deduped.join(',') === tags.join(',')) continue;

  const quoted = deduped.map((t) => `'${t.replace(/'/g, "\\'")}'`).join(', ');
  const newHead = head.replace(/^tags:\s*\[[^\]]*\]\s*$/m, `tags: [${quoted}]`);
  fs.writeFileSync(fp, '---\n' + newHead + '\n---\n' + body);
  renamed += 1;
}

console.log(`Updated ${renamed} files. ВУЗ added to ${vuzAdded} posts.`);
