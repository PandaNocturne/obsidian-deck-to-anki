import { App, PluginSettingTab, Setting } from 'obsidian';
import type DeckToAnkiPlugin from '../main';
import type { DeckType } from './domain/head/types';

/** Fallback when settings / YAML have no deckLevel. */
export const DEFAULT_CARD_HEADING_LEVEL = 4;

export interface DeckToAnkiSettings {
	defaultDeckType: DeckType;
	/** Default heading level treated as card front in head mode (YAML deckLevel). */
	cardHeadingLevel: number;
	/**
	 * Head mode with --- separator: when true, card front includes the heading text.
	 * Default false — front is only the body above ---.
	 */
	headIncludeTitleInFront: boolean;
	includeFolders: string[];
	requireDeckTag: boolean;
}

export const DEFAULT_SETTINGS: DeckToAnkiSettings = {
	defaultDeckType: 'head',
	cardHeadingLevel: DEFAULT_CARD_HEADING_LEVEL,
	headIncludeTitleInFront: false,
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
				'Default parse mode in the sync panel. Notes are always parsed from the active file; Update writes deckType to YAML.',
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('file', 'File (linked-file mode)')
					.addOption('head', 'Head (heading mode)')
					.addOption('list', 'List (top-level list mode)')
					.addOption('card', 'Card (separator mode)')
					.setValue(this.plugin.settings.defaultDeckType)
					.onChange(async (value) => {
						this.plugin.settings.defaultDeckType = value as DeckType;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Default heading level')
			.setDesc(
				'Default card heading level for head mode when the note has no deckLevel in YAML. Notes can still override via YAML settings.',
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
			.setName('Include heading in front')
			.setDesc(
				'Head mode: when a card block contains ---, put the heading into the card front as well. Off by default — front is only the text above ---.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.headIncludeTitleInFront)
					.onChange(async (value) => {
						this.plugin.settings.headIncludeTitleInFront = value;
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl('p', {
			cls: 'deck-to-anki-settings-hint',
			text: 'Folder and tag scan settings come later. Notes use camelCase YAML: deckType, deckName, deckLevel, deckStatus.',
		});
	}
}
