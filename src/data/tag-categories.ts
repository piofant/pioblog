/**
 * Tag taxonomy для блога.
 *
 * 4 категории. Минимально — без emoji, без описаний.
 */

export type TagCategory = {
	id: string;
	name: string;
	color: string;
	tags: string[];
};

export const TAG_CATEGORIES: TagCategory[] = [
	{
		id: 'product',
		name: 'продуктовое',
		color: '#2563eb',
		tags: ['продакт', 'карьера', 'менторство', 'ии', 'боты'],
	},
	{
		id: 'trips',
		name: 'трипы',
		color: '#ea580c',
		tags: [
			'трипы',
			'автостоп',
			'летняя школа',
			'мужские круги',
			'безумие',
			'випассана',
			'медитация',
		],
	},
	{
		id: 'creative',
		name: 'творчество',
		color: '#db2777',
		tags: ['творчество', 'театр', 'танцы', 'контактная импровизация', 'клоунада'],
	},
	{
		id: 'life',
		name: 'жизнь',
		color: '#7c3aed',
		tags: [
			'рефлексия',
			'психология',
			'истории',
			'школа жизни',
			'нетворкинг',
			'вуз',
			'жизнь',
			'жизнь в настоящем',
			'whois',
			'анонс',
			'рекомендации',
		],
	},
];

const TAG_TO_CATEGORY: Map<string, TagCategory> = (() => {
	const m = new Map<string, TagCategory>();
	for (const cat of TAG_CATEGORIES) {
		for (const t of cat.tags) {
			if (m.has(t)) {
				throw new Error(
					`tag-categories: tag "${t}" присвоен двум категориям: ${m.get(t)!.id} и ${cat.id}`,
				);
			}
			m.set(t, cat);
		}
	}
	return m;
})();

export function categoryOf(tag: string): TagCategory | null {
	return TAG_TO_CATEGORY.get(tag) ?? null;
}

export const KNOWN_TAGS: ReadonlySet<string> = new Set(TAG_TO_CATEGORY.keys());
