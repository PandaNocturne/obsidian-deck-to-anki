import { Modal, Notice, Setting, TFile } from 'obsidian';
import type DeckToAnkiPlugin from '../../../main';
import { upsertDeckYaml } from '../../domain/head/frontmatter';
import type { DeckType } from '../../domain/head/types';

export interface FileDeckSettingsValues {
	deckType: DeckType;
	deckName: string;
	deckLevel: number;
	deckStatus: boolean;
}

export class FileDeckSettingsModal extends Modal {
	private readonly file: TFile;
	private readonly onSaved: () => void | Promise<void>;
	private draft: FileDeckSettingsValues;

	constructor(
		plugin: DeckToAnkiPlugin,
		file: TFile,
		initial: FileDeckSettingsValues,
		onSaved: () => void | Promise<void>,
	) {
		super(plugin.app);
		this.file = file;
		this.onSaved = onSaved;
		this.draft = { ...initial };
	}

	onOpen(): void {
		this.modalEl.addClass('dta-file-settings-modal');
		this.titleEl.setText('Deck YAML settings');
		this.renderForm();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderForm(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('p', {
			cls: 'dta-file-settings-hint',
			text: 'Stored as camelCase YAML: deckType, deckName, deckLevel (head only), deckStatus.',
		});

		new Setting(contentEl)
			.setName('Deck type')
			.setDesc('YAML: deckType')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('head', 'Head')
					.addOption('basic', 'Basic')
					.addOption('file', 'File')
					.setValue(this.draft.deckType)
					.onChange((value) => {
						this.draft.deckType = value as DeckType;
						this.renderForm();
					}),
			);

		new Setting(contentEl)
			.setName('Deck name')
			.setDesc(
				'YAML: deckName (empty uses formatted file name without date prefix)',
			)
			.addText((text) =>
				text
					.setPlaceholder('Formatted file name')
					.setValue(this.draft.deckName)
					.onChange((value) => {
						this.draft.deckName = value;
					}),
			);

		if (this.draft.deckType === 'head') {
			new Setting(contentEl)
				.setName('Deck level')
				.setDesc('YAML: deckLevel (heading level for cards)')
				.addDropdown((dropdown) => {
					for (let level = 1; level <= 6; level++) {
						dropdown.addOption(String(level), `H${level}`);
					}
					dropdown
						.setValue(String(this.draft.deckLevel))
						.onChange((value) => {
							this.draft.deckLevel = Number(value);
						});
				});
		}

		new Setting(contentEl)
			.setName('Deck status')
			.setDesc('YAML: deckStatus (true = archived, false = learning)')
			.addToggle((toggle) =>
				toggle.setValue(this.draft.deckStatus).onChange((value) => {
					this.draft.deckStatus = value;
				}),
			);

		const actions = contentEl.createDiv({ cls: 'dta-file-settings-actions' });
		const cancelBtn = actions.createEl('button', {
			cls: 'dta-sync-footer-btn',
			text: 'Cancel',
		});
		cancelBtn.addEventListener('click', () => this.close());

		const saveBtn = actions.createEl('button', {
			cls: 'dta-sync-footer-btn mod-cta',
			text: 'Save',
		});
		saveBtn.addEventListener('click', () => {
			void this.save();
		});
	}

	private async save(): Promise<void> {
		const content = await this.app.vault.read(this.file);
		const next = upsertDeckYaml(content, {
			deckType: this.draft.deckType,
			deckName: this.draft.deckName,
			deckLevel:
				this.draft.deckType === 'head' ? this.draft.deckLevel : undefined,
			deckStatus: this.draft.deckStatus,
		});

		if (next === content) {
			new Notice('YAML 无变化');
		} else {
			await this.app.vault.modify(this.file, next);
			new Notice('已更新笔记 YAML 属性');
		}

		this.close();
		await this.onSaved();
	}
}

export function openFileDeckSettings(
	plugin: DeckToAnkiPlugin,
	file: TFile,
	initial: FileDeckSettingsValues,
	onSaved: () => void | Promise<void>,
): void {
	new FileDeckSettingsModal(plugin, file, initial, onSaved).open();
}
