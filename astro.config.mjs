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
		/* Merged addendum posts → их parent. Когда два TG-сообщения логически
		   были одним постом (текст + видео-версия / аудио-версия / PDF-версия),
		   мерджим контент в parent. Старые URL → 301 на parent, чтобы форварды
		   из ТГ не ломались. */
		'/blog/tekstovaia-versiia-dlia-tekh-kto-v-metro-239/': '/blog/chto-delat-esli-ty-prodakt-antifroda-avito-238/',
		'/blog/u-tebia-vsegda-est-shans-vse-perepisat-28/': '/blog/seichas-ia-nedavno-uvidel-sleduiushchii-videorolik-kotoryi-27/',
		'/blog/riadom-s-kompami-stoiat-servaki-vot-eto-da-51/': '/blog/po-priezde-domoi-ia-chuvstvoval-grust-ot-togo-chto-vse-50/',
		'/blog/vyiasnitsia-chto-uchitelnitsa-to-byla-nuzhna-ne-74/': '/blog/popytka-nauchitsia-liubit-sebia-75/',
		'/blog/eshche-ia-tam-vstretil-znakomogo-vypusknika-iz-bioklassa-i-96/': '/blog/priglasili-na-mental-hour-udivitelno-krinzhovo-94/',
		'/blog/my-v-zume-prisoediniaites-po-ssylke-246/': '/blog/anons-prazdnuem-vmeste-s-vovoi-1k-podpischikov-v-244/',
		'/blog/audiversiia-poslushat-kak-podkastik-331/': '/blog/lektsiia-pro-moi-pervyi-opyt-avtostopa-s-329/',
		'/blog/pdf-prezentashka-s-lektsii-332/': '/blog/lektsiia-pro-moi-pervyi-opyt-avtostopa-s-329/',
		'/blog/ishchu-analogichnyi-stolb-proiavlennosti-v-raione-379/': '/blog/chat-privet-blizhaishie-2-nedeli-u-menia-bolit-378/',
		'/blog/diadia-boria-pro-otdykh-audio-34/': '/blog/I-can-not-relax-or-rest/',
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
