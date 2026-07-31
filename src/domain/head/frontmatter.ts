import {
	DECK_TEMPLATE_IDS,
	type DeckTemplateId,
} from '../../anki/templates';
import type { DeckType } from './types';

const FRONTMATTER_REGEXP = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
const DECK_TYPE_VALUES: DeckType[] = ['head', 'card', 'file', 'list'];

/** All YAML keys managed by this plugin. */
const ALL_DECK_YAML_KEYS = new Set([
	'deckType',
	'deckName',
	'deckLevel',
	'deckStatus',
	'deckFile',
	'deckTemplate',
	'deckNumbering',
	/** Legacy; removed from UI but still stripped when clearing deck YAML. */
	'cardNumbering',
]);

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
	/** Anki note type: ob-deck-basic | ob-deck-basic++ */
	deckTemplate?: DeckTemplateId;
	/** Sync deck sibling indexes into Anki front/tree. */
	deckNumbering?: boolean;
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

/** Normalize YAML deckFile value to logical `[[basename]]` (quotes stripped). */
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
	return `[[${raw}]]`;
}

/** Logical short wikilink `[[basename]]`. */
export function formatDeckFileLink(filePathOrName: string): string {
	const base =
		filePathOrName.split(/[/\\]/).pop()?.replace(/\.md$/i, '') ??
		filePathOrName;
	return `[[${base.trim()}]]`;
}

/** YAML line value: `"[[basename]]"`. */
export function formatDeckFileYamlValue(filePathOrName: string): string {
	return `"${formatDeckFileLink(filePathOrName)}"`;
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
	let deckTemplate: DeckTemplateId | undefined;
	let deckNumbering: boolean | undefined;

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

		if (key === 'deckType') {
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
		} else if (key === 'deckLevel') {
			const level = Number(value);
			if (Number.isInteger(level) && level >= 1 && level <= 6) {
				deckLevel = level;
			} else if (value) {
				warnings.push(`无效 deckLevel: ${value}`);
			}
		} else if (key === 'deckStatus') {
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
		} else if (key === 'deckTemplate') {
			if (DECK_TEMPLATE_IDS.includes(value as DeckTemplateId)) {
				deckTemplate = value as DeckTemplateId;
			} else if (value) {
				warnings.push(`未知 deckTemplate: ${value}`);
			}
		} else if (key === 'deckNumbering') {
			const parsed = parseBoolean(value);
			if (parsed !== undefined) {
				deckNumbering = parsed;
			} else if (value) {
				warnings.push(`无效 deckNumbering: ${value}`);
			}
		}
		// Legacy cardNumbering is ignored (cards are never numbered).
	}

	return {
		deckType,
		deckName,
		deckLevel,
		deckStatus,
		deckFile,
		deckTemplate,
		deckNumbering,
		warnings,
	};
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
	/** Anki note type written as YAML deckTemplate. `null` removes the key. */
	deckTemplate?: DeckTemplateId | null;
	/** Sync deck indexes. `null` removes the key (fall back to plugin default). */
	deckNumbering?: boolean | null;
}

function applyFrontmatterUpdates(
	content: string,
	updates: Record<string, string>,
	removeKeys: Set<string>,
): string {
	const match = content.match(FRONTMATTER_REGEXP);
	if (!match) {
		if (Object.keys(updates).length === 0) {
			return content;
		}
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

/** Remove empty `---\n---` frontmatter block left after clearing keys. */
function stripEmptyFrontmatter(content: string): string {
	const match = content.match(FRONTMATTER_REGEXP);
	if (!match) {
		return content;
	}
	const body = (match[1] ?? '').trim();
	if (body.length > 0) {
		return content;
	}
	const prefix = content.startsWith('\uFEFF') ? '\uFEFF' : '';
	return `${prefix}${content.replace(/^\uFEFF/, '').replace(FRONTMATTER_REGEXP, '')}`;
}

/**
 * Remove all deck-related YAML properties (deckType / deckName / deckLevel /
 * deckStatus / deckFile / deckTemplate / deckNumbering).
 * Drops empty frontmatter block.
 */
export function clearAllDeckYaml(content: string): string {
	const next = applyFrontmatterUpdates(
		content,
		{},
		new Set(ALL_DECK_YAML_KEYS),
	);
	return stripEmptyFrontmatter(next);
}

/** Remove only `deckFile` (keeps other deck YAML). */
export function removeDeckFileYaml(content: string): string {
	return stripEmptyFrontmatter(
		applyFrontmatterUpdates(content, {}, new Set(['deckFile'])),
	);
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

	const removeKeys = new Set<string>();
	if (props.deckType !== 'head') {
		removeKeys.add('deckLevel');
	}
	if (!trimmedName) {
		removeKeys.add('deckName');
	}

	if (props.deckTemplate !== undefined) {
		if (props.deckTemplate === null) {
			removeKeys.add('deckTemplate');
		} else {
			updates.deckTemplate = props.deckTemplate;
		}
	}

	if (props.deckNumbering !== undefined) {
		if (props.deckNumbering === null) {
			removeKeys.add('deckNumbering');
		} else {
			updates.deckNumbering = props.deckNumbering ? 'true' : 'false';
		}
	}

	if (props.deckFile !== undefined) {
		if (props.deckFile === null || props.deckFile.trim() === '') {
			removeKeys.add('deckFile');
		} else {
			const link =
				normalizeDeckFileLink(props.deckFile) ??
				formatDeckFileLink(props.deckFile);
			updates.deckFile = `"${link}"`;
		}
	}

	return applyFrontmatterUpdates(content, updates, removeKeys);
}

/**
 * Ensure child note has `deckFile: "[[parent]]"` (quoted Obsidian short wikilink).
 */
export function ensureDeckFileLink(
	content: string,
	parentFilePathOrName: string,
): string {
	const yamlValue = formatDeckFileYamlValue(parentFilePathOrName);
	const raw = readRawDeckFileValue(content);
	if (raw === yamlValue) {
		return content;
	}
	return applyFrontmatterUpdates(content, { deckFile: yamlValue }, new Set());
}
