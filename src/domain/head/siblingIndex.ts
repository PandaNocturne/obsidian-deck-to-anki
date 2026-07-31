import type {
	CardNode,
	DeletedAnkiCardNode,
	DeckNode,
	SyncTreeChild,
} from './types';

/**
 * Assign 1-based sibling indexes under each deck:
 * - decks numbered among deck siblings
 * - cards / deleted phantoms numbered among leaf siblings
 * Also stores ancestor deck index path on cards for Anki prefixes.
 */
export function assignSiblingIndexes(root: DeckNode): void {
	const walk = (deck: DeckNode, ancestorDeckIndexes: number[]): void => {
		deck.deckIndexPath = [...ancestorDeckIndexes];
		let deckSibling = 0;
		let cardSibling = 0;
		for (const child of deck.children) {
			if (child.kind === 'deck') {
				deckSibling += 1;
				child.siblingIndex = deckSibling;
				walk(child, [...ancestorDeckIndexes, deckSibling]);
			} else {
				cardSibling += 1;
				child.siblingIndex = cardSibling;
				if (child.kind === 'card') {
					child.deckIndexPath = [...ancestorDeckIndexes];
				}
			}
		}
	};
	// Root itself is not numbered; its children start the path.
	root.siblingIndex = undefined;
	walk(root, []);
}

/** `1.2. ` from ancestor deck sibling indexes (cards themselves are not numbered). */
export function formatCardNumberPrefix(
	card: CardNode,
	options: { deckNumbering: boolean },
): string {
	if (!options.deckNumbering || !card.deckIndexPath?.length) {
		return '';
	}
	return `${card.deckIndexPath.join('.')}. `;
}

/** Prefix backlink crumb labels with deck sibling indexes when enabled. */
export function numberBacklinkSegmentNames(
	names: string[],
	deckIndexPath: number[] | undefined,
	deckNumbering: boolean,
): string[] {
	if (!deckNumbering || !deckIndexPath?.length) {
		return names;
	}
	// Trail often includes an unnumbered file root; align indexes to the end.
	const offset = Math.max(0, names.length - deckIndexPath.length);
	return names.map((name, i) => {
		const pathIdx = i - offset;
		const n = pathIdx >= 0 ? deckIndexPath[pathIdx] : undefined;
		if (n === undefined) {
			return name;
		}
		return `${n}. ${name}`;
	});
}

export function getSiblingIndex(
	node: DeckNode | CardNode | DeletedAnkiCardNode | SyncTreeChild,
): number | undefined {
	if (node.kind === 'deck' || node.kind === 'card' || node.kind === 'deleted-anki') {
		return node.siblingIndex;
	}
	return undefined;
}
