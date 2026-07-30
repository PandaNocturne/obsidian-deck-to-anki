import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type DeckToAnkiPlugin from '../main';
import { forceUpdateDeckTemplate } from './anki/syncCard';
import {
	createDefaultDeckTemplateStyles,
	DECK_TEMPLATE_IDS,
	DECK_TEMPLATE_LABELS,
	type DeckTemplateId,
	type DeckTemplateStyle,
} from './anki/templates';
import type { BacklinkScheme } from './anki/backlink';
import type { DeckType } from './domain/head/types';
import type { DeckViewMode } from './ui/sync-panel/CardPreviewModal';

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
	/** Default Deck View mode: source (raw) or reading (rendered). */
	deckViewMode: DeckViewMode;
	/** AnkiConnect endpoint. */
	ankiConnectUrl: string;
	/** Active Anki note type (created if missing). */
	deckTemplate: DeckTemplateId;
	/** Editable Front/Back/CSS per note type. Synced on create or force update. */
	deckTemplateStyles: Record<DeckTemplateId, DeckTemplateStyle>;
	/** Sync Obsidian tags → Anki note tags. */
	deckTagsEnabled: boolean;
	/** Write DeckBacklink field (`[deck tree](uri)`). */
	deckBacklinkEnabled: boolean;
	/** URI scheme for DeckBacklink. */
	backlinkScheme: BacklinkScheme;
	/** Frontmatter property for Advanced URI uid. */
	advUriUidProperty: string;
	includeFolders: string[];
	requireDeckTag: boolean;
}

export const DEFAULT_SETTINGS: DeckToAnkiSettings = {
	defaultDeckType: 'head',
	cardHeadingLevel: DEFAULT_CARD_HEADING_LEVEL,
	headIncludeTitleInFront: false,
	deckViewMode: 'source',
	ankiConnectUrl: 'http://127.0.0.1:8765',
	deckTemplate: 'ob-deck-basic',
	deckTemplateStyles: createDefaultDeckTemplateStyles(),
	deckTagsEnabled: true,
	deckBacklinkEnabled: true,
	backlinkScheme: 'oburi',
	advUriUidProperty: 'uid',
	includeFolders: [],
	requireDeckTag: true,
};

/** Merge persisted settings with defaults (especially nested template styles). */
export function mergeSettings(
	partial: Partial<DeckToAnkiSettings> | null | undefined,
): DeckToAnkiSettings {
	const base = { ...DEFAULT_SETTINGS, ...(partial ?? {}) };
	const defaults = createDefaultDeckTemplateStyles();
	const styles = { ...defaults };
	for (const id of DECK_TEMPLATE_IDS) {
		const saved = partial?.deckTemplateStyles?.[id];
		if (saved) {
			styles[id] = {
				front: saved.front ?? defaults[id].front,
				back: saved.back ?? defaults[id].back,
				css: saved.css ?? defaults[id].css,
			};
		}
	}
	base.deckTemplateStyles = styles;
	if (!DECK_TEMPLATE_IDS.includes(base.deckTemplate)) {
		base.deckTemplate = 'ob-deck-basic';
	}
	return base;
}

export class DeckToAnkiSettingTab extends PluginSettingTab {
	plugin: DeckToAnkiPlugin;

	constructor(app: App, plugin: DeckToAnkiPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('deck-to-anki-settings');

		this.renderParseSettings(containerEl);
		this.renderAnkiTemplateSettings(containerEl);
		this.renderCustomFieldSettings(containerEl);

		containerEl.createEl('p', {
			cls: 'deck-to-anki-settings-hint',
			text: 'Notes use camelCase YAML: deckType, deckName, deckLevel, deckStatus, deckTemplate, deckFile.',
		});
	}

	private renderParseSettings(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: '解析' });

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

		new Setting(containerEl)
			.setName('Deck View default')
			.setDesc(
				'Default mode when opening Deck View from a card: source (raw markdown) or reading (rendered).',
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('source', '源码')
					.addOption('reading', '阅读')
					.setValue(this.plugin.settings.deckViewMode ?? 'source')
					.onChange(async (value) => {
						this.plugin.settings.deckViewMode =
							value as DeckViewMode;
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderAnkiTemplateSettings(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: '牌组模板' });

		new Setting(containerEl)
			.setName('AnkiConnect URL')
			.setDesc('Anki 需安装并启用 AnkiConnect。')
			.addText((text) =>
				text
					.setPlaceholder('http://127.0.0.1:8765')
					.setValue(this.plugin.settings.ankiConnectUrl)
					.onChange(async (value) => {
						this.plugin.settings.ankiConnectUrl =
							value.trim() || 'http://127.0.0.1:8765';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Default deck template')
			.setDesc(
				'笔记 YAML 无 deckTemplate 时的默认 Anki 笔记类型。可在牌组设置中按笔记覆盖。',
			)
			.addDropdown((dropdown) => {
				for (const id of DECK_TEMPLATE_IDS) {
					dropdown.addOption(id, DECK_TEMPLATE_LABELS[id]);
				}
				dropdown
					.setValue(this.plugin.settings.deckTemplate)
					.onChange(async (value) => {
						this.plugin.settings.deckTemplate =
							value as DeckTemplateId;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		const templateId = this.plugin.settings.deckTemplate;
		const style = this.plugin.settings.deckTemplateStyles[templateId];

		containerEl.createEl('h4', {
			text: `卡片样式 · ${templateId}`,
		});

		this.addTemplateTextArea(
			containerEl,
			'Front template',
			'Anki 卡片正面 HTML（可用 {{Front}} {{Back}} {{DeckBacklink}}）',
			style.front,
			async (value) => {
				this.plugin.settings.deckTemplateStyles[templateId].front =
					value;
				await this.plugin.saveSettings();
			},
		);

		this.addTemplateTextArea(
			containerEl,
			'Back template',
			'Anki 卡片背面 HTML',
			style.back,
			async (value) => {
				this.plugin.settings.deckTemplateStyles[templateId].back =
					value;
				await this.plugin.saveSettings();
			},
		);

		this.addTemplateTextArea(
			containerEl,
			'Card CSS',
			'笔记类型 CSS（仅首次创建或强制更新时同步到 Anki）',
			style.css,
			async (value) => {
				this.plugin.settings.deckTemplateStyles[templateId].css =
					value;
				await this.plugin.saveSettings();
			},
			12,
		);

		new Setting(containerEl)
			.setName('强制更新模板到 Anki')
			.setDesc(
				'将当前 Front / Back / CSS 写入 Anki 中已有的笔记类型（会覆盖 Anki 侧样式）。',
			)
			.addButton((btn) =>
				btn
					.setButtonText('强制更新')
					.setCta()
					.onClick(async () => {
						btn.setDisabled(true);
						try {
							const result = await forceUpdateDeckTemplate(
								this.plugin.settings,
							);
							if (result === 'created') {
								new Notice(`已创建笔记类型 ${templateId}`);
							} else {
								new Notice(`已强制更新 ${templateId} 的样式`);
							}
						} catch (error) {
							const msg =
								error instanceof Error
									? error.message
									: String(error);
							new Notice(`更新失败：${msg}`);
						} finally {
							btn.setDisabled(false);
						}
					}),
			);
	}

	private renderCustomFieldSettings(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: '自定义字段' });

		new Setting(containerEl)
			.setName('Deck tags')
			.setDesc(
				'将卡片解析出的 Obsidian Tag 同步为 Anki 笔记标签。默认开启。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deckTagsEnabled)
					.onChange(async (value) => {
						this.plugin.settings.deckTagsEnabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Deck backlink')
			.setDesc(
				'写入 DeckBacklink 字段：[牌组路径](uri)。牌组路径形如 一级 > 子牌组。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deckBacklinkEnabled)
					.onChange(async (value) => {
						this.plugin.settings.deckBacklinkEnabled = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (!this.plugin.settings.deckBacklinkEnabled) {
			return;
		}

		new Setting(containerEl)
			.setName('Backlink scheme')
			.setDesc('oburi 使用核心 URI；aduri 使用 Advanced URI（需插件）。')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('oburi', 'oburi')
					.addOption('aduri', 'aduri')
					.setValue(this.plugin.settings.backlinkScheme)
					.onChange(async (value) => {
						this.plugin.settings.backlinkScheme =
							value as BacklinkScheme;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.backlinkScheme === 'aduri') {
			new Setting(containerEl)
				.setName('Advanced URI uid 属性名')
				.setDesc(
					'从笔记 YAML 读取 uid。head/list/card 分别用 heading、block、仅文件定位。',
				)
				.addText((text) =>
					text
						.setPlaceholder('uid')
						.setValue(this.plugin.settings.advUriUidProperty)
						.onChange(async (value) => {
							this.plugin.settings.advUriUidProperty =
								value.trim() || 'uid';
							await this.plugin.saveSettings();
						}),
				);
		}
	}

	private addTemplateTextArea(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		value: string,
		onChange: (value: string) => Promise<void>,
		rows = 6,
	): void {
		const setting = new Setting(containerEl).setName(name).setDesc(desc);
		setting.settingEl.addClass('dta-setting-textarea');
		setting.addTextArea((text) => {
			text.setValue(value).onChange((v) => {
				void onChange(v);
			});
			text.inputEl.rows = rows;
			text.inputEl.addClass('dta-template-textarea');
		});
	}
}
