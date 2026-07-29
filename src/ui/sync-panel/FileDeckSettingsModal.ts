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

export interface FileDeckSettingsOptions {
	/** Types selectable in the dropdown. Defaults to head / basic / file / list. */
	allowedDeckTypes?: DeckType[];
}

export interface FileDeckSettingsResult {
	/** true when Save wrote (or attempted) YAML; false when closed without Save. */
	persisted: boolean;
}

const DEFAULT_DECK_TYPES: DeckType[] = ['head', 'basic', 'file', 'list'];

const DECK_TYPE_LABELS: Record<DeckType, string> = {
	head: 'Head',
	basic: 'Basic',
	file: 'File',
	list: 'List',
};

export class FileDeckSettingsModal extends Modal {
	private readonly file: TFile;
	private readonly onDone: (
		values: FileDeckSettingsValues,
		result: FileDeckSettingsResult,
	) => void | Promise<void>;
	private readonly allowedDeckTypes: DeckType[];
	private readonly initial: FileDeckSettingsValues;
	private draft: FileDeckSettingsValues;
	private finished = false;

	constructor(
		plugin: DeckToAnkiPlugin,
		file: TFile,
		initial: FileDeckSettingsValues,
		onDone: (
			values: FileDeckSettingsValues,
			result: FileDeckSettingsResult,
		) => void | Promise<void>,
		options?: FileDeckSettingsOptions,
	) {
		super(plugin.app);
		this.file = file;
		this.onDone = onDone;
		this.allowedDeckTypes = options?.allowedDeckTypes ?? DEFAULT_DECK_TYPES;
		this.initial = { ...initial };
		this.draft = { ...initial };
		if (!this.allowedDeckTypes.includes(this.draft.deckType)) {
			this.draft.deckType = this.allowedDeckTypes[0] ?? 'head';
		}
	}

	onOpen(): void {
		this.modalEl.addClass('dta-file-settings-modal');
		this.titleEl.setText('Deck YAML settings');
		this.renderForm();
	}

	onClose(): void {
		if (!this.finished) {
			this.finished = true;
			if (this.isDirty()) {
				void this.onDone(this.draft, { persisted: false });
			}
		}
		this.contentEl.empty();
	}

	private isDirty(): boolean {
		return (
			this.draft.deckType !== this.initial.deckType ||
			this.draft.deckName !== this.initial.deckName ||
			this.draft.deckLevel !== this.initial.deckLevel ||
			this.draft.deckStatus !== this.initial.deckStatus
		);
	}

	private renderForm(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('p', {
			cls: 'dta-file-settings-hint',
			text: '切换类型后关闭即可按新类型解析；只有 Save 会写入 YAML。',
		});

		new Setting(contentEl)
			.setName('Deck type')
			.setDesc('解析类型（Save 时写入 deckType）')
			.addDropdown((dropdown) => {
				for (const type of this.allowedDeckTypes) {
					dropdown.addOption(type, DECK_TYPE_LABELS[type]);
				}
				dropdown.setValue(this.draft.deckType).onChange((value) => {
					this.draft.deckType = value as DeckType;
					this.renderForm();
				});
			});

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
			text: 'Close',
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

		this.finished = true;
		this.close();
		await this.onDone(this.draft, { persisted: true });
	}
}

export function openFileDeckSettings(
	plugin: DeckToAnkiPlugin,
	file: TFile,
	initial: FileDeckSettingsValues,
	onDone: (
		values: FileDeckSettingsValues,
		result: FileDeckSettingsResult,
	) => void | Promise<void>,
	options?: FileDeckSettingsOptions,
): void {
	new FileDeckSettingsModal(plugin, file, initial, onDone, options).open();
}
