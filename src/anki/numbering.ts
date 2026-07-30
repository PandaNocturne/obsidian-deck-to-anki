import type { FrontmatterMeta } from '../domain/head/frontmatter';
import type { DeckToAnkiSettings } from '../settings';

export interface NumberingOptions {
	deckNumbering: boolean;
	cardNumbering: boolean;
}

/**
 * Per-note YAML overrides plugin defaults when the key is present.
 * Default: deck numbering on, card numbering off.
 */
export function resolveNumberingOptions(
	meta: Pick<FrontmatterMeta, 'deckNumbering' | 'cardNumbering'>,
	settings: DeckToAnkiSettings,
): NumberingOptions {
	return {
		deckNumbering:
			meta.deckNumbering ?? settings.deckNumberingEnabled !== false,
		cardNumbering:
			meta.cardNumbering ?? settings.cardNumberingEnabled === true,
	};
}
