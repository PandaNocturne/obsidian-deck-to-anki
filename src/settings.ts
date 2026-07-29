import { App, PluginSettingTab, Setting } from 'obsidian';
import type DeckToAnkiPlugin from '../main';
import type { DeckType } from './domain/head/types';

/** Sync tree deck lead icons. */
export type DeckTreeIconMode = 'unified' | 'byType';

export interface DeckToAnkiSettings {
	defaultDeckType: DeckType;
	cardHeadingLevel: number;
	includeFolders: string[];
	requireDeckTag: boolean;
	/**
	 * unified: all decks use circle +/- (collapsed +, expanded −).
	 * byType: file / heading / list icons; fold state by color.
	 */
	deckTreeIconMode: DeckTreeIconMode;
}

export const DEFAULT_SETTINGS: DeckToAnkiSettings = {
	defaultDeckType: 'head',
	cardHeadingLevel: 4,
	includeFolders: [],
	requireDeckTag: true,
	deckTreeIconMode: 'unified',
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
				'Default parse mode in the sync panel. Notes are always parsed from the active file; Update writes deckType to YAML.',
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('head', 'Head (heading mode)')
					.addOption('basic', 'Basic (separator mode)')
					.addOption('list', 'List (top-level list mode)')
					.addOption('file', 'File (linked-file mode)')
					.setValue(this.plugin.settings.defaultDeckType)
					.onChange(async (value) => {
						this.plugin.settings.defaultDeckType = value as DeckType;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Card heading level')
			.setDesc(
				'Heading level treated as card front in head mode. Default is level 4.',
			)
			.addDropdown((dropdown) => {
				for (let level = 1; level <= 6; level++) {
					dropdown.addOption(String(level), `H${level}`);
				}
				dropdown
					.setValue(String(this.plugin.settings.cardHeadingLevel))
					.onChange(async (value) => {
						this.plugin.settings.cardHeadingLevel = Number(value);
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Sync tree deck icons')
			.setDesc(
				'Top-level decks always use layers. Nested: Unified uses circle +/−; By type uses file / heading / list (fold by color).',
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('unified', 'Unified (+/−)')
					.addOption('byType', 'By file type')
					.setValue(this.plugin.settings.deckTreeIconMode)
					.onChange(async (value) => {
						this.plugin.settings.deckTreeIconMode =
							value as DeckTreeIconMode;
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl('p', {
			cls: 'deck-to-anki-settings-hint',
			text: 'Folder and tag scan settings come later. Notes use camelCase YAML: deckType, deckLevel, deckStatus.',
		});
	}
}
