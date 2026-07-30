import { isHeadTitleOnlyCard } from '../../domain/head/isHeadTitleOnlyCard';
import type {
	CardNode,
	DeckNode,
	DeckType,
	ParsedHeadFile,
} from '../../domain/head/types';

export type SyncPanelTab = 'current' | 'all' | 'archived';

export type SyncCheckState = 'checked' | 'unchecked' | 'indeterminate';

export class SyncPanelState {
	readonly selected = new Set<string>();
	readonly collapsed = new Set<string>();
	tab: SyncPanelTab = 'current';
	/** Panel parse mode; defaults to head. */
	parseType: DeckType = 'head';
	/** Active card heading level for parse. */
	cardLevel = 4;
	private root: DeckNode | null = null;

	resetFromTree(
		root: DeckNode,
		options?: {
			parseType?: DeckType;
			cardLevel?: number;
			/** When set, only this subtree is checked (not the whole tree). */
			selectOnly?: DeckNode | CardNode;
		},
	): void {
		this.root = root;
		if (options?.parseType) {
			this.parseType = options.parseType;
		}
		if (options?.cardLevel !== undefined) {
			this.cardLevel = options.cardLevel;
		}
		this.selected.clear();
		this.collapsed.clear();
		this.collapseAllDecks(root);

		if (options?.selectOnly) {
			// Keep the tree collapsed; only pre-check the focus subtree.
			this.selectAll(options.selectOnly);
		} else {
			this.selectAll(root);
		}
	}

	/** @deprecated Prefer resetFromTree for multi-file views. */
	resetFromParsed(parsed: ParsedHeadFile): void {
		this.resetFromTree(parsed.root, {
			parseType: parsed.deckType,
			cardLevel: parsed.deckLevel,
		});
	}

	private selectAll(node: DeckNode | CardNode): void {
		// Head cards with only a title (no body) stay unchecked by default.
		if (node.kind === 'card' && isHeadTitleOnlyCard(node)) {
			return;
		}
		this.selected.add(node.id);
		if (node.kind === 'deck') {
			for (const child of node.children) {
				this.selectAll(child);
			}
		}
	}

	private collapseAllDecks(root: DeckNode): void {
		const walk = (node: DeckNode) => {
			this.collapsed.add(node.id);
			for (const child of node.children) {
				if (child.kind === 'deck') {
					walk(child);
				}
			}
		};
		walk(root);
	}

	private collectCards(deck: DeckNode): CardNode[] {
		const out: CardNode[] = [];
		for (const child of deck.children) {
			if (child.kind === 'card') {
				out.push(child);
			} else {
				out.push(...this.collectCards(child));
			}
		}
		return out;
	}

	/**
	 * Checkbox visual state. Decks derive from descendant cards so a parent
	 * is not shown as fully checked when some children are unchecked.
	 */
	getCheckState(node: DeckNode | CardNode): SyncCheckState {
		if (node.kind === 'card') {
			return this.selected.has(node.id) ? 'checked' : 'unchecked';
		}

		const cards = this.collectCards(node);
		if (cards.length === 0) {
			return this.selected.has(node.id) ? 'checked' : 'unchecked';
		}

		let selectedCount = 0;
		for (const card of cards) {
			if (this.selected.has(card.id)) {
				selectedCount += 1;
			}
		}
		if (selectedCount === 0) {
			return 'unchecked';
		}
		if (selectedCount === cards.length) {
			return 'checked';
		}
		return 'indeterminate';
	}

	expandAll(): void {
		this.collapsed.clear();
	}

	collapseAll(): void {
		if (!this.root) {
			return;
		}
		this.collapsed.clear();
		this.collapseAllDecks(this.root);
	}

	isSelected(id: string): boolean {
		return this.selected.has(id);
	}

	isCollapsed(id: string): boolean {
		return this.collapsed.has(id);
	}

	toggleCollapsed(id: string): void {
		if (this.collapsed.has(id)) {
			this.collapsed.delete(id);
		} else {
			this.collapsed.add(id);
		}
	}

	setSelectedCascade(node: DeckNode | CardNode, selected: boolean): void {
		if (selected) {
			this.selected.add(node.id);
		} else {
			this.selected.delete(node.id);
		}

		if (node.kind === 'deck') {
			for (const child of node.children) {
				// Parent check should not force-select empty head titles.
				if (
					selected &&
					child.kind === 'card' &&
					isHeadTitleOnlyCard(child)
				) {
					this.selected.delete(child.id);
					continue;
				}
				this.setSelectedCascade(child, selected);
			}
		}
	}
}
