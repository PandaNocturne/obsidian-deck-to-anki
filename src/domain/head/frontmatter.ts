import type { DeckType } from './types';

const FRONTMATTER_REGEXP = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
const DECK_TYPE_VALUES: DeckType[] = ['head', 'basic', 'file', 'list'];
const LEGACY_KEYS = new Set(['DECK TYPE', 'CARD LEVEL', 'ARCHIVED']);

export interface FrontmatterMeta {
	deckType?: DeckType;
	deckName?: string;
	deckLevel?: number;
	/** true = archived, false = learning/active. */
	deckStatus: boolean;
	/**
	 * Parent file index for nested notes under deckType:file.
	 * Normalized as `[[basename]]`.
	 */
	deckFile?: string;
	warnings: string[];
}

function parseBoolean(value: string): boolean | undefined {
	const normalized = value.toLowerCase();
	if (
		normalized === 'true' ||
		normalized === '1' ||
		normalized === 'yes' ||
		normalized === 'archived'
	) {
		return true;
	}
	if (
		normalized === 'false' ||
		normalized === '0' ||
		normalized === 'no' ||
		normalized === 'learning' ||
		normalized === 'active'
	) {
		return false;
	}
	return undefined;
}

/** Normalize YAML deckFile value to `[[basename]]` (no surrounding quotes). */
export function normalizeDeckFileLink(value: string): string | undefined {
	const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
	if (!trimmed) {
		return undefined;
	}
	const wiki = trimmed.match(/^\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]$/);
	const raw = (wiki?.[1] ?? trimmed).trim().replace(/\.md$/i, '');
	if (!raw) {
		return undefined;
	}
	// Obsidian short wikilink — never wrap with quotes in YAML.
	return `[[${raw}]]`;
}

export function formatDeckFileLink(filePathOrName: string): string {
	const base =
		filePathOrName.split(/[/\\]/).pop()?.replace(/\.md$/i, '') ??
		filePathOrName;
	return `[[${base.trim()}]]`;
}

/** Raw `deckFile` line value as written in YAML (may include quotes). */
function readRawDeckFileValue(content: string): string | undefined {
	const match = content.match(FRONTMATTER_REGEXP);
	if (!match?.[1]) {
		return undefined;
	}
	for (const rawLine of match[1].split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const colon = trimmed.indexOf(':');
		if (colon <= 0) {
			continue;
		}
		const key = trimmed.slice(0, colon).trim().replace(/^['"]|['"]$/g, '');
		if (key !== 'deckFile') {
			continue;
		}
		return trimmed.slice(colon + 1).trim();
	}
	return undefined;
}

export function parseFrontmatter(content: string): FrontmatterMeta {
	const warnings: string[] = [];
	const match = content.match(FRONTMATTER_REGEXP);
	if (!match?.[1]) {
		return { deckStatus: false, warnings };
	}

	const body = match[1];
	let deckType: DeckType | undefined;
	let deckName: string | undefined;
	let deckLevel: number | undefined;
	let deckStatus = false;
	let deckFile: string | undefined;

	for (const rawLine of body.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}

		const colon = line.indexOf(':');
		if (colon <= 0) {
			continue;
		}

		const key = line.slice(0, colon).trim().replace(/^['"]|['"]$/g, '');
		let value = line.slice(colon + 1).trim();
		value = value.replace(/^['"]|['"]$/g, '');

		if (key === 'deckType' || key === 'DECK TYPE') {
			const normalized = value.toLowerCase() as DeckType;
			if (DECK_TYPE_VALUES.includes(normalized)) {
				deckType = normalized;
			} else if (value) {
				warnings.push(`未知 deckType: ${value}`);
			}
		} else if (key === 'deckName') {
			if (value) {
				deckName = value;
			}
		} else if (key === 'deckLevel' || key === 'CARD LEVEL') {
			const level = Number(value);
			if (Number.isInteger(level) && level >= 1 && level <= 6) {
				deckLevel = level;
			} else if (value) {
				warnings.push(`无效 deckLevel: ${value}`);
			}
		} else if (key === 'deckStatus' || key === 'ARCHIVED') {
			const parsed = parseBoolean(value);
			if (parsed !== undefined) {
				deckStatus = parsed;
			} else if (value) {
				warnings.push(`无效 deckStatus: ${value}`);
			}
		} else if (key === 'deckFile') {
			const link = normalizeDeckFileLink(value);
			if (link) {
				deckFile = link;
			} else if (value) {
				warnings.push(`无效 deckFile: ${value}`);
			}
		}
	}

	return { deckType, deckName, deckLevel, deckStatus, deckFile, warnings };
}

export interface UpsertDeckYamlProps {
	deckType: DeckType;
	/** Empty/undefined removes deckName from YAML. */
	deckName?: string;
	/** Only written for head; omitted/removed otherwise. */
	deckLevel?: number;
	deckStatus: boolean;
	/**
	 * Parent index for file-mode children. `null` removes the key;
	 * omit to leave unchanged.
	 */
	deckFile?: string | null;
}

function applyFrontmatterUpdates(
	content: string,
	updates: Record<string, string>,
	removeKeys: Set<string>,
): string {
	const match = content.match(FRONTMATTER_REGEXP);
	if (!match) {
		const block = Object.entries(updates)
			.map(([key, value]) => `${key}: ${value}`)
			.join('\n');
		const prefix = content.startsWith('\uFEFF') ? '\uFEFF' : '';
		const body = content.replace(/^\uFEFF/, '');
		return `${prefix}---\n${block}\n---\n${body}`;
	}

	const fmBody = match[1] ?? '';
	const ending = match[2] ?? '\n';
	const lines = fmBody.length > 0 ? fmBody.split(/\r?\n/) : [];
	const seen = new Set<string>();
	const nextLines: string[] = [];

	for (const rawLine of lines) {
		const trimmed = rawLine.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			nextLines.push(rawLine);
			continue;
		}

		const colon = trimmed.indexOf(':');
		if (colon <= 0) {
			nextLines.push(rawLine);
			continue;
		}

		const key = trimmed.slice(0, colon).trim().replace(/^['"]|['"]$/g, '');
		if (removeKeys.has(key)) {
			continue;
		}
		if (key in updates) {
			nextLines.push(`${key}: ${updates[key]}`);
			seen.add(key);
		} else {
			nextLines.push(rawLine);
		}
	}

	for (const [key, value] of Object.entries(updates)) {
		if (!seen.has(key)) {
			nextLines.push(`${key}: ${value}`);
		}
	}

	const newFm = nextLines.join('\n');
	return content.replace(FRONTMATTER_REGEXP, `---\n${newFm}\n---${ending}`);
}

/** Insert or update camelCase YAML deck properties. */
export function upsertDeckYaml(
	content: string,
	props: UpsertDeckYamlProps,
): string {
	const updates: Record<string, string> = {
		deckType: props.deckType,
		deckStatus: props.deckStatus ? 'true' : 'false',
	};
	const trimmedName = props.deckName?.trim();
	if (trimmedName) {
		updates.deckName = trimmedName;
	}
	if (props.deckType === 'head' && props.deckLevel !== undefined) {
		updates.deckLevel = String(props.deckLevel);
	}

	const removeKeys = new Set<string>([...LEGACY_KEYS]);
	if (props.deckType !== 'head') {
		removeKeys.add('deckLevel');
	}
	if (!trimmedName) {
		removeKeys.add('deckName');
	}

	if (props.deckFile !== undefined) {
		if (props.deckFile === null || props.deckFile.trim() === '') {
			removeKeys.add('deckFile');
		} else {
			const link =
				normalizeDeckFileLink(props.deckFile) ??
				formatDeckFileLink(props.deckFile);
			updates.deckFile = link;
		}
	}

	return applyFrontmatterUpdates(content, updates, removeKeys);
}

/**
 * Ensure child note has unquoted `deckFile: [[parent]]` (Obsidian short wikilink).
 * Rewrites quoted forms like `deckFile: "[[parent]]"`.
 */
export function ensureDeckFileLink(
	content: string,
	parentFilePathOrName: string,
): string {
	const link = formatDeckFileLink(parentFilePathOrName);
	const raw = readRawDeckFileValue(content);
	// Exact unquoted short wikilink already present.
	if (raw === link) {
		return content;
	}
	return applyFrontmatterUpdates(content, { deckFile: link }, new Set());
}
