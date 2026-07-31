import type { FrontmatterMeta } from '../domain/head/frontmatter';
import type { DeckToAnkiSettings } from '../settings';

export interface NumberingOptions {
	deckNumbering: boolean;
}

/**
 * Per-note YAML `deckNumbering` overrides plugin default when present.
 * Default: deck numbering on. Cards are never numbered.
 */
export function resolveNumberingOptions(
	meta: Pick<FrontmatterMeta, 'deckNumbering'>,
	settings: DeckToAnkiSettings,
): NumberingOptions {
	return {
		deckNumbering:
			meta.deckNumbering ?? settings.deckNumberingEnabled !== false,
	};
}
