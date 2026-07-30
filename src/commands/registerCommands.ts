import type DeckToAnkiPlugin from '../../main';
import { openSyncPanel } from '../ui/sync-panel/SyncPanelModal';
import { openSyncPanelView } from '../ui/sync-panel/SyncPanelView';

export function registerCommands(plugin: DeckToAnkiPlugin): void {
	plugin.addCommand({
		id: 'open-anki-sync-sidebar',
		name: '打开同步侧边栏',
		callback: () => {
			void openSyncPanelView(plugin);
		},
	});

	plugin.addCommand({
		id: 'open-anki-sync-panel',
		name: 'Deck To Anki',
		callback: () => openSyncPanel(plugin),
	});
}
