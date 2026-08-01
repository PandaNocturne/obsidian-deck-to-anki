/**
 * Prepare Obsidian `$` / `$$` math for Anki's built-in MathJax.
 *
 * Same idea as Obsidian-Anki-Sync / Obsidian_to_Anki:
 * convert dollar delimiters to `\(...\)` / `\[...\]` so Anki can typeset them.
 * Math is extracted before MarkdownRenderer so Obsidian's MathJax DOM
 * (which Anki cannot use) never enters the field HTML.
 */

export interface AnkiMathSlot {
	display: boolean;
	tex: string;
}

const FENCED_CODE_RE = /(`{3,})[^\n]*\n[\s\S]*?\1/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;

/** Display math: $$ ... $$ */
const DISPLAY_MATH_RE = /\$\$([\s\S]*?)\$\$/g;

/**
 * Inline math: $ ... $ (not $$).
 * Adapted from Pseudonium/Obsidian_to_Anki constants.
 */
const INLINE_MATH_RE =
	/(?<!\$)\$(?=[\S])(?=[^$])([\s\S]*?\S)\$/g;

const PLACEHOLDER_PREFIX = 'DTAANKIMATH';
const PLACEHOLDER_RE = /DTAANKIMATH(\d+)END/g;

function shieldSegments(
	text: string,
	pattern: RegExp,
	bucket: string[],
): string {
	return text.replace(pattern, (match) => {
		const index = bucket.length;
		bucket.push(match);
		return `\0SHIELD${index}\0`;
	});
}

function unshieldSegments(text: string, bucket: string[]): string {
	return text.replace(/\0SHIELD(\d+)\0/g, (_m, raw: string) => {
		return bucket[Number(raw)] ?? '';
	});
}

function placeholderFor(index: number): string {
	return `${PLACEHOLDER_PREFIX}${index}END`;
}

/** Escape tex so it survives as text inside HTML fields. */
function escapeTexForHtml(tex: string): string {
	return tex
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/**
 * Pull math out of markdown (skipping code), leave opaque placeholders.
 */
export function extractMathForAnki(markdown: string): {
	markdown: string;
	slots: AnkiMathSlot[];
} {
	const shields: string[] = [];
	let text = shieldSegments(markdown, FENCED_CODE_RE, shields);
	text = shieldSegments(text, INLINE_CODE_RE, shields);

	const slots: AnkiMathSlot[] = [];

	text = text.replace(DISPLAY_MATH_RE, (_m, tex: string) => {
		const index = slots.length;
		slots.push({ display: true, tex });
		return placeholderFor(index);
	});

	text = text.replace(INLINE_MATH_RE, (_m, tex: string) => {
		const index = slots.length;
		slots.push({ display: false, tex });
		return placeholderFor(index);
	});

	// Escape leftover `$` so Obsidian MathJax won't swallow the rest of the
	// line (e.g. unclosed `$ax^2 + bx + c`) and render an empty field.
	text = text.replace(/\$/g, '\\$');

	text = unshieldSegments(text, shields);
	return { markdown: text, slots };
}

/**
 * Replace placeholders in rendered HTML with Anki MathJax delimiters.
 */
export function injectAnkiMath(html: string, slots: AnkiMathSlot[]): string {
	if (slots.length === 0) {
		return html;
	}
	return html.replace(PLACEHOLDER_RE, (_m, raw: string) => {
		const slot = slots[Number(raw)];
		if (!slot) {
			return _m;
		}
		const tex = escapeTexForHtml(slot.tex.trim());
		return slot.display ? `\\[${tex}\\]` : `\\(${tex}\\)`;
	});
}
