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
			name: 'Fraunces',
			cssVariable: '--font-body',
			weights: [400, 700],
			styles: ['normal', 'italic'],
			fallbacks: ['Georgia', 'serif'],
		},
		{
			provider: fontProviders.google(),
			name: 'Open Sans',
			cssVariable: '--font-ui',
			weights: [400, 600, 700],
			styles: ['normal'],
			fallbacks: ['system-ui', 'sans-serif'],
		},
		{
			provider: fontProviders.google(),
			name: 'Play',
			cssVariable: '--font-heading',
			weights: [400, 700],
			styles: ['normal'],
			fallbacks: ['Helvetica', 'Arial', 'sans-serif'],
		},
	],
});
