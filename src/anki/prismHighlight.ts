/**
 * Sync-time Prism highlighting for Anki field HTML.
 *
 * Fenced blocks are extracted from markdown (like math slots) so we never
 * depend on Obsidian's code-block DOM / async highlighter classes.
 */

import { Prism } from './prismSetup';

// Language components (order matters for Prism `require` deps).
import 'prismjs/components/prism-markup.js';
import 'prismjs/components/prism-css.js';
import 'prismjs/components/prism-clike.js';
import 'prismjs/components/prism-javascript.js';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-jsx.js';
import 'prismjs/components/prism-tsx.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-yaml.js';
import 'prismjs/components/prism-markdown.js';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-shell-session.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-java.js';
import 'prismjs/components/prism-c.js';
import 'prismjs/components/prism-cpp.js';
import 'prismjs/components/prism-csharp.js';
import 'prismjs/components/prism-go.js';
import 'prismjs/components/prism-rust.js';
import 'prismjs/components/prism-sql.js';
import 'prismjs/components/prism-kotlin.js';
import 'prismjs/components/prism-swift.js';
// PHP requires markup-templating (tokenizePlaceholders) before prism-php.
import 'prismjs/components/prism-markup-templating.js';
import 'prismjs/components/prism-php.js';
import 'prismjs/components/prism-ruby.js';
import 'prismjs/components/prism-r.js';
import 'prismjs/components/prism-lua.js';
import 'prismjs/components/prism-diff.js';
import 'prismjs/components/prism-docker.js';
import 'prismjs/components/prism-powershell.js';

export interface AnkiCodeSlot {
	/** Prism grammar id, or empty when fence had no language. */
	lang: string;
	code: string;
}

const PLACEHOLDER_PREFIX = 'DTACODE';
const PLACEHOLDER_RE = /DTACODE(\d+)END/g;
const PLACEHOLDER_IN_P_RE = /<p>\s*DTACODE(\d+)END\s*<\/p>/gi;

/**
 * Fenced code: ```lang / ~~~lang … matching closer.
 * Captures info string + body (CommonMark-ish; same spirit as math shield).
 */
const FENCED_CODE_RE = /(`{3,}|~{3,})([^\n]*)\r?\n([\s\S]*?)\r?\n\1[ \t]*(?:\r?\n|$)/g;

/** Map common fence aliases (Obsidian / GitHub) to Prism grammar ids. */
const LANGUAGE_ALIASES: Record<string, string> = {
	js: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	ts: 'typescript',
	py: 'python',
	sh: 'bash',
	shell: 'bash',
	zsh: 'bash',
	console: 'shell-session',
	yml: 'yaml',
	md: 'markdown',
	html: 'markup',
	xml: 'markup',
	svg: 'markup',
	'c++': 'cpp',
	hpp: 'cpp',
	h: 'c',
	cs: 'csharp',
	'c#': 'csharp',
	rs: 'rust',
	kt: 'kotlin',
	dockerfile: 'docker',
	ps1: 'powershell',
	pwsh: 'powershell',
};

function normalizeLanguage(raw: string): string {
	const key = raw.trim().toLowerCase();
	if (!key) {
		return '';
	}
	return LANGUAGE_ALIASES[key] ?? key;
}

/** First token of fence info string (`python`, `js title="x"`, etc.). */
function languageFromInfoString(info: string): string {
	const trimmed = info.trim();
	if (!trimmed) {
		return '';
	}
	const token = trimmed.split(/[\s{:[{]/, 1)[0] ?? '';
	return normalizeLanguage(token);
}

function escapeHtmlText(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function placeholderFor(index: number): string {
	return `${PLACEHOLDER_PREFIX}${index}END`;
}

function resolveGrammar(
	lang: string,
): { id: string; grammar: Prism.Grammar } | null {
	if (!lang) {
		return null;
	}
	const grammar = Prism.languages[lang];
	if (grammar) {
		return { id: lang, grammar };
	}
	return null;
}

function renderCodeSlot(slot: AnkiCodeSlot): string {
	const resolved = resolveGrammar(slot.lang);
	let inner: string;
	if (resolved) {
		try {
			inner = Prism.highlight(slot.code, resolved.grammar, resolved.id);
		} catch (error) {
			console.warn(
				`[Deck To Anki] Prism highlight failed for language "${resolved.id}"`,
				error,
			);
			inner = escapeHtmlText(slot.code);
		}
	} else {
		inner = escapeHtmlText(slot.code);
	}

	const langClass = resolved ? `language-${resolved.id}` : '';
	const preClass = langClass ? `dta-code ${langClass}` : 'dta-code';
	const codeAttrs = langClass ? ` class="${langClass}"` : '';
	return `<pre class="${preClass}"><code${codeAttrs}>${inner}</code></pre>`;
}

/**
 * Pull fenced code out of markdown before Obsidian render; leave opaque placeholders.
 */
export function extractCodeForAnki(markdown: string): {
	markdown: string;
	slots: AnkiCodeSlot[];
} {
	const slots: AnkiCodeSlot[] = [];
	const text = markdown.replace(
		FENCED_CODE_RE,
		(_m, _fence: string, info: string, body: string) => {
			const index = slots.length;
			slots.push({
				lang: languageFromInfoString(info),
				code: body.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
			});
			return placeholderFor(index);
		},
	);
	return { markdown: text, slots };
}

/**
 * Replace code placeholders in rendered HTML with Prism-highlighted `<pre><code>`.
 */
export function injectAnkiCode(html: string, slots: AnkiCodeSlot[]): string {
	if (slots.length === 0) {
		return html;
	}

	const replaceIndex = (raw: string): string => {
		const slot = slots[Number(raw)];
		if (!slot) {
			return `${PLACEHOLDER_PREFIX}${raw}END`;
		}
		return renderCodeSlot(slot);
	};

	// Prefer replacing a wrapping <p> so we don't nest <pre> inside <p>.
	let out = html.replace(PLACEHOLDER_IN_P_RE, (_m, raw: string) =>
		replaceIndex(raw),
	);
	out = out.replace(PLACEHOLDER_RE, (_m, raw: string) => replaceIndex(raw));
	return out;
}

function languageFromClassList(el: Element): string | null {
	for (const cls of Array.from(el.classList)) {
		const match = /^(?:language|lang)-([\w#+.-]+)$/i.exec(cls);
		if (match?.[1]) {
			return normalizeLanguage(match[1]);
		}
	}
	return null;
}

function detectLanguage(codeEl: Element): string | null {
	const fromData =
		codeEl.getAttribute('data-language') ??
		codeEl.parentElement?.getAttribute('data-language');
	if (fromData) {
		return normalizeLanguage(fromData);
	}
	return (
		languageFromClassList(codeEl) ??
		(codeEl.parentElement
			? languageFromClassList(codeEl.parentElement)
			: null)
	);
}

/**
 * Fallback: highlight any remaining `pre > code` Obsidian left in the HTML
 * (e.g. non-fence paths). Prefer extractCodeForAnki + injectAnkiCode.
 */
export function highlightCodeInHtml(html: string): string {
	if (!html || !/<pre[\s>]/i.test(html)) {
		return html;
	}

	const host = document.createElement('div');
	host.innerHTML = html;

	host.querySelectorAll('pre code').forEach((codeEl) => {
		// Already Prism-tokenized from injectAnkiCode.
		if (codeEl.querySelector('.token')) {
			return;
		}

		const lang = detectLanguage(codeEl);
		if (!lang) {
			return;
		}

		const resolved = resolveGrammar(lang);
		if (!resolved) {
			return;
		}

		const source = codeEl.textContent ?? '';
		try {
			codeEl.innerHTML = Prism.highlight(
				source,
				resolved.grammar,
				resolved.id,
			);
		} catch (error) {
			console.warn(
				`[Deck To Anki] Prism highlight failed for language "${resolved.id}"`,
				error,
			);
			return;
		}

		const langClass = `language-${resolved.id}`;
		if (!codeEl.classList.contains(langClass)) {
			codeEl.classList.add(langClass);
		}
		const pre = codeEl.parentElement;
		if (pre?.tagName === 'PRE' && !pre.classList.contains(langClass)) {
			pre.classList.add(langClass);
		}
		pre?.classList.add('dta-code');
	});

	return host.innerHTML;
}
