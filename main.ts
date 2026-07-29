import { Plugin } from 'obsidian';
import { registerCommands } from './src/commands/registerCommands';
import {
	DEFAULT_SETTINGS,
	DeckToAnkiSettingTab,
	type DeckToAnkiSettings,
} from './src/settings';
import { openSyncPanel } from './src/ui/sync-panel/SyncPanelModal';

export default class DeckToAnkiPlugin extends Plugin {
	settings!: DeckToAnkiSettings;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('layers', 'Deck To Anki Sync', () => {
			openSyncPanel(this);
		});

		registerCommands(this);
		this.addSettingTab(new DeckToAnkiSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<DeckToAnkiSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
