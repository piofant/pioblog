// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://piofant.github.io',
	base: '/pioblog',
	integrations: [mdx(), sitemap()],
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
	],
});
