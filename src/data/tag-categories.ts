/**
 * Tag taxonomy для блога.
 *
 * Все теги сгруппированы в 5 тематических категорий + safety-bucket «Жизнь».
 * Каждый тег принадлежит ровно одной категории.
 *
 * Категории используются на /tags/ для group-by-display, а также
 * могут быть переиспользованы в landing-страницах, графе, бейджах и т.д.
 */

export type TagCategory = {
	id: string;
	name: string;
	emoji: string;
	/** 1-2 предложения для landing/listing. */
	description: string;
	/** hex для бейджей и border-bottom у тегов. */
	color: string;
	/** Теги, входящие в эту категорию. Порядок в массиве — авторский, UI сортирует по частоте. */
	tags: string[];
};

export const TAG_CATEGORIES: TagCategory[] = [
	{
		id: 'product',
		name: 'Продуктовое',
		emoji: '📊',
		description:
			'Профессия, продукт, карьера, ИИ и боты. Заметки практика и рефлексия о работе.',
		color: '#2563eb',
		tags: ['продакт', 'карьера', 'менторство', 'ии', 'боты'],
	},
	{
		id: 'trips',
		name: 'Трипы и приключения',
		emoji: '🎒',
		description:
			'Путешествия, автостоп, ретриты, медитации, мужские круги, летняя школа — всё про выход из зоны и опыт за пределами рутины.',
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
		name: 'Творчество',
		emoji: '🎭',
		description:
			'Театр, танцы, контактная импровизация, клоунада — всё про сцену, тело и игру.',
		color: '#db2777',
		tags: ['творчество', 'театр', 'танцы', 'контактная импровизация', 'клоунада'],
	},
	{
		id: 'inner',
		name: 'Личное и рефлексия',
		emoji: '🪞',
		description:
			'Внутренний ландшафт: рефлексия, психология, истории из жизни, попытка понять себя через текст.',
		color: '#7c3aed',
		tags: ['рефлексия', 'психология', 'истории'],
	},
	{
		id: 'school',
		name: 'Учёба и школа жизни',
		emoji: '🎓',
		description:
			'Школа жизни, вуз, нетворкинг — про обучение, людей, среды и сообщества вокруг них.',
		color: '#16a34a',
		tags: ['школа жизни', 'вуз', 'нетворкинг'],
	},
	{
		id: 'life',
		name: 'Жизнь',
		emoji: '☕',
		description:
			'Универсальное и служебное: жизнь как поток, whois, анонсы, рекомендации.',
		color: '#64748b',
		tags: ['жизнь', 'whois', 'анонс', 'рекомендации'],
	},
];

/**
 * Map для O(1) lookup тега → категория. Строится на этапе сборки.
 */
const TAG_TO_CATEGORY: Map<string, TagCategory> = (() => {
	const m = new Map<string, TagCategory>();
	for (const cat of TAG_CATEGORIES) {
		for (const t of cat.tags) {
			if (m.has(t)) {
				// Дубликат тега в двух категориях — поломанный invariant.
				// Бросаем при сборке, чтобы не маскировать ошибку.
				throw new Error(
					`tag-categories: tag "${t}" присвоен двум категориям: ${m.get(t)!.id} и ${cat.id}`,
				);
			}
			m.set(t, cat);
		}
	}
	return m;
})();

/**
 * Возвращает категорию для тега, либо null, если тег не размечен.
 */
export function categoryOf(tag: string): TagCategory | null {
	return TAG_TO_CATEGORY.get(tag) ?? null;
}

/**
 * Все теги, размеченные категориями (плоский список).
 */
export const KNOWN_TAGS: ReadonlySet<string> = new Set(TAG_TO_CATEGORY.keys());
