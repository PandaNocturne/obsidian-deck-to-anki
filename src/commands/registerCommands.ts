import type DeckToAnkiPlugin from '../../main';
import { openSyncPanel } from '../ui/sync-panel/SyncPanelModal';

export function registerCommands(plugin: DeckToAnkiPlugin): void {
	plugin.addCommand({
		id: 'open-anki-sync-panel',
		name: 'Deck To Anki',
		callback: () => openSyncPanel(plugin),
	});
}
