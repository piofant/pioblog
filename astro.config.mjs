// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';
import remarkUnwrapImages from 'remark-unwrap-images';

// https://astro.build/config
export default defineConfig({
	site: 'https://piofant.github.io',
	integrations: [mdx(), sitemap()],
	markdown: {
		// Markdown по умолчанию оборачивает каждую картинку в <p>,
		// что ломает Telegram Instant View (img внутри p — запрещено)
		// и просто не нужно — картинка это самостоятельный блок.
		remarkPlugins: [remarkUnwrapImages],
	},
	// Short-URL aliases for memorable sharing. /wiki/{slug}/ remains the
	// canonical Notion-synced location; these are entry points that emit
	// a static redirect HTML page.
	// NOTE: '/CV' → '/cv/' redirect removed because it conflicts with cv.astro page
	// (overwrites real CV page on case-insensitive FS / suppresses it on Linux).
	redirects: {
		'/value': '/wiki/about/',
		'/cases': '/wiki/portfolio/',
		'/mentor': '/wiki/mentoring/',
	},
	fonts: [
		{
			provider: fontProviders.google(),
			name: 'Literata',
			cssVariable: '--font-body',
			weights: [400, 700],
			styles: ['normal', 'italic'],
			subsets: ['cyrillic', 'latin', 'latin-ext'],
			fallbacks: ['Georgia', 'serif'],
		},
		{
			provider: fontProviders.google(),
			name: 'Inter',
			cssVariable: '--font-ui',
			weights: [400, 500, 600, 700],
			styles: ['normal'],
			subsets: ['cyrillic', 'latin', 'latin-ext'],
			fallbacks: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
		},
		{
			provider: fontProviders.google(),
			name: 'Play',
			cssVariable: '--font-heading',
			weights: [400, 700],
			styles: ['normal'],
			fallbacks: ['Helvetica', 'Arial', 'sans-serif'],
		},
		{
			provider: fontProviders.google(),
			name: 'Cormorant Garamond',
			cssVariable: '--font-brand',
			weights: [400, 600, 700],
			styles: ['normal', 'italic'],
			subsets: ['cyrillic', 'cyrillic-ext', 'latin', 'latin-ext'],
			fallbacks: ['Georgia', 'serif'],
		},
		{
			provider: fontProviders.google(),
			name: 'Forum',
			cssVariable: '--font-hero',
			weights: [400],
			styles: ['normal'],
			subsets: ['cyrillic', 'cyrillic-ext', 'latin', 'latin-ext'],
			fallbacks: ['Georgia', 'serif'],
		},
	],
});
