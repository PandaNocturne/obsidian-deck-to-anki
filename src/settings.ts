import { App, PluginSettingTab, Setting } from 'obsidian';
import type DeckToAnkiPlugin from '../main';
import type { DeckType } from './domain/head/types';

export interface DeckToAnkiSettings {
	defaultDeckType: DeckType;
	cardHeadingLevel: number;
	includeFolders: string[];
	requireDeckTag: boolean;
}

export const DEFAULT_SETTINGS: DeckToAnkiSettings = {
	defaultDeckType: 'head',
	cardHeadingLevel: 4,
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
				'Fallback when the note has no deck type in YAML. Sync panel currently supports head only.',
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('head', 'Head (heading mode)')
					.addOption('basic', 'Basic (separator mode)')
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

		containerEl.createEl('p', {
			cls: 'deck-to-anki-settings-hint',
			text: 'Folder and tag scan settings come later. Notes use uppercase YAML properties for deck type and archived.',
		});
	}
}
