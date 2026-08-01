import type DeckToAnkiPlugin from '../../main';
import { openSyncPanel } from '../ui/sync-panel/SyncPanelModal';
import { openSyncPanelView } from '../ui/sync-panel/SyncPanelView';
import {
	clearCurrentFileDeckIds,
	clearCurrentFileDeckIdsAndYaml,
} from './clearDeckIds';

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

	plugin.addCommand({
		id: 'clear-current-file-deck-ids',
		name: '清空当前文件所有 deckID',
		callback: () => {
			void clearCurrentFileDeckIds(plugin);
		},
	});

	plugin.addCommand({
		id: 'clear-current-file-deck-ids-and-yaml',
		name: '清空当前文件所有 deckID 和 deck YAML',
		callback: () => {
			void clearCurrentFileDeckIdsAndYaml(plugin);
		},
	});
}
