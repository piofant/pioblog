// Извлекает чистый текстовый excerpt из markdown-body поста.
// Чистит markdown: code fences, inline-code, картинки, ссылки, эмфазис,
// заголовки, blockquote-маркеры. Используется везде где раньше был
// subtitle: og:description, card-sub в листингах, RSS description.
export function excerptOf(body: string, words = 20): string {
	const text = body
		.replace(/```[\s\S]*?```/g, '')
		.replace(/`[^`]*`/g, '')
		// Сырые HTML-блоки (audio/video/iframe вставляются как HTML в md):
		// сначала вырезаем целиком вместе с содержимым, потом одиночные теги.
		.replace(/<(audio|video|iframe|figure|picture|source)\b[\s\S]*?<\/\1>/gi, '')
		.replace(/<[^>]+>/g, '')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\*\*|\*|__|_/g, '')
		.replace(/#+\s+/g, '')
		.replace(/^\s*>\s*/gm, '')
		.replace(/\s+/g, ' ')
		.trim();
	const parts = text.split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '';
	return parts.slice(0, words).join(' ') + (parts.length > words ? '…' : '');
}
