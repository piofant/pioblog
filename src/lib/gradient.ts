// Inline CSS gradient для thumb-fallback'ов (wiki-страницы без heroImage).
// Та же палитра что в scripts/gen-gradient-thumbs.mjs (продакт=синий,
// трипы=оранж, творчество=розовый, жизнь=фиолетовый), но без необходимости
// генерить PNG — просто linear+radial CSS gradient прямо в style.
//
// Детерминирующая функция: hash(slug) → цвет + угол + позиция света.

const PALETTE = [
	'#2563eb', // продуктовый синий
	'#ea580c', // trips-оранж
	'#db2777', // творчество-розовый
	'#7c3aed', // жизнь-фиолетовый
];

/* Простой 32-bit hash (mulberry-style) — работает в браузере и в Node.
   Не криптографический: важна только детерминированность и равномерность. */
function hashStr(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

const POSITIONS: Array<[number, number]> = [
	[20, 20], [75, 15], [50, 30], [85, 50],
	[15, 60], [60, 75], [30, 85], [80, 80],
];

/**
 * Возвращает строку для атрибута style — мягкий градиент (white base +
 * tinted linear + radial light spot), уникальный для каждого slug.
 */
export function gradientStyle(slug: string): string {
	const h = hashStr(slug);
	const color = PALETTE[h % PALETTE.length];
	const angle = (h >>> 4) % 360;
	const [cx, cy] = POSITIONS[(h >>> 12) % POSITIONS.length];
	const radius = 50 + ((h >>> 20) % 30);
	// Двойной градиент: tinted linear + white radial light overlay.
	// Через RGBA чтобы не зависеть от поддержки color-mix.
	const rgba = (a: number) => hexA(color, a);
	return [
		`background-color:#fafafa`,
		`background-image:radial-gradient(circle at ${cx}% ${cy}%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.35) 40%, rgba(255,255,255,0) ${radius}%), linear-gradient(${angle}deg, ${rgba(0.32)}, ${rgba(0.08)})`,
	].join(';');
}

function hexA(hex: string, alpha: number): string {
	const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	if (!m) return hex;
	const r = parseInt(m[1], 16);
	const g = parseInt(m[2], 16);
	const b = parseInt(m[3], 16);
	return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
}
