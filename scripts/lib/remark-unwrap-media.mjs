/**
 * Remark plugin — разворачивает <p>-обёртку вокруг сырого HTML-медиа.
 *
 * Markdown по умолчанию оборачивает inline-HTML в <p>, но Telegram
 * Instant View не поддерживает <audio>/<video>/<iframe> внутри <p>
 * (даёт ошибку NESTED_ELEMENT_NOT_SUPPORTED). Плюс семантически
 * это медиа — самостоятельный блок, обёртка не нужна.
 *
 * Пара с remark-unwrap-images, который делает то же для <img>.
 */
import { visit } from 'unist-util-visit';

const MEDIA_OPENING_TAG = /^<(audio|video|iframe)[\s>]/i;

/**
 * Проверяет что paragraph целиком состоит из html-нод и первая
 * из них открывается тегом медиа. Markdown может разбить
 * `<audio>...<source>...</audio>` на несколько html-нод
 * внутри одного paragraph — нам важна совокупная "медийность".
 */
function isMediaParagraph(node) {
	if (!node.children || node.children.length === 0) return false;
	const allHtml = node.children.every((c) => c.type === 'html');
	if (!allHtml) return false;
	const first = node.children[0].value.trimStart();
	return MEDIA_OPENING_TAG.test(first);
}

export default function remarkUnwrapMedia() {
	return (tree) => {
		visit(tree, 'paragraph', (node, index, parent) => {
			if (parent && typeof index === 'number' && isMediaParagraph(node)) {
				// Конкатенируем все html-чанки в одну ноду — иначе ремарк
				// может вставить переводы строк между ними при stringify.
				const merged = {
					type: 'html',
					value: node.children.map((c) => c.value).join(''),
				};
				parent.children.splice(index, 1, merged);
				return ['skip', index];
			}
		});
	};
}
