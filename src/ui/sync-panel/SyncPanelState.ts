import { isEmptyBackCard } from '../../domain/head/isEmptyBackCard';
import type {
	CardNode,
	DeletedAnkiCardNode,
	DeckNode,
	DeckType,
	ParsedHeadFile,
} from '../../domain/head/types';
import {
	cardIdentityKeys,
	deletedIdentityKey,
} from '../../anki/syncStatus';

export type SyncPanelTab = 'current' | 'all' | 'archived';

export type SyncCheckState = 'checked' | 'unchecked' | 'indeterminate';

export type SyncSelectableNode = DeckNode | CardNode | DeletedAnkiCardNode;

export class SyncPanelState {
	readonly selected = new Set<string>();
	readonly collapsed = new Set<string>();
	tab: SyncPanelTab = 'current';
	/** Panel parse mode; defaults to head. */
	parseType: DeckType = 'head';
	/** Active card heading level for parse. */
	cardLevel = 4;
	/** When true, deleted phantoms are included in select-all / auto-select. */
	autoSelectDeleted = true;
	private root: DeckNode | null = null;

	resetFromTree(
		root: DeckNode,
		options?: {
			parseType?: DeckType;
			cardLevel?: number;
			/** When set, only this subtree is checked (not the whole tree). */
			selectOnly?: SyncSelectableNode;
			/** Leave every checkbox unchecked (e.g. all-cards forest tab). */
			selectNone?: boolean;
			/** Keep which decks were expanded across re-parse / sync reload. */
			preserveCollapse?: boolean;
		},
	): void {
		const expandedIds = options?.preserveCollapse
			? this.snapshotExpandedDeckIds()
			: null;

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

		if (expandedIds && expandedIds.size > 0) {
			for (const id of expandedIds) {
				this.collapsed.delete(id);
			}
		}

		if (options?.selectNone) {
			return;
		}
		if (options?.selectOnly) {
			this.selectAll(options.selectOnly);
		} else {
			this.selectAll(root);
		}
	}

	/** Deck ids that are currently expanded (not in collapsed set). */
	private snapshotExpandedDeckIds(): Set<string> {
		const out = new Set<string>();
		if (!this.root) {
			return out;
		}
		const walk = (node: DeckNode) => {
			if (!this.collapsed.has(node.id)) {
				out.add(node.id);
			}
			for (const child of node.children) {
				if (child.kind === 'deck') {
					walk(child);
				}
			}
		};
		walk(this.root);
		return out;
	}

	/** @deprecated Prefer resetFromTree for multi-file views. */
	resetFromParsed(parsed: ParsedHeadFile): void {
		this.resetFromTree(parsed.root, {
			parseType: parsed.deckType,
			cardLevel: parsed.deckLevel,
		});
	}

	private shouldSelectLeaf(
		node: CardNode | DeletedAnkiCardNode,
	): boolean {
		if (node.kind === 'deleted-anki') {
			return this.autoSelectDeleted;
		}
		// Empty-back cards stay unchecked after parse.
		if (node.kind === 'card' && isEmptyBackCard(node)) {
			return false;
		}
		return true;
	}

	/** Check every deleted phantom under the tree (does not clear other selection). */
	selectDeletedPhantoms(root: DeckNode): void {
		const walk = (node: DeckNode) => {
			for (const child of node.children) {
				if (child.kind === 'deleted-anki') {
					this.selected.add(child.id);
				} else if (child.kind === 'deck') {
					walk(child);
				}
			}
		};
		walk(root);
	}

	private selectAll(node: SyncSelectableNode): void {
		if (node.kind === 'card' || node.kind === 'deleted-anki') {
			if (!this.shouldSelectLeaf(node)) {
				return;
			}
			this.selected.add(node.id);
			return;
		}

		this.selected.add(node.id);
		for (const child of node.children) {
			this.selectAll(child);
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

	private collectLeaves(
		deck: DeckNode,
	): Array<CardNode | DeletedAnkiCardNode> {
		const out: Array<CardNode | DeletedAnkiCardNode> = [];
		for (const child of deck.children) {
			if (child.kind === 'card' || child.kind === 'deleted-anki') {
				out.push(child);
			} else {
				out.push(...this.collectLeaves(child));
			}
		}
		return out;
	}

	/**
	 * Checkbox visual state. Decks derive from descendant leaves so a parent
	 * is not shown as fully checked when some children are unchecked.
	 */
	getCheckState(node: SyncSelectableNode): SyncCheckState {
		if (node.kind === 'card' || node.kind === 'deleted-anki') {
			return this.selected.has(node.id) ? 'checked' : 'unchecked';
		}

		const leaves = this.collectLeaves(node);
		if (leaves.length === 0) {
			return this.selected.has(node.id) ? 'checked' : 'unchecked';
		}

		let selectedCount = 0;
		for (const leaf of leaves) {
			if (this.selected.has(leaf.id)) {
				selectedCount += 1;
			}
		}
		if (selectedCount === 0) {
			return 'unchecked';
		}
		if (selectedCount === leaves.length) {
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

	/** True when every deck row is expanded. */
	areAllExpanded(): boolean {
		if (!this.root) {
			return true;
		}
		let all = true;
		const walk = (node: DeckNode) => {
			if (this.collapsed.has(node.id)) {
				all = false;
				return;
			}
			for (const child of node.children) {
				if (child.kind === 'deck') {
					walk(child);
				}
			}
		};
		walk(this.root);
		return all;
	}

	deselectAll(): void {
		this.selected.clear();
	}

	/** True when every selectable leaf is checked. */
	areAllLeavesSelected(): boolean {
		if (!this.root) {
			return false;
		}
		const leaves = this.collectLeaves(this.root).filter((leaf) =>
			this.shouldSelectLeaf(leaf),
		);
		if (leaves.length === 0) {
			return false;
		}
		return leaves.every((leaf) => this.selected.has(leaf.id));
	}

	/** Select all selectable leaves under the current root. */
	selectAllVisible(): void {
		if (!this.root) {
			return;
		}
		this.selected.clear();
		this.selectAll(this.root);
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

	setSelectedCascade(node: SyncSelectableNode, selected: boolean): void {
		if (node.kind === 'card' || node.kind === 'deleted-anki') {
			if (selected && !this.shouldSelectLeaf(node) && node.kind === 'card') {
				// Allow explicit user check of empty-back cards via leaf click.
				this.selected.add(node.id);
				return;
			}
			if (selected) {
				this.selected.add(node.id);
			} else {
				this.selected.delete(node.id);
			}
			return;
		}

		if (selected) {
			this.selected.add(node.id);
		} else {
			this.selected.delete(node.id);
		}

		for (const child of node.children) {
			if (
				selected &&
				child.kind === 'card' &&
				isEmptyBackCard(child)
			) {
				this.selected.delete(child.id);
				continue;
			}
			this.setSelectedCascade(child, selected);
		}
	}

	/** Re-apply default selection (empty-back cards still skipped). */
	reselectByStatus(root: DeckNode): void {
		this.root = root;
		this.selected.clear();
		this.selectAll(root);
	}

	/**
	 * Restore leaf checkboxes by identity keys (survives re-parse).
	 * Deck rows derive checked/indeterminate from leaves.
	 */
	restoreLeafSelection(root: DeckNode, selectedKeys: Iterable<string>): void {
		this.root = root;
		const want = new Set(selectedKeys);
		this.selected.clear();

		const walk = (node: DeckNode) => {
			for (const child of node.children) {
				if (child.kind === 'card') {
					if (cardIdentityKeys(child).some((k) => want.has(k))) {
						this.selected.add(child.id);
					}
				} else if (child.kind === 'deleted-anki') {
					if (want.has(deletedIdentityKey(child))) {
						this.selected.add(child.id);
					}
				} else {
					walk(child);
				}
			}
		};
		walk(root);
	}

	/** Snapshot checkbox / collapse ids for tab cache (same tree instance). */
	snapshotSelectionIds(): string[] {
		return [...this.selected];
	}

	snapshotCollapsedIds(): string[] {
		return [...this.collapsed];
	}

	/** Restore a previously cached tree without re-selecting defaults. */
	restoreUiSnapshot(
		root: DeckNode,
		selectedIds: Iterable<string>,
		collapsedIds: Iterable<string>,
	): void {
		this.root = root;
		this.selected.clear();
		for (const id of selectedIds) {
			this.selected.add(id);
		}
		this.collapsed.clear();
		for (const id of collapsedIds) {
			this.collapsed.add(id);
		}
	}
}
