import { ItemView, WorkspaceLeaf } from 'obsidian';
import type DeckToAnkiPlugin from '../../../main';
import { ANKI_ICON_ID } from '../ankiIcon';
import { SyncPanelUI } from './SyncPanelModal';

export const SYNC_PANEL_VIEW_TYPE = 'deck-to-anki-sync-panel';

/**
 * Right-sidebar leaf hosting the Deck To Anki sync panel.
 */
export class SyncPanelView extends ItemView {
	private ui: SyncPanelUI | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: DeckToAnkiPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return SYNC_PANEL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Deck To Anki';
	}

	getIcon(): string {
		return ANKI_ICON_ID;
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass('dta-sync-view');
		this.ui = new SyncPanelUI(this.plugin, {
			showCancel: false,
			closeOnOpenSettings: false,
		});
		this.ui.mount(root);
	}

	async onClose(): Promise<void> {
		this.ui?.unmount();
		this.ui = null;
		this.contentEl.empty();
	}
}

/** Reveal an existing sync-panel leaf, or open one in the right sidebar. */
export async function openSyncPanelView(
	plugin: DeckToAnkiPlugin,
): Promise<void> {
	const { workspace } = plugin.app;
	const existing = workspace.getLeavesOfType(SYNC_PANEL_VIEW_TYPE);
	if (existing.length > 0) {
		const leaf = existing[0];
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
		return;
	}

	const leaf = workspace.getRightLeaf(false);
	if (!leaf) {
		return;
	}
	await leaf.setViewState({
		type: SYNC_PANEL_VIEW_TYPE,
		active: true,
	});
	workspace.revealLeaf(leaf);
}
