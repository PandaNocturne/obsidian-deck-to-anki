import type { CardNode } from './types';

/**
 * Cards with an empty back stay unchecked for sync by default.
 * Users can still check them manually via the leaf checkbox.
 */
export function isEmptyBackCard(card: CardNode): boolean {
	return card.back.trim() === '';
}
