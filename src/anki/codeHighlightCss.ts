/**
 * Anki collection.media stylesheet for Prism / Obsidian code-token colors.
 *
 * Card field HTML already carries classes like `token keyword`; Anki needs
 * these color rules. Shipping them as a media file + `<link>` is more reliable
 * than relying solely on note-type Styling CSS.
 */

/** Underscore prefix: Anki won't treat this as unused media. */
export const CODE_HIGHLIGHT_CSS_FILENAME = '_dta-code-highlight.css';

export const CODE_HIGHLIGHT_STYLESHEET_LINK = `<link rel="stylesheet" href="${CODE_HIGHLIGHT_CSS_FILENAME}">`;

/**
 * Prism / Obsidian token colors (light + Anki nightMode).
 * Keep selectors global so they apply whether or not content is in `.dta-card`.
 */
export const DTA_CODE_HIGHLIGHT_CSS = `/* Deck To Anki — code token highlight (Prism / Obsidian) */

pre[class*="language-"],
pre.dta-code {
  text-align: left;
  overflow-x: auto;
  padding: 0.75rem 0.9rem;
  border-radius: 10px;
  background: #f1f5f9;
  color: #0f172a;
  tab-size: 4;
}

pre[class*="language-"] code,
pre.dta-code code {
  display: block;
  padding: 0;
  background: transparent;
  color: inherit;
  font-size: inherit;
  white-space: inherit;
  word-break: normal;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

:not(pre) > code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  padding: 0.12em 0.35em;
  border-radius: 6px;
  background: #f1f5f9;
  color: #0f172a;
}

.token.comment,
.token.prolog,
.token.doctype,
.token.cdata {
  color: #64748b;
}

.token.punctuation {
  color: #475569;
}

.token.namespace {
  opacity: 0.85;
}

.token.property,
.token.tag,
.token.boolean,
.token.number,
.token.constant,
.token.symbol,
.token.deleted {
  color: #c2410c;
}

.token.selector,
.token.attr-name,
.token.string,
.token.char,
.token.builtin,
.token.inserted {
  color: #15803d;
}

.token.operator,
.token.entity,
.token.url,
.language-css .token.string,
.style .token.string {
  color: #0f766e;
}

.token.atrule,
.token.attr-value,
.token.keyword {
  color: #4f46e5;
}

.token.function,
.token.class-name {
  color: #0369a1;
}

.token.regex,
.token.important,
.token.variable {
  color: #b45309;
}

.token.important,
.token.bold {
  font-weight: 700;
}

.token.italic {
  font-style: italic;
}

.token.entity {
  cursor: help;
}

/* Anki night mode */
.nightMode pre[class*="language-"],
.nightMode pre.dta-code {
  background: #1e293b;
  color: #e2e8f0;
}

.nightMode :not(pre) > code {
  background: #1e293b;
  color: #e2e8f0;
}

.nightMode .token.comment,
.nightMode .token.prolog,
.nightMode .token.doctype,
.nightMode .token.cdata {
  color: #94a3b8;
}

.nightMode .token.punctuation {
  color: #cbd5e1;
}

.nightMode .token.property,
.nightMode .token.tag,
.nightMode .token.boolean,
.nightMode .token.number,
.nightMode .token.constant,
.nightMode .token.symbol,
.nightMode .token.deleted {
  color: #fdba74;
}

.nightMode .token.selector,
.nightMode .token.attr-name,
.nightMode .token.string,
.nightMode .token.char,
.nightMode .token.builtin,
.nightMode .token.inserted {
  color: #86efac;
}

.nightMode .token.operator,
.nightMode .token.entity,
.nightMode .token.url,
.nightMode .language-css .token.string,
.nightMode .style .token.string {
  color: #5eead4;
}

.nightMode .token.atrule,
.nightMode .token.attr-value,
.nightMode .token.keyword {
  color: #c7d2fe;
}

.nightMode .token.function,
.nightMode .token.class-name {
  color: #7dd3fc;
}

.nightMode .token.regex,
.nightMode .token.important,
.nightMode .token.variable {
  color: #fcd34d;
}
`;

function utf8ToBase64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]!);
	}
	return btoa(binary);
}

/** Prepend stylesheet `<link>` once (Front / Back / reverse sides). */
export function ensureCodeHighlightStylesheetLink(html: string): string {
	const trimmed = html.trim();
	if (!trimmed) {
		return `${CODE_HIGHLIGHT_STYLESHEET_LINK}\n`;
	}
	if (trimmed.includes(CODE_HIGHLIGHT_CSS_FILENAME)) {
		return html;
	}
	return `${CODE_HIGHLIGHT_STYLESHEET_LINK}\n${html.replace(/^\s+/, '')}`;
}

export interface CodeHighlightLinkableStyle {
	front: string;
	back: string;
	reverseFront?: string;
	reverseBack?: string;
}

/** Ensure every template HTML side references the media stylesheet. */
export function withCodeHighlightLinks<T extends CodeHighlightLinkableStyle>(
	style: T,
): T {
	return {
		...style,
		front: ensureCodeHighlightStylesheetLink(style.front),
		back: ensureCodeHighlightStylesheetLink(style.back),
		reverseFront: ensureCodeHighlightStylesheetLink(
			style.reverseFront ?? '',
		),
		reverseBack: ensureCodeHighlightStylesheetLink(style.reverseBack ?? ''),
	};
}

export function codeHighlightCssBase64(): string {
	return utf8ToBase64(DTA_CODE_HIGHLIGHT_CSS);
}
