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
			name: 'Lora',
			cssVariable: '--font-body',
			fallbacks: ['Georgia', 'serif'],
		},
		{
			provider: fontProviders.google(),
			name: 'Open Sans',
			cssVariable: '--font-ui',
			fallbacks: ['system-ui', 'sans-serif'],
		},
		{
			provider: fontProviders.google(),
			name: 'Play',
			cssVariable: '--font-heading',
			fallbacks: ['Helvetica', 'Arial', 'sans-serif'],
		},
	],
});
