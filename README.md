# pio blog

Astro static site deployed to GitHub Pages at **https://piofant.github.io/pioblog/**.

## Стек

- **Astro** (content collections, MDX) — `src/content/blog/*.md`
- **GitHub Pages** деплой через GitHub Actions (`.github/workflows/deploy.yml`)
- Шрифты Google: Lora (body), Open Sans (UI), Play (заголовки)
- Палитра — кремовая (bg `#FCF8F0`, акцент `#FF4200`)

## Структура

```
src/
├── components/     # Header, Footer, BaseHead, FormattedDate
├── content/blog/   # посты (markdown)
├── layouts/        # BlogPost.astro
├── pages/
│   ├── index.astro      # главная (последние 15)
│   ├── archive.astro    # /archive/ — все посты по годам
│   ├── about.astro      # /about/
│   ├── blog/[...slug]   # страница поста
│   ├── tags/[tag]       # страница тега
│   └── rss.xml.js       # /rss.xml
└── styles/global.css    # все стили
public/
├── img/            # изображения постов (мигрированы из vedulix-blog)
├── img/tg/         # картинки из TG-постов
└── img/notion/     # картинки из Notion
scripts/
├── sync-telegram.js     # TG scrape → markdown
├── sync-notion.js       # Notion DB → markdown
├── migrate-posts.mjs    # одноразовая миграция из vedulix-blog/_posts/
└── package.json
.github/workflows/
├── deploy.yml           # build + Pages deploy
├── sync-telegram.yml    # cron каждые 30 мин
└── sync-notion.yml      # cron каждые 15 мин (требует secrets)
```

## Разработка

```bash
npm install
npm run dev        # локально на http://localhost:4321/pioblog/
npm run build      # билд в dist/
npm run preview    # preview
```

Посты — markdown в `src/content/blog/`. Frontmatter:

```yaml
---
title: 'Заголовок'
subtitle: 'подзаголовок (опционально)'
pubDate: '2026-04-24'
tags: ['тег1', 'тег2']
heroImage: '/pioblog/img/photo.jpg'
---
```

## Синк из Telegram

Автоматически каждые 30 минут workflow `sync-telegram.yml` скачивает свежие посты с `t.me/s/pioblog` (публичный preview канала), парсит, пишет в `src/content/blog/tg-<msg_id>.md`. Дедупликация по id сообщения.

Ограничение: превью показывает только последние ~20 сообщений. Старые — один раз через `scripts/migrate-posts.mjs`.

Ручной запуск:

```bash
cd scripts && TG_CHANNEL=pioblog node sync-telegram.js
```

## Синк из Notion

Нужно 2 repo secrets:
- `NOTION_TOKEN` — Internal Integration Secret (https://www.notion.so/my-integrations)
- `NOTION_DATABASE_ID` — id базы постов в Notion

Поставить:

```bash
gh secret set NOTION_TOKEN --repo piofant/pioblog
gh secret set NOTION_DATABASE_ID --repo piofant/pioblog
```

Ожидаемая схема базы:

| Поле        | Тип          | Описание                          |
| ----------- | ------------ | --------------------------------- |
| `Title`     | title        | заголовок                         |
| `Subtitle`  | rich_text    | подзаголовок (опционально)        |
| `Slug`      | rich_text    | URL-slug (опционально)            |
| `Tags`      | multi_select | теги                              |
| `PubDate`   | date         | дата публикации                   |
| `Published` | checkbox     | синкаются только с `true`         |

Подключить интеграцию к базе: `···` → **Add connections** → выбрать интеграцию.

## Миграция старых постов

Одноразово из `vedulix-blog/_posts/*.md`:

```bash
cd scripts && node migrate-posts.mjs
```

Подхватывает frontmatter-поля `title`, `subtitle`, `tags`, `thumbnail-img`/`cover-img`, конвертирует в новую схему, пишет в `src/content/blog/<slug>.md`.
