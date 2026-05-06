// Series registry — slug → human name + optional intro/landing post slug.
// Add a new entry here when creating a multi-part post series.

export type SeriesEntry = {
	name: string;
	introSlug?: string;
};

export const SERIES: Record<string, SeriesEntry> = {
	'yandex-internship': {
		name: 'Мой путь до стажировки продактом в Яндексе',
		introSlug: 'ia-v-iandekse-stazher-menedzher-produkta-132',
	},
	'my-strengths': { name: 'Мои сильные стороны' },
	'mentees-results': { name: 'Результаты моих менти' },
	'pm-take-home': { name: 'Как я решаю тестовые на продакта' },
	'linkedin-value': { name: 'Польза LinkedIn' },
	'observer-travels': { name: 'Путешествия в режиме наблюдателя' },
	'psaiko-monetization': { name: '#сторителл про монетизацию Псайко' },
	'school-grade-10': { name: 'Моё первое полугодие 10 класса' },
	'dbt-practice': { name: 'Практика навыков ДБТ' },
};
