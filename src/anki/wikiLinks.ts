/**
 * Wiki link handling for Anki field HTML / markdown.
 * Default off: strip `[[...]]` to plain display text (no link).
 * When on: convert Obsidian internal links to `obsidian://open` (oburi).
 */

/** Non-embed wiki links: [[target]] / [[target|alias]] (not ![[embed]]). */
const WIKI_LINK_REGEXP = /(^|[^!])\[\[([^\]\n]+?)\]\]/g;

function displayTextFromWikiInner(inner: string): string {
	const parts = inner.split('|');
	if (parts.length >= 2) {
		const alias = parts.slice(1).join('|').trim();
		if (alias) {
			return alias;
		}
	}
	const target = (parts[0] ?? '').trim();
	if (!target) {
		return '';
	}
	const hash = target.indexOf('#');
	const pathPart = hash >= 0 ? target.slice(0, hash) : target;
	const base =
		pathPart.split(/[/\\]/).pop()?.replace(/\.md$/i, '') || pathPart;
	if (hash >= 0) {
		const frag = target.slice(hash + 1).replace(/^\^/, '').trim();
		return frag || base;
	}
	return base;
}

/**
 * Replace wiki links with plain display text (aliases / basenames).
 * Leaves `![[media]]` embeds untouched for the media pipeline.
 */
export function stripWikiLinksInMarkdown(markdown: string): string {
	return markdown.replace(
		WIKI_LINK_REGEXP,
		(_m, prefix: string, inner: string) =>
			`${prefix}${displayTextFromWikiInner(inner)}`,
	);
}

function buildQuery(params: Record<string, string>): string {
	return Object.entries(params)
		.filter(([, value]) => value.length > 0)
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
		)
		.join('&');
}

/** `obsidian://open?vault=…&file=…` from an internal-link data-href. */
export function buildObUriForWikiTarget(
	vaultName: string,
	dataHref: string,
): string {
	const file = dataHref.trim().replace(/\\/g, '/');
	if (!file) {
		return '';
	}
	return `obsidian://open?${buildQuery({
		vault: vaultName,
		file,
	})}`;
}

/**
 * Post-process rendered HTML:
 * - enabled=false: unwrap `a.internal-link` to plain text
 * - enabled=true: rewrite href to oburi from data-href / href
 */
export function processWikiLinksInHtml(
	html: string,
	options: { enabled: boolean; vaultName: string },
): string {
	if (!html.trim()) {
		return html;
	}
	const host = document.createElement('div');
	host.innerHTML = html;
	const links = Array.from(
		host.querySelectorAll('a.internal-link, a[data-href]'),
	) as HTMLAnchorElement[];

	for (const link of links) {
		const isInternal =
			link.classList.contains('internal-link') ||
			link.hasAttribute('data-href');
		if (!isInternal) {
			continue;
		}

		if (!options.enabled) {
			const text = link.textContent ?? '';
			link.replaceWith(document.createTextNode(text));
			continue;
		}

		const dataHref = (
			link.getAttribute('data-href') ||
			link.getAttribute('href') ||
			''
		).trim();
		// Skip already-valid obsidian:// / http(s) targets.
		if (/^obsidian:/i.test(dataHref) || /^https?:\/\//i.test(dataHref)) {
			continue;
		}
		// app://obsidian.md/... is useless in Anki — prefer data-href path.
		const target =
			link.getAttribute('data-href')?.trim() ||
			(!/^app:/i.test(dataHref) ? dataHref : '');
		if (!target) {
			const text = link.textContent ?? '';
			link.replaceWith(document.createTextNode(text));
			continue;
		}
		const uri = buildObUriForWikiTarget(options.vaultName, target);
		if (!uri) {
			continue;
		}
		link.setAttribute('href', uri);
		link.classList.add('dta-wiki-link');
	}

	return host.innerHTML;
}
