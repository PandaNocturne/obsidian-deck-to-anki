import type { CardNode, DeckNode, ParsedHeadFile } from '../../domain/head/types';

export type SyncPanelTab = 'learning' | 'archived';

export class SyncPanelState {
	readonly selected = new Set<string>();
	readonly collapsed = new Set<string>();
	tab: SyncPanelTab = 'learning';
	private root: DeckNode | null = null;

	resetFromParsed(parsed: ParsedHeadFile): void {
		this.root = parsed.root;
		this.selected.clear();
		this.collapsed.clear();
		this.selectAll(parsed.root);
		this.collapseAllExceptRoot(parsed.root);
		this.tab = parsed.archived ? 'archived' : 'learning';
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
