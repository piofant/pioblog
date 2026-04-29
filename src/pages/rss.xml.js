import { getCollection } from 'astro:content';
import { getPublishedPosts } from '../lib/blog';
import { excerptOf } from '../lib/excerpt';
import rss from '@astrojs/rss';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';

export async function GET(context) {
	const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
	const posts = await getPublishedPosts();
	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site,
		items: posts
			.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
			.map((post) => ({
				title: post.data.title,
				description: excerptOf(post.body || '', 28),
				pubDate: post.data.pubDate,
				link: `${base}/blog/${post.id}/`,
			})),
	});
}
