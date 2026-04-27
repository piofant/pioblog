/* Centralised blog-collection accessor that excludes drafts.
   Use this everywhere instead of `getCollection('blog')` so a post marked
   `draft: true` in frontmatter disappears from feed/tags/archive/RSS/sitemap
   AND its URL returns 404. */
import { getCollection, type CollectionEntry } from 'astro:content';

export async function getPublishedPosts(): Promise<CollectionEntry<'blog'>[]> {
	const all = await getCollection('blog');
	return all.filter((p) => p.data.draft !== true);
}
