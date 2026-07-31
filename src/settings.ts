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
export const DECK_TEMPLATE_STYLE_VERSION = 7;

export interface DeckToAnkiSettings {
	defaultDeckType: DeckType;
	/** Default heading level treated as card front in head mode (YAML deckLevel). */
	cardHeadingLevel: number;
	/**
	 * Head mode with --- separator: when true, card front includes the heading text.
	 * Default false — front is only the body above ---.
	 * Anki always stores title in ob-deck-head separately from ob-deck-front.
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
	/** Write ob-deck-tags from parsed Obsidian tags. */
	deckTagsEnabled: boolean;
	/** Write ob-deck-tree (deck crumbs). */
	deckTreeEnabled: boolean;
	/** When tree is on: crumbs are clickable links (uses backlinkScheme). */
	deckTreeLinkEnabled: boolean;
	/** Write ob-deck-backlink (open current card in Obsidian). */
	deckCardBacklinkEnabled: boolean;
	/** URI scheme for card backlink and tree links. */
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
	deckTreeEnabled: true,
	deckTreeLinkEnabled: true,
	deckCardBacklinkEnabled: true,
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

	// Migrate legacy deckBacklinkEnabled → deckTreeEnabled.
	const legacy = partial as
		| (Partial<DeckToAnkiSettings> & { deckBacklinkEnabled?: boolean })
		| null
		| undefined;
	if (
		legacy &&
		legacy.deckTreeEnabled === undefined &&
		typeof legacy.deckBacklinkEnabled === 'boolean'
	) {
		base.deckTreeEnabled = legacy.deckBacklinkEnabled;
	}
	if (typeof base.deckTreeEnabled !== 'boolean') {
		base.deckTreeEnabled = DEFAULT_SETTINGS.deckTreeEnabled;
	}
	if (typeof base.deckTreeLinkEnabled !== 'boolean') {
		base.deckTreeLinkEnabled = DEFAULT_SETTINGS.deckTreeLinkEnabled;
	}
	if (typeof base.deckCardBacklinkEnabled !== 'boolean') {
		base.deckCardBacklinkEnabled = DEFAULT_SETTINGS.deckCardBacklinkEnabled;
	}

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
		this.renderSyncSettings(containerEl);
		this.renderMediaSettings(containerEl);
		this.renderTemplateSettings(containerEl);
		this.renderParseFieldSettings(containerEl);
		this.renderCustomFieldSettings(containerEl);

		containerEl.createEl('p', {
			cls: 'deck-to-anki-settings-hint',
			text: '笔记 YAML（camelCase）：deckType、deckName、deckLevel、deckStatus、deckTemplate、deckFile、deckNumbering、cardNumbering。',
		});
	}

	/** Section heading + short blurb, wrapped for visual grouping. */
	private beginSection(
		containerEl: HTMLElement,
		title: string,
		desc?: string,
	): HTMLElement {
		const section = containerEl.createDiv({ cls: 'dta-settings-section' });
		section.createEl('h3', { text: title, cls: 'dta-settings-section-title' });
		if (desc) {
			section.createEl('p', {
				cls: 'dta-settings-section-desc',
				text: desc,
			});
		}
		return section;
	}

	private renderParseSettings(containerEl: HTMLElement): void {
		const section = this.beginSection(
			containerEl,
			'解析',
			'控制笔记如何拆成牌组 / 卡片；可被单篇 YAML 覆盖。',
		);

		new Setting(section)
			.setName('默认牌组模式')
			.setDesc(
				'同步面板默认解析模式。笔记始终从当前文件解析；Update 会把 deckType 写入 YAML。',
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('file', 'File（链接文件）')
					.addOption('head', 'Head（标题）')
					.addOption('list', 'List（顶层列表）')
					.addOption('card', 'Card（分隔符）')
					.setValue(this.plugin.settings.defaultDeckType)
					.onChange(async (value) => {
						this.plugin.settings.defaultDeckType = value as DeckType;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(section)
			.setName('默认标题层级')
			.setDesc(
				'Head 模式：笔记无 deckLevel 时，将该层级标题视为卡片正面。',
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

		new Setting(section)
			.setName('正面包含标题')
			.setDesc(
				'Head 模式且卡片含 --- 时：开启则标题写入正面；关闭则正面仅为 --- 上方正文。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.headIncludeTitleInFront)
					.onChange(async (value) => {
						this.plugin.settings.headIncludeTitleInFront = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(section)
			.setName('Deck View 默认模式')
			.setDesc('从卡片打开 Deck View 时：源码或阅读。')
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

	private renderSyncSettings(containerEl: HTMLElement): void {
		const section = this.beginSection(
			containerEl,
			'同步',
			'AnkiConnect 连接、自动检测与编号写入。',
		);

		new Setting(section)
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

		new Setting(section)
			.setName('打开当前笔记时自动检测')
			.setDesc(
				'解析「当前卡片」后先显示树，再在后台对照 Anki 检测已勾选卡片。默认开启。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoCheckCurrentNote !== false)
					.onChange(async (value) => {
						this.plugin.settings.autoCheckCurrentNote = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(section)
			.setName('同步牌组编号')
			.setDesc(
				'将牌组同级序号写入 Anki（正面前缀 / 回链，如 1.2. ）。YAML: deckNumbering。默认开启。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deckNumberingEnabled !== false)
					.onChange(async (value) => {
						this.plugin.settings.deckNumberingEnabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(section)
			.setName('同步卡片编号')
			.setDesc(
				'将卡片同级序号写入 Anki 正面（如 3. 或 1.2.3. ）。YAML: cardNumbering。默认关闭。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.cardNumberingEnabled === true)
					.onChange(async (value) => {
						this.plugin.settings.cardNumberingEnabled = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderMediaSettings(containerEl: HTMLElement): void {
		const section = this.beginSection(
			containerEl,
			'媒体',
			'仅压缩上传到 Anki 的图片，不修改库内源文件。',
		);

		new Setting(section)
			.setName('图片压缩')
			.setDesc(
				'上传时压缩位图（PNG/JPEG/WebP/BMP → JPEG）。默认开启。',
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

		if (this.plugin.settings.mediaCompressEnabled === false) {
			return;
		}

		new Setting(section)
			.setName('压缩质量')
			.setDesc('JPEG 质量 1–100，默认 75。越低体积越小、画质越低。')
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

		new Setting(section)
			.setName('压缩缓存')
			.setDesc(
				`按文件内容 hash + 质量缓存，保证同步与状态对比文件名一致。当前 ${this.plugin.mediaCompressCache.size} 条。`,
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

	private renderTemplateSettings(containerEl: HTMLElement): void {
		const section = this.beginSection(
			containerEl,
			'卡片模板',
			'默认 Anki 笔记类型与 Front / Back / CSS；可强制推送到 Anki。',
		);

		new Setting(section)
			.setName('默认笔记类型')
			.setDesc(
				'笔记 YAML 无 deckTemplate 时使用。可在牌组设置中按笔记覆盖。',
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

		section.createEl('h4', {
			text: `样式 · ${DECK_TEMPLATE_LABELS[templateId] ?? templateId}`,
		});

		this.addTemplateTextArea(
			section,
			'正面模板',
			'Anki 卡片正面 HTML（可用 {{ob-deck-head}} {{ob-deck-front}} {{ob-deck-back}} {{ob-deck-tags}} {{ob-deck-tree}} {{ob-deck-backlink}}）',
			style.front,
			async (value) => {
				this.plugin.settings.deckTemplateStyles[templateId].front =
					value;
				await this.plugin.saveSettings();
			},
		);

		this.addTemplateTextArea(
			section,
			'背面模板',
			'Anki 卡片背面 HTML',
			style.back,
			async (value) => {
				this.plugin.settings.deckTemplateStyles[templateId].back =
					value;
				await this.plugin.saveSettings();
			},
		);

		this.addTemplateTextArea(
			section,
			'卡片 CSS',
			'笔记类型 CSS（仅首次创建或强制更新时同步到 Anki）',
			style.css,
			async (value) => {
				this.plugin.settings.deckTemplateStyles[templateId].css =
					value;
				await this.plugin.saveSettings();
			},
			12,
		);

		new Setting(section)
			.setName('强制更新模板到 Anki')
			.setDesc(
				'将当前正面 / 背面 / CSS 写入 Anki（覆盖已有笔记类型样式）。',
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

	private renderParseFieldSettings(containerEl: HTMLElement): void {
		const section = this.beginSection(
			containerEl,
			'解析字段',
			'写入 Anki 的解析结果：ob-deck-head / front / back / tags。标题与正文分字段，便于分别设样式。',
		);

		section.createEl('p', {
			cls: 'dta-settings-section-desc',
			text: 'ob-deck-head：标题 · ob-deck-front：正面正文（不含标题）· ob-deck-back：背面 · ob-deck-tags：标签',
		});

		new Setting(section)
			.setName('同步标签（ob-deck-tags）')
			.setDesc(
				'将卡片解析出的 Obsidian Tag 写入字段，并同步为 Anki 笔记标签。默认开启。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deckTagsEnabled)
					.onChange(async (value) => {
						this.plugin.settings.deckTagsEnabled = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderCustomFieldSettings(containerEl: HTMLElement): void {
		const section = this.beginSection(
			containerEl,
			'自定义字段',
			'ob-deck-backlink：定位当前卡片 · ob-deck-tree：牌组树。',
		);

		new Setting(section)
			.setName('卡片回链（ob-deck-backlink）')
			.setDesc(
				'写入定位到当前卡片的链接：Head → 标题，List → 块（^id），Card → 文件。默认开启。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.deckCardBacklinkEnabled !== false,
					)
					.onChange(async (value) => {
						this.plugin.settings.deckCardBacklinkEnabled = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		new Setting(section)
			.setName('牌组树（ob-deck-tree）')
			.setDesc('写入牌组路径 crumbs（一级 > 牌组2 > …）。默认开启。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deckTreeEnabled !== false)
					.onChange(async (value) => {
						this.plugin.settings.deckTreeEnabled = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.deckTreeEnabled !== false) {
			new Setting(section)
				.setName('牌组树回链')
				.setDesc(
					'开启后牌组树各段可点击跳转（使用下方协议）。关闭则仅显示文字。',
				)
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.plugin.settings.deckTreeLinkEnabled !== false,
						)
						.onChange(async (value) => {
							this.plugin.settings.deckTreeLinkEnabled = value;
							await this.plugin.saveSettings();
						}),
				);
		}

		const needScheme =
			this.plugin.settings.deckCardBacklinkEnabled !== false ||
			(this.plugin.settings.deckTreeEnabled !== false &&
				this.plugin.settings.deckTreeLinkEnabled !== false);
		if (!needScheme) {
			return;
		}

		new Setting(section)
			.setName('回链协议')
			.setDesc(
				'用于卡片回链与牌组树链接。none：无跳转；oburi：核心 URI；aduri：Advanced URI。',
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
			new Setting(section)
				.setName('Advanced URI uid 属性名')
				.setDesc(
					'从笔记 YAML 读取 uid。head/list/card 分别用标题、块、仅文件定位。',
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
