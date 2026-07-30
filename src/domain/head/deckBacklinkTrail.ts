import type { CardNode, DeckBacklinkSegment } from './types';

/** Build trail from a same-file deck path stack (root + nested headings). */
export function trailFromPathStack(
	pathStack: string[],
	sourceFilePath: string,
): DeckBacklinkSegment[] {
	return pathStack
		.map((name) => name.trim())
		.filter(Boolean)
		.map((name, index) => ({
			name,
			sourceFilePath,
			headingTarget: index > 0,
		}));
}

/**
 * Fallback when builders did not attach a trail (older nodes / edge paths).
 * Assumes every segment after the first is a heading in the card's file.
 */
export function trailFromDeckPath(
	deckPath: string,
	sourceFilePath: string,
): DeckBacklinkSegment[] {
	return trailFromPathStack(deckPath.split('::'), sourceFilePath);
}

export function resolveCardBacklinkTrail(card: CardNode): DeckBacklinkSegment[] {
	if (card.deckBacklinkTrail && card.deckBacklinkTrail.length > 0) {
		return card.deckBacklinkTrail;
	}
	return trailFromDeckPath(card.deckPath, card.sourceFilePath ?? '');
}
