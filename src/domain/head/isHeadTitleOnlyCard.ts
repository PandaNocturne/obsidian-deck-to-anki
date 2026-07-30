import type { CardNode } from './types';

/**
 * Head card with only a heading and no body (and no --- split content).
 * These should stay unchecked for sync by default.
 */
export function isHeadTitleOnlyCard(card: CardNode): boolean {
	if (card.deckClass !== 'head') {
		return false;
	}
	if (card.back.trim() !== '') {
		return false;
	}
	const title = (card.navTitle ?? '').trim();
	const front = card.front.trim();
	// No ---: front is the heading. With ---: front may be empty or just the title.
	return front === '' || front === title;
}
