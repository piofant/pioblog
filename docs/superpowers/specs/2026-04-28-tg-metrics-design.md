# Telegram-метрики на блоге

**Дата:** 2026-04-28
**Статус:** design approved

## Цель

Показывать метрики постов из TG-канала `@pioblog` (просмотры, реакции, форварды, ERR) на сайте `piofant.github.io`:
1. На каждой странице поста — компактная строка метрик внизу
2. Отдельная страница `/stats` со списком, фильтрами, топами и графиками

---

## Архитектура

### 1. Сбор данных — gramjs (MTProto)

**Стек:** [gramjs](https://gram.js.org/) — Node-клиент TG MTProto. Тот же runtime что у `sync-telegram.js` (Node 22 в Actions).

**Setup один раз локально:**
1. На `my.telegram.org` → API → получить `api_id` и `api_hash`
2. Запустить `node scripts/tg-login.mjs` → ввести phone + SMS code + 2FA password → в консоли выпадает `sessionString`
3. В GitHub repo → Settings → Secrets → добавить:
   - `TG_API_ID`
   - `TG_API_HASH`
   - `TG_SESSION_STRING`

Session string живёт месяцами; повторный логин не требуется.

**Что собираем для каждого поста (по `telegram_id` из slug):**
- `views: number` — Message.views
- `forwards: number` — Message.forwards
- `replies: number` — Message.replies?.replies
- `reactions: { emoji: string, count: number }[]` — массив с детализацией
- `err: number | null` — расчётное (см. ниже)
- `last_updated: string` — ISO timestamp

**ERR (engagement rate):**
```
err = (Σ reactions.count + forwards + replies) / views * 100
```
Если `views === 0` → `err = null`.

### 2. Хранилище

**Файл:** `src/data/metrics.json`

```json
{
  "299": {
    "views": 2347,
    "forwards": 8,
    "replies": 3,
    "reactions": [
      {"emoji": "🐳", "count": 24},
      {"emoji": "❤️", "count": 18},
      {"emoji": "👍", "count": 5}
    ],
    "err": 4.18,
    "last_updated": "2026-04-28T04:00:00Z"
  },
  "...": "..."
}
```

Один файл, ~30KB на 192 поста. Коммитим в git — диффы видны, легко дебажить.

### 3. GitHub Action для обновления

**Файл:** `.github/workflows/sync-tg-metrics.yml`

**Cron:** `0 4 * * *` — раз в день в 04:00 UTC.

**Шаги:**
1. checkout + setup-node
2. `cd scripts && npm install` (gramjs as dep)
3. `node sync-tg-metrics.mjs` — читает все посты из `src/content/blog/`, извлекает `telegram_id` из суффикса slug (`-(\d+)$`), батчами тянет метрики через MTProto, мерджит в `metrics.json`
4. Если diff не пустой — commit `metrics: $(date)` + push
5. (если diff не пустой) trigger Pages deploy

Постов с `tg_id` ~192 → один прогон ≤ 1 минуты.

### 4. UI — внизу страницы поста

**Где:** в `BlogPost.astro` сразу перед блоком `<aside class="related-posts">` (т.е. после `.post-content` и `.post-hero`).

**Только если у поста есть `telegram_id` И есть запись в `metrics.json`.**

**Markup:**
```astro
<aside class="post-metrics">
  2.3K 👁 · 47 🐳 · 8 ↗ · ERR 4.2%
</aside>
```

**Стиль:** одна строка inline, мелким UI-шрифтом, цвет `--muted-2`. Никаких карточек/border'ов — просто метаданные. Hover на каждом числе → `title="..."` с подробностью (например для реакций — топ-3 эмодзи с count'ами).

**Числа сокращаем:**
- < 1000 → как есть (`847`)
- 1000-9999 → `2.3K`
- 10000+ → `12K`

### 5. Страница /stats

**Файл:** `src/pages/stats.astro`

**Структура (сверху вниз):**

#### 5.1 Hero — 4 топ-плашки
4 карточки в 2×2 grid:
- 🥇 Топ-5 по просмотрам
- 🐳 Топ-5 по реакциям
- ↗ Топ-5 по форвардам
- 📊 Топ-5 по ERR

В каждой карточке — список `<title> · число`. Клик по тайтлу → `/blog/<slug>/`.

#### 5.2 Графики (4 SVG, генерятся weekly)
Embedded as `<img src="/img/stats/<name>.svg">`:
- **`reactions-pie.svg`** — pie: распределение всех реакций (🐳/❤️/👍/...)
- **`err-by-tag.svg`** — bar: средний ERR по тегам, сортировано
- **`posts-per-month.svg`** — line: количество постов в месяц
- **`top-views.svg`** — bar: top-10 постов по просмотрам

#### 5.3 Сортируемая таблица
Все 192 поста (или фильтрованные):
- Колонки: title · date · views · 🐳 · ↗ · ERR · tags
- Кликабельные заголовки → сортировка ASC/DESC
- Default sort: views ↓
- Фильтр по тегам сверху — multi-select pills (как в /tags)
- Поиск по title (input)

Фильтр + сортировка реализуются на клиенте (вся таблица в HTML, JS манипулирует видимостью).

### 6. GitHub Action для графиков

**Файл:** `.github/workflows/generate-stats-charts.yml`

**Cron:** `0 5 * * 0` — раз в неделю, воскресенье 05:00 UTC.

**Стек:** [Observable Plot](https://observablehq.com/plot) (`@observablehq/plot`) + `jsdom` для server-side рендера.

**Скрипт `scripts/gen-stats-charts.mjs`:**
1. Читает `src/data/metrics.json` + все посты `src/content/blog/*.md` (для тегов и дат)
2. Для каждого графика:
   - Aggregate данных
   - `Plot.<chartType>(data, {...}).plot({document: jsdomDoc})` → SVG element
   - `serializer.serializeToString(svg)` → строка
   - `fs.writeFile('public/img/stats/<name>.svg', ...)`
3. 4 файла в `public/img/stats/`

**Стилизация:** цвета из палитры сайта (синий `#2563eb`, оранж `#ea580c`, розовый `#db2777`, фиолетовый `#7c3aed`). Шрифт Inter. Размер 800×400 (адаптивный через viewBox).

---

## Данные → UI mapping

| Источник | UI |
|---|---|
| `metrics.json[tg_id].views` | пост-метрики, top-views, sorted table |
| `metrics.json[tg_id].reactions` | pie chart, top-reactions, table |
| `metrics.json[tg_id].forwards` | top-forwards, table |
| `metrics.json[tg_id].err` | top-ERR, err-by-tag, table |
| `post.tags` | filter в таблице, агрегация err-by-tag |
| `post.pubDate` | posts-per-month |

---

## Не входит в scope (YAGNI)

- ❌ Live updates на странице (метрики статичные, обновляются daily)
- ❌ Графики истории метрик одного поста (нужен time-series storage, overkill)
- ❌ Подписчики канала / рост (отдельная история, можно потом)
- ❌ Comments breakdown (только count)
- ❌ Geo-распределение читателей (нет данных)
- ❌ Push-уведомления при ростах ERR

---

## Технические детали

### Telegram ID → post mapping
Slug всегда заканчивается на `-(\d+)`, например `sns-birthday-tusa-...-299`. Извлекаем regex'ом:
```js
const tg_id = slug.match(/-(\d+)$/)?.[1];
```
Посты без `tg_id` (legacy migrate, custom slug) → метрики не показываем.

### Edge case: новый пост, ещё нет метрик
- На странице поста: блок `.post-metrics` не рендерится (условие в Astro).
- В таблице: пустые ячейки или `—`.
- Будет добавлен следующим cron-прогоном (через ≤24 часа).

### Edge case: пост удалён в TG
- Метрика отсутствует → пост сохраняется в `metrics.json` как был, но `last_updated` не обновляется.
- В UI всё равно отрисовывается с последними доступными данными.
- Логируем warning в Action.

### Производительность
- `metrics.json` — 30KB. Astro инлайнит в HTML где нужно.
- Сортировка/фильтр в /stats — на клиенте, vanilla JS, без библиотек.
- 4 SVG графика по ~10-30KB. Pre-rendered, мгновенно показываются.

### Безопасность
- `TG_SESSION_STRING` — критичный secret, доступ ко всему TG-аккаунту. Только в Actions, никогда в логах.
- gramjs прячет session по умолчанию, но проверить что не печатаем в `console.log`.

---

## План имплементации (порядок)

1. **Сбор**: написать `scripts/tg-login.mjs` (helper) и `scripts/sync-tg-metrics.mjs` (main script). Локально протестить, получить `metrics.json`.
2. **GitHub Action** `sync-tg-metrics.yml` + добавить secrets.
3. **UI на странице поста** — `.post-metrics` строка в `BlogPost.astro`, читает из `metrics.json` через `import` или `getDataEntry`.
4. **/stats страница** — пп. 5.1 (топ-плашки) и 5.3 (таблица). Без графиков пока.
5. **Графики**: `scripts/gen-stats-charts.mjs` + `.github/workflows/generate-stats-charts.yml`. Embed на /stats.

Каждый шаг = отдельный PR/коммит. Между шагами — verify, потом следующий.

---

## Открытые вопросы

Нет.
