import type {
	CardNode,
	DeckNode,
	DeckType,
	ParsedHeadFile,
} from '../../domain/head/types';

export type SyncPanelTab = 'current' | 'all' | 'archived';

export class SyncPanelState {
	readonly selected = new Set<string>();
	readonly collapsed = new Set<string>();
	tab: SyncPanelTab = 'current';
	/** Panel parse mode; defaults to head. */
	parseType: DeckType = 'head';
	/** Active card heading level for parse. */
	cardLevel = 4;
	private root: DeckNode | null = null;

	resetFromTree(root: DeckNode, options?: { parseType?: DeckType; cardLevel?: number }): void {
		this.root = root;
		if (options?.parseType) {
			this.parseType = options.parseType;
		}
		if (options?.cardLevel !== undefined) {
			this.cardLevel = options.cardLevel;
		}
		this.selected.clear();
		this.collapsed.clear();
		this.selectAll(root);
		this.collapseAllExceptRoot(root);
	}

	/** @deprecated Prefer resetFromTree for multi-file views. */
	resetFromParsed(parsed: ParsedHeadFile): void {
		this.resetFromTree(parsed.root, {
			parseType: parsed.deckType,
			cardLevel: parsed.deckLevel,
		});
	}

	private selectAll(node: DeckNode | CardNode): void {
		this.selected.add(node.id);
		if (node.kind === 'deck') {
			for (const child of node.children) {
				this.selectAll(child);
			}
		}
	}

	private collapseAllExceptRoot(root: DeckNode): void {
		const walk = (node: DeckNode, isRoot: boolean) => {
			if (!isRoot) {
				this.collapsed.add(node.id);
			}
			for (const child of node.children) {
				if (child.kind === 'deck') {
					walk(child, false);
				}
			}
		};
		walk(root, true);
	}

	expandAll(): void {
		this.collapsed.clear();
	}

	collapseAll(): void {
		if (!this.root) {
			return;
		}
		this.collapsed.clear();
		this.collapseAllExceptRoot(this.root);
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
				this.setSelectedCascade(child, selected);
			}
		}
	}
}
