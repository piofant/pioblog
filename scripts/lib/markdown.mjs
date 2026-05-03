/**
 * Shared markdown post-processing for any script that writes blog post bodies.
 *
 * The single source of truth for "TG-style → Markdown" cleanup. Any script that
 * generates / imports / migrates post bodies MUST run them through `fixBody`
 * before writing to disk. Otherwise we end up with quirks like
 * `[**в школьные годы**]\nя настроил...` rendering as one paragraph (CommonMark
 * treats single newlines as soft breaks).
 *
 * Used by:
 *   - scripts/sync-telegram.js  (Telegram sync — main path)
 *   - scripts/migrate-posts.mjs (Jekyll/legacy migration)
 *   - scripts/fix-paragraph-breaks.mjs (one-off cleanup; idempotent)
 */

/* Bold/italic spans that span multiple lines confuse CommonMark — split into
   per-line emphasis so `*` markers don't get orphaned. */
export function splitMultilineEmphasis(body) {
	// **text** first (to avoid consuming single `*`)
	body = body.replace(/\*\*([^*][\s\S]*?[^*]|[^*])\*\*/g, (m, inner) => {
		if (!inner.includes('\n')) return m;
		return inner.split('\n')
			.map((l) => l.trim() ? `**${l.trim()}**` : '')
			.join('\n');
	});
	// Single *text* (not preceded/followed by another *)
	body = body.replace(/(?<!\*)\*([^*][\s\S]*?[^*]|[^*])\*(?!\*)/g, (m, inner) => {
		if (!inner.includes('\n')) return m;
		return inner.split('\n')
			.map((l) => l.trim() ? `*${l.trim()}*` : '')
			.join('\n');
	});
	return body;
}

/* Convert single newlines to paragraph breaks. Crucial for TG-style content
   where every line break is intentional. Code fences are preserved. */
export function paragraphize(body) {
	const parts = body.split(/(```[\s\S]*?```)/g);
	return parts.map((part, i) => {
		if (i % 2 === 1) return part;
		return part.replace(/\n+/g, '\n\n');
	}).join('');
}

/* Orphan `[label]` на отдельной строке — это kicker-маркеры из TG
   (автор так выделяет подразделы). Markdown их сам не стилизует, рендерит
   как `<p>[label]</p>` с лишними скобками. Конвертим в `**label**` —
   получаем bold-абзац, который визуально работает как kicker.

   Кейсы:
     [foo]              → **foo**
     [**foo**]          → **foo**
     [**foo** bar]      → **foo bar** (внутренние ** убираем чтобы не было ****)
     **[foo]**          → **foo**

   Не трогает реальные ссылки `[text](url)` — у тех `]` сразу следует `(`. */
export function unwrapBracketKickers(body) {
	const parts = body.split(/(```[\s\S]*?```)/g);
	return parts.map((part, i) => {
		if (i % 2 === 1) return part;
		// Сначала: **[label]** → [label] (выпрямляем внешний bold)
		let out = part.replace(/^\*\*\[([^\[\]\n]+)\]\*\*$/gm, '[$1]');
		// Потом: [label] на отдельной строке → **label** (без вложенных **)
		out = out.replace(/^\[([^\[\]\n]+)\]$/gm, (_, inner) => {
			// Убираем все ** внутри чтоб не получить ****foo**bar**
			const cleaned = inner.replace(/\*\*/g, '').trim();
			return `**${cleaned}**`;
		});
		return out;
	}).join('');
}

/* Master fix — apply all transforms to a post body.
   NB: `unwrapBracketKickers` намеренно НЕ применяется. В TG автор пишет
   подразделы как `[**label**]` — скобки видны и в TG-клиенте, и должны
   оставаться видимыми на сайте. Удаление скобок ломало визуальную форму. */
export function fixBody(body) {
	return paragraphize(splitMultilineEmphasis(body));
}
