import { addIcon, Plugin } from 'obsidian';
import { registerCommands } from './src/commands/registerCommands';
import {
	DeckToAnkiSettingTab,
	mergeSettings,
	type DeckToAnkiSettings,
} from './src/settings';
import { ANKI_ICON_ID, ANKI_ICON_SVG } from './src/ui/ankiIcon';
import { openSyncPanel } from './src/ui/sync-panel/SyncPanelModal';

export default class DeckToAnkiPlugin extends Plugin {
	settings!: DeckToAnkiSettings;

	async onload() {
		await this.loadSettings();

		addIcon(ANKI_ICON_ID, ANKI_ICON_SVG);
		this.addRibbonIcon(ANKI_ICON_ID, 'Deck To Anki', () => {
			openSyncPanel(this);
		});

		registerCommands(this);
		this.addSettingTab(new DeckToAnkiSettingTab(this.app, this));
	}

	onunload() { }

	async loadSettings() {
		this.settings = mergeSettings(
			(await this.loadData()) as Partial<DeckToAnkiSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
