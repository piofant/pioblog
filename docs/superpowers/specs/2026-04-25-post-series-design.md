# Post Series — design spec

**Date:** 2026-04-25
**Goal:** Make multi-part posts strongly linked: every part-post should expose its siblings, the next part should be a one-click action, and series posts should always appear in "похожие".

## Series catalog (8 series, 22 posts)

| Slug | Display name | Parts (chronological) |
|---|---|---|
| `yandex-internship` | Мой путь до стажировки продактом в Яндексе | intro: `ia-v-iandekse-stazher-menedzher-produkta-132`<br>1: `vse-nachinaetsia-s-mentora-140`<br>2: `kak-naiti-rabotu-stazherom-dzhunom-prodaktom-142`<br>3: `podgotovka-k-keis-sektsii-interviu-na-prodakta-145`<br>4: `zapis-ot-15-aprelia-2024-146`<br>5: `zapis-ot-16-maia-2024-148` |
| `my-strengths` | Мои сильные стороны | 1: `moi-silnye-storony-i-chem-oni-polezny-248`<br>2: `2-zhivoi-um-chutkost-client-problem-definition-250`<br>3: `3-refleksiia-sbor-fidbeka-tiaga-k-strukture-vyvody-252` |
| `mentees-results` | Результаты моих менти | 1: `rezultaty-moikh-menti-chast-1-ot-direktora-261`<br>2: `proiti-pervyi-v-zhizni-keis-sobes-i-otobratsia-v-280`<br>3: `zareshat-keis-i-otobratsia-na-dzhuna-prodakta-v-293` |
| `pm-take-home` | Как я решаю тестовые на продакта | 1: `kak-ia-reshaiu-testovye-na-prodakta-podkhod-kak-na-202`<br>2: `kak-ia-reshaiu-testovye-na-prodakta-2-chast-235` |
| `linkedin-value` | Польза LinkedIn | 1: `polza-linkedina-216`<br>2: `polza-linkedina-chast-2-internet-friends-i-240` |
| `observer-travels` | Путешествия в режиме наблюдателя | 1: `puteshestviia-v-rezhime-nabliudatelia-za-zhizniu-i-372`<br>2: `puteshestviia-v-rezhime-nabliudatelia-chast-2-375` |
| `psaiko-monetization` | #сторителл про монетизацию Псайко | 1: `0-lidov-za-2-mesiatsa-ili-kak-ia-protestiroval-3-274`<br>2: `storitell-pro-monetizatsiiu-psaiko-chast-2-kakie-275` |
| `school-grade-10` | Моё первое полугодие 10 класса | 1: `moe-pervoe-polugodie-10-klassa-chto-ia-ponial-23`<br>2: `part-2-otnoshenie-k-obrazovatelnym-kursam-25` |

Excluded: post `chem-menia-tak-zatsepila-eta-ideia-postupleniia-na-419` (marked Часть 1\2 but no part 2 yet).

## Data model

### Frontmatter additions (per part-post)
```yaml
series: 'yandex-internship'   # series slug
seriesPart: 2                 # 1-based part number
```

For the Yandex intro/hub post (132), `seriesPart: 0` to mark it as intro.

### Series registry — `src/series.ts`
```ts
export const SERIES: Record<string, { name: string; introSlug?: string }> = {
  'yandex-internship': { name: 'Мой путь до стажировки продактом в Яндексе', introSlug: 'ia-v-iandekse-stazher-menedzher-produkta-132' },
  'my-strengths': { name: 'Мои сильные стороны' },
  // ... etc
};
```

The Astro content schema in `src/content.config.ts` adds optional `series` and `seriesPart` fields.

## Display

### 1. Series-nav widget (top of post, between tags and content)
Compact bordered box, font-family ui:
```
┌────────────────────────────────────────────┐
│ 📚 Серия: Результаты моих менти            │
│ ─                                           │
│ • часть 1 — от директора Яндекс Лавки       │
│ → часть 2 — отбор в ШМЯ (вы тут)            │
│ • часть 3 — джун в MIRO                     │
└────────────────────────────────────────────┘
```
- Title: bold, link to intro post if exists else just text
- Each part: link except current (current is bolded, no link)
- Subtitles truncated to ~32 chars

### 2. Bottom-of-post next-in-series CTA
Above existing prev/next nav. Style: prominent button with arrow.
- If has next: `Следующая часть в серии → [title]`
- Else if not last: should not happen (last has no next)
- For intro post (part 0): `Начать с части 1 →`
- For last part: `← Предыдущая часть в серии` (subtle, optional)

### 3. "Похожие посты" boost
In `src/pages/blog/[...slug].astro` related-posts logic: when computing top-4, all same-series posts (excluding current) are placed first, then fill rest with tag-overlap sort. Cap at 4 total.

### 4. (skipped) mini-graph cue, /series/ index page

## Implementation phases

1. **Phase 1 — data**: write `scripts/add-series.mjs` that adds `series` + `seriesPart` to the 22 posts. Update content schema. Create `src/series.ts`.
2. **Phase 2 — display**: add series-nav widget in `BlogPost.astro`, bottom CTA, "похожие" boost in `[...slug].astro`. Add CSS in `global.css`.
3. **Phase 3 — verify**: build, curl 4 sample posts (one per typical case: middle-of-3, last-of-2, intro/hub, single).

## Out of scope

- Tag/UI changes
- /series/ index page (8 series, не нужно отдельной страницы)
- Mini-graph series-edge styling (overkill)
- Auto-detection of new series (manual additions to `series.ts` for future series)
