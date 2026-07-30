import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type DeckToAnkiPlugin from '../main';
import type { MediaCompressCache } from './anki/mediaCompressCache';
import type { MediaProcessOptions } from './anki/processMedia';
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

/** Bump when shipping new built-in card Front/Back/CSS. */
export const DECK_TEMPLATE_STYLE_VERSION = 6;

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
	/** Tracks built-in style revisions; bump refreshes defaults once. */
	deckTemplateStyleVersion: number;
	/**
	 * Last style version successfully pushed to Anki note types.
	 * When behind deckTemplateStyleVersion, next sync force-updates templates.
	 */
	ankiTemplateSyncedVersion: number;
	/** Sync Obsidian tags → Anki note tags. */
	deckTagsEnabled: boolean;
	/** Write DeckBacklink field (per-deck crumbs: 一级 > 牌组2 > …). */
	deckBacklinkEnabled: boolean;
	/** URI scheme for DeckBacklink. */
	backlinkScheme: BacklinkScheme;
	/** Frontmatter property for Advanced URI uid. */
	advUriUidProperty: string;
	/**
	 * After parsing the current-note tab, auto-check Anki status in the
	 * background (tree renders first). Default on.
	 */
	autoCheckCurrentNote: boolean;
	/**
	 * Sync deck sibling indexes into Anki front / backlink (e.g. `1.2. `).
	 * Notes may override via YAML `deckNumbering`. Default on.
	 */
	deckNumberingEnabled: boolean;
	/**
	 * Sync card sibling indexes into Anki front. Notes may override via
	 * YAML `cardNumbering`. Default off.
	 */
	cardNumberingEnabled: boolean;
	/**
	 * Compress raster images when uploading to Anki (vault files unchanged).
	 * Default on.
	 */
	mediaCompressEnabled: boolean;
	/** JPEG quality 1–100 for Anki upload. Default 75. */
	mediaCompressQuality: number;
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
	deckTemplateStyleVersion: DECK_TEMPLATE_STYLE_VERSION,
	ankiTemplateSyncedVersion: 0,
	deckTagsEnabled: true,
	deckBacklinkEnabled: true,
	backlinkScheme: 'oburi',
	advUriUidProperty: 'uid',
	autoCheckCurrentNote: true,
	deckNumberingEnabled: true,
	cardNumberingEnabled: false,
	mediaCompressEnabled: true,
	mediaCompressQuality: 75,
	includeFolders: [],
	requireDeckTag: true,
};

/** Merge persisted settings with defaults (especially nested template styles). */
export function mergeSettings(
	partial: Partial<DeckToAnkiSettings> | null | undefined,
): DeckToAnkiSettings {
	const base = { ...DEFAULT_SETTINGS, ...(partial ?? {}) };
	const defaults = createDefaultDeckTemplateStyles();
	const savedVersion = partial?.deckTemplateStyleVersion ?? 0;

	// One-time refresh when built-in card chrome is upgraded.
	if (savedVersion < DECK_TEMPLATE_STYLE_VERSION) {
		base.deckTemplateStyles = defaults;
		base.deckTemplateStyleVersion = DECK_TEMPLATE_STYLE_VERSION;
	} else {
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
	}

	if (!DECK_TEMPLATE_IDS.includes(base.deckTemplate)) {
		base.deckTemplate = 'ob-deck-basic';
	}

	if (typeof base.mediaCompressEnabled !== 'boolean') {
		base.mediaCompressEnabled = DEFAULT_SETTINGS.mediaCompressEnabled;
	}
	const q = Number(base.mediaCompressQuality);
	base.mediaCompressQuality = Number.isFinite(q)
		? Math.min(100, Math.max(1, Math.round(q)))
		: DEFAULT_SETTINGS.mediaCompressQuality;

	return base;
}

/** Media options for Anki field render / upload (does not touch vault files). */
export function mediaProcessOptionsFromSettings(
	settings: DeckToAnkiSettings,
	cache?: MediaCompressCache | null,
): MediaProcessOptions | undefined {
	if (settings.mediaCompressEnabled === false) {
		return undefined;
	}
	const q = settings.mediaCompressQuality ?? 75;
	const opts: MediaProcessOptions = {
		compressQuality: Math.min(100, Math.max(1, Math.round(q))),
	};
	if (cache) {
		opts.compressCache = cache;
	}
	return opts;
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
			.setName('打开当前笔记时自动检测')
			.setDesc(
				'解析「当前卡片」后先显示树，再在后台对照 Anki 检测已勾选卡片的同步状态。默认开启。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoCheckCurrentNote !== false)
					.onChange(async (value) => {
						this.plugin.settings.autoCheckCurrentNote = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('同步牌组编号')
			.setDesc(
				'将牌组同级序号写入 Anki（正面前缀 / 回链，如 1.2. ）。笔记可用 YAML deckNumbering 覆盖。默认开启。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deckNumberingEnabled !== false)
					.onChange(async (value) => {
						this.plugin.settings.deckNumberingEnabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('同步卡片编号')
			.setDesc(
				'将卡片同级序号写入 Anki 正面（如 3. 或与牌组编号组合为 1.2.3. ）。YAML: cardNumbering。默认关闭。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.cardNumberingEnabled === true)
					.onChange(async (value) => {
						this.plugin.settings.cardNumberingEnabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('图片压缩')
			.setDesc(
				'上传到 Anki 时压缩位图（PNG/JPEG/WebP/BMP → JPEG）。不修改库内源文件。默认开启。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.mediaCompressEnabled !== false)
					.onChange(async (value) => {
						this.plugin.settings.mediaCompressEnabled = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.mediaCompressEnabled !== false) {
			new Setting(containerEl)
				.setName('压缩质量')
				.setDesc('JPEG 质量 1–100，默认 75。数值越低体积越小、画质越低。')
				.addSlider((slider) =>
					slider
						.setLimits(1, 100, 1)
						.setValue(this.plugin.settings.mediaCompressQuality ?? 75)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.mediaCompressQuality = value;
							await this.plugin.saveSettings();
						}),
				)
				.addExtraButton((btn) =>
					btn
						.setIcon('reset')
						.setTooltip('恢复默认 75')
						.onClick(async () => {
							this.plugin.settings.mediaCompressQuality = 75;
							await this.plugin.saveSettings();
							this.display();
						}),
				);

			new Setting(containerEl)
				.setName('图片压缩缓存')
				.setDesc(
					`按文件内容 hash + 质量缓存压缩结果，保证同步与状态对比文件名一致。当前 ${this.plugin.mediaCompressCache.size} 条。`,
				)
				.addButton((btn) =>
					btn.setButtonText('清空缓存').onClick(async () => {
						this.plugin.mediaCompressCache.clear();
						await this.plugin.mediaCompressCache.saveNow();
						new Notice('已清空图片压缩缓存');
						this.display();
					}),
				);
		}

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
				'将当前 Front / Back / CSS 写入 Anki（覆盖已有笔记类型样式）。更新默认样式后请点一次。',
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
								() => this.plugin.saveSettings(),
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
				'写入 ob-deck-backlink 牌组树（一级 > 牌组2 > 子牌组）。关闭则不写入该字段。',
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
			.setDesc(
				'none：只显示牌组树、无跳转；oburi：核心 URI；aduri：Advanced URI（需插件）。',
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('none', 'none')
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
