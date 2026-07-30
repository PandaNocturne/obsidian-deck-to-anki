import { App, PluginSettingTab, Setting } from 'obsidian';
import type DeckToAnkiPlugin from '../main';
import type { DeckType } from './domain/head/types';

/** Fallback card heading level when YAML has no deckLevel. */
export const DEFAULT_CARD_HEADING_LEVEL = 4;

export interface DeckToAnkiSettings {
	defaultDeckType: DeckType;
	includeFolders: string[];
	requireDeckTag: boolean;
}

export const DEFAULT_SETTINGS: DeckToAnkiSettings = {
	defaultDeckType: 'head',
	includeFolders: [],
	requireDeckTag: true,
};

export class DeckToAnkiSettingTab extends PluginSettingTab {
	plugin: DeckToAnkiPlugin;

	constructor(app: App, plugin: DeckToAnkiPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Default deck mode')
			.setDesc(
				'Default parse mode in the sync panel. Notes are always parsed from the active file; Update writes deckType to YAML. Head notes set deckLevel in the note YAML settings.',
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('head', 'Head (heading mode)')
					.addOption('card', 'Card (separator mode)')
					.addOption('list', 'List (top-level list mode)')
					.addOption('file', 'File (linked-file mode)')
					.setValue(this.plugin.settings.defaultDeckType)
					.onChange(async (value) => {
						this.plugin.settings.defaultDeckType = value as DeckType;
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl('p', {
			cls: 'deck-to-anki-settings-hint',
			text: 'Folder and tag scan settings come later. Notes use camelCase YAML: deckType, deckName, deckLevel, deckStatus.',
		});
	}
}
