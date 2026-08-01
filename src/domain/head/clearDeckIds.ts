import { clearAllDeckYaml, removeDeckIdYaml } from './frontmatter';
import { ID_MARKER_REGEXP } from './idMarker';

const FRONTMATTER_REGEXP = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
/** Trailing numeric Obsidian block id used as Anki note id on list lines. */
const TRAILING_NUMERIC_BLOCK_ID_REGEXP = /\s*\^[1-9]\d*\s*$/;

function splitFrontmatter(content: string): {
	prefix: string;
	body: string;
} {
	const match = content.match(FRONTMATTER_REGEXP);
	if (!match || match.index === undefined) {
		return { prefix: '', body: content };
	}
	const end = match.index + match[0].length;
	return {
		prefix: content.slice(0, end),
		body: content.slice(end),
	};
}

/**
 * Strip Anki id markers from the note body:
 * - whole-line `<!--ID: n-->` (and a blank spacer line above)
 * - trailing numeric `^n` block ids on any line
 */
export function stripBodyDeckIdMarkers(content: string): string {
	const { prefix, body } = splitFrontmatter(content);
	const newline = body.includes('\r\n') ? '\r\n' : '\n';
	const lines = body.split(/\r?\n/);
	let changed = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const next = line.replace(TRAILING_NUMERIC_BLOCK_ID_REGEXP, '');
		if (next !== line) {
			lines[i] = next.replace(/\s+$/g, '');
			changed = true;
		}
	}

	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i] ?? '';
		if (!ID_MARKER_REGEXP.test(line)) {
			continue;
		}
		lines.splice(i, 1);
		changed = true;
		if (i - 1 >= 0 && !(lines[i - 1] ?? '').trim()) {
			lines.splice(i - 1, 1);
		}
	}

	if (!changed) {
		return content;
	}
	return `${prefix}${lines.join(newline)}`;
}

/** Clear YAML deckID / deckId plus body `<!--ID-->` and numeric `^id`. */
export function clearDeckIdsFromContent(content: string): string {
	return stripBodyDeckIdMarkers(removeDeckIdYaml(content));
}

/**
 * Clear all plugin deck YAML plus body `<!--ID-->` and numeric `^id`.
 */
export function clearDeckIdsAndYamlFromContent(content: string): string {
	return stripBodyDeckIdMarkers(clearAllDeckYaml(content));
}
