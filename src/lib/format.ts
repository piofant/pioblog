/**
 * Форматирование чисел для UI метрик.
 *
 * formatCount(847)   → "847"
 * formatCount(2347)  → "2.3K"
 * formatCount(12345) → "12K"
 * formatCount(1500000) → "1.5M"
 */
export function formatCount(n: number | null | undefined): string {
	if (n == null) return '—';
	if (n < 1000) return String(n);
	if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
	if (n < 1_000_000) return Math.round(n / 1000) + 'K';
	return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

/**
 * formatErr(4.18) → "4.2%"
 * formatErr(null) → "—"
 */
export function formatErr(err: number | null | undefined): string {
	if (err == null) return '—';
	if (err < 1) return err.toFixed(2) + '%';
	return err.toFixed(1) + '%';
}
