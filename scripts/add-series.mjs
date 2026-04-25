#!/usr/bin/env node
// Add `series` and `seriesPart` to frontmatter for the 22 multi-part posts.

import fs from 'node:fs';
import path from 'node:path';

const dir = 'src/content/blog';

const ASSIGNMENTS = [
	// yandex-internship: intro is part 0 (the hub post)
	['ia-v-iandekse-stazher-menedzher-produkta-132', 'yandex-internship', 0],
	['vse-nachinaetsia-s-mentora-140', 'yandex-internship', 1],
	['kak-naiti-rabotu-stazherom-dzhunom-prodaktom-142', 'yandex-internship', 2],
	['podgotovka-k-keis-sektsii-interviu-na-prodakta-145', 'yandex-internship', 3],
	['zapis-ot-15-aprelia-2024-146', 'yandex-internship', 4],
	['zapis-ot-16-maia-2024-148', 'yandex-internship', 5],
	// my-strengths
	['moi-silnye-storony-i-chem-oni-polezny-248', 'my-strengths', 1],
	['2-zhivoi-um-chutkost-client-problem-definition-250', 'my-strengths', 2],
	['3-refleksiia-sbor-fidbeka-tiaga-k-strukture-vyvody-252', 'my-strengths', 3],
	// mentees-results
	['rezultaty-moikh-menti-chast-1-ot-direktora-261', 'mentees-results', 1],
	['proiti-pervyi-v-zhizni-keis-sobes-i-otobratsia-v-280', 'mentees-results', 2],
	['zareshat-keis-i-otobratsia-na-dzhuna-prodakta-v-293', 'mentees-results', 3],
	// pm-take-home
	['kak-ia-reshaiu-testovye-na-prodakta-podkhod-kak-na-202', 'pm-take-home', 1],
	['kak-ia-reshaiu-testovye-na-prodakta-2-chast-235', 'pm-take-home', 2],
	// linkedin-value
	['polza-linkedina-216', 'linkedin-value', 1],
	['polza-linkedina-chast-2-internet-friends-i-240', 'linkedin-value', 2],
	// observer-travels
	['puteshestviia-v-rezhime-nabliudatelia-za-zhizniu-i-372', 'observer-travels', 1],
	['puteshestviia-v-rezhime-nabliudatelia-chast-2-375', 'observer-travels', 2],
	// psaiko-monetization
	['0-lidov-za-2-mesiatsa-ili-kak-ia-protestiroval-3-274', 'psaiko-monetization', 1],
	['storitell-pro-monetizatsiiu-psaiko-chast-2-kakie-275', 'psaiko-monetization', 2],
	// school-grade-10
	['moe-pervoe-polugodie-10-klassa-chto-ia-ponial-23', 'school-grade-10', 1],
	['part-2-otnoshenie-k-obrazovatelnym-kursam-25', 'school-grade-10', 2],
];

function setField(head, key, value) {
	const re = new RegExp(`^${key}:.*$`, 'm');
	const line = `${key}: ${value}`;
	if (re.test(head)) return head.replace(re, line);
	// insert before closing of frontmatter
	return head + '\n' + line;
}

let updated = 0;
for (const [slug, series, part] of ASSIGNMENTS) {
	const fp = path.join(dir, slug + '.md');
	if (!fs.existsSync(fp)) {
		console.error('MISSING:', slug);
		continue;
	}
	const txt = fs.readFileSync(fp, 'utf8');
	const fm = txt.match(/^---\n([\s\S]*?)\n---\n/);
	if (!fm) {
		console.error('NO FRONTMATTER:', slug);
		continue;
	}
	let head = fm[1];
	const body = txt.slice(fm[0].length);
	head = setField(head, 'series', `'${series}'`);
	head = setField(head, 'seriesPart', String(part));
	fs.writeFileSync(fp, '---\n' + head + '\n---\n' + body);
	updated += 1;
}
console.log(`Updated ${updated} files.`);
