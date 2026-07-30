import { addIcon, Plugin } from 'obsidian';
import { registerCommands } from './src/commands/registerCommands';
import {
	DeckToAnkiSettingTab,
	mergeSettings,
	type DeckToAnkiSettings,
} from './src/settings';
import { ANKI_ICON_ID, ANKI_ICON_SVG } from './src/ui/ankiIcon';
import {
	openSyncPanelView,
	SYNC_PANEL_VIEW_TYPE,
	SyncPanelView,
} from './src/ui/sync-panel/SyncPanelView';

export default class DeckToAnkiPlugin extends Plugin {
	settings!: DeckToAnkiSettings;

	async onload() {
		await this.loadSettings();

		addIcon(ANKI_ICON_ID, ANKI_ICON_SVG);

		this.registerView(
			SYNC_PANEL_VIEW_TYPE,
			(leaf) => new SyncPanelView(leaf, this),
		);

		this.addRibbonIcon(ANKI_ICON_ID, 'Deck To Anki', () => {
			void openSyncPanelView(this);
		});

		registerCommands(this);
		this.addSettingTab(new DeckToAnkiSettingTab(this.app, this));
	}

	onunload() { }

	async loadSettings() {
		const raw = (await this.loadData()) as Partial<DeckToAnkiSettings> | null;
		this.settings = mergeSettings(raw);
		// Persist one-time built-in style upgrades.
		if (
			(raw?.deckTemplateStyleVersion ?? 0) <
			this.settings.deckTemplateStyleVersion
		) {
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
