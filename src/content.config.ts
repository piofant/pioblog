import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		title: z.string(),
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		tags: z.array(z.string()).optional(),
		heroImage: z.string().optional(),
		series: z.string().optional(),
		seriesPart: z.number().optional(),
		/* Скрыть из всех листингов и поломать URL поста (Astro отдаст 404).
		   Для шумовых постов (плейсхолдеры, тизеры, эмодзи-only) — без удаления
		   файла из git. Фильтруется во всех getCollection-ах через хелпер из
		   src/lib/blog.ts. */
		draft: z.boolean().optional(),
	}),
});

const pages = defineCollection({
	loader: glob({ base: './src/content/pages', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		title: z.string(),
		notion_id: z.string().optional(),
		notion_last_edited: z.string().optional(),
		parent_notion_id: z.string().optional(),
		isRoot: z.string().optional(),
	}),
});

export const collections = { blog, pages };
