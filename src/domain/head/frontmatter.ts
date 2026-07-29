import type { DeckType } from './types';

const FRONTMATTER_REGEXP = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
const DECK_TYPE_VALUES: DeckType[] = ['head', 'basic', 'file'];
const LEGACY_KEYS = new Set(['DECK TYPE', 'CARD LEVEL', 'ARCHIVED']);

export interface FrontmatterMeta {
	deckType?: DeckType;
	deckName?: string;
	deckLevel?: number;
	/** true = archived, false = learning/active. */
	deckStatus: boolean;
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
		}
	}

	return { deckType, deckName, deckLevel, deckStatus, warnings };
}

export interface UpsertDeckYamlProps {
	deckType: DeckType;
	/** Empty/undefined removes deckName from YAML. */
	deckName?: string;
	/** Only written for head; omitted/removed otherwise. */
	deckLevel?: number;
	deckStatus: boolean;
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
