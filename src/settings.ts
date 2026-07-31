import { App, Notice, PluginSettingTab, Setting, TextAreaComponent, ToggleComponent, setIcon } from 'obsidian';
import type DeckToAnkiPlugin from '../main';
import type { MediaCompressCache } from './anki/mediaCompressCache';
import type { MediaProcessOptions } from './anki/processMedia';
import {
	allDeckTemplateIdsOrdered,
	createDefaultDeckTemplateStyles,
	defaultStyleFor,
	deckTemplateLabel,
	isBuiltInDeckTemplate,
	isReversibleDeckTemplate,
	normalizeDeckCardKind,
	normalizeDeckTemplateOrder,
	sanitizeDeckTemplateId,
	BUILT_IN_DECK_TEMPLATE_IDS,
	DECK_CARD_KIND_AVAILABLE,
	DECK_CARD_KIND_IDS,
	DECK_CARD_KIND_LABELS,
	type DeckCardKind,
	type DeckTemplateId,
	type DeckTemplateStyle,
} from './anki/templates';
import { AnkiConnectClient } from './anki/AnkiConnectClient';
import { importDeckTemplateStyleFromAnki, blankCustomTemplateStyle } from './anki/importTemplateStyle';
import {
	forceUpdateOneDeckTemplate,
} from './anki/syncCard';
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
	/** User-defined Anki note type ids (in addition to built-ins). */
	customDeckTemplates: string[];
	/** Display / sync order of all template ids (builtins + custom). */
	deckTemplateOrder: string[];
	/** Editable Front/Back/CSS per note type. Synced on create or force update. */
	deckTemplateStyles: Record<string, DeckTemplateStyle>;
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
	/**
	 * Card backlink anchor text:
	 * - auto: detected (heading / ^block / 打开笔记)
	 * - custom: fixed label from `backlinkLinkText` (default "backlink")
	 */
	backlinkLinkTextMode: 'auto' | 'custom';
	/** Used when backlinkLinkTextMode is custom. */
	backlinkLinkText: string;
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
	 * Sync deck sibling indexes into Anki front / tree (e.g. `1.2. `).
	 * Notes may override via YAML `deckNumbering`. Default on.
	 */
	deckNumberingEnabled: boolean;
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
	customDeckTemplates: [],
	deckTemplateOrder: [...BUILT_IN_DECK_TEMPLATE_IDS],
	deckTemplateStyles: createDefaultDeckTemplateStyles(),
	deckTemplateStyleVersion: DECK_TEMPLATE_STYLE_VERSION,
	ankiTemplateSyncedVersion: 0,
	deckTagsEnabled: true,
	deckTreeEnabled: true,
	deckTreeLinkEnabled: true,
	deckCardBacklinkEnabled: true,
	backlinkLinkTextMode: 'auto',
	backlinkLinkText: 'backlink',
	backlinkScheme: 'oburi',
	advUriUidProperty: 'uid',
	autoCheckCurrentNote: true,
	deckNumberingEnabled: true,
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

	const customIds = Array.isArray(base.customDeckTemplates)
		? base.customDeckTemplates
				.map((id) => sanitizeDeckTemplateId(String(id)))
				.filter((id) => id.length > 0 && !isBuiltInDeckTemplate(id))
		: [];
	base.customDeckTemplates = [...new Set(customIds)];
	base.deckTemplateOrder = normalizeDeckTemplateOrder(
		base.deckTemplateOrder,
		base.customDeckTemplates,
	);

	const basicDefault = defaults['ob-deck-basic'] ?? defaultStyleFor('ob-deck-basic');
	const preserveCustomStyles = (): Record<string, DeckTemplateStyle> => {
		const out: Record<string, DeckTemplateStyle> = {};
		const styles = base.deckTemplateStyles ?? {};
		for (const id of base.customDeckTemplates) {
			const saved = styles[id];
			if (saved) {
				out[id] = {
					front: saved.front ?? basicDefault.front,
					back: saved.back ?? basicDefault.back,
					css: saved.css ?? basicDefault.css,
					reversible: saved.reversible === true,
					kind: normalizeDeckCardKind(saved.kind),
				};
			} else {
				out[id] = defaultStyleFor(id);
			}
		}
		return out;
	};

	// One-time refresh when built-in card chrome is upgraded.
	if (savedVersion < DECK_TEMPLATE_STYLE_VERSION) {
		base.deckTemplateStyles = {
			...defaults,
			...preserveCustomStyles(),
		};
		base.deckTemplateStyleVersion = DECK_TEMPLATE_STYLE_VERSION;
	} else {
		const styles = { ...defaults, ...preserveCustomStyles() };
		for (const id of BUILT_IN_DECK_TEMPLATE_IDS) {
			const saved = partial?.deckTemplateStyles?.[id];
			const builtinDefault = defaults[id] ?? defaultStyleFor(id);
			if (saved) {
				styles[id] = {
					front: saved.front ?? builtinDefault.front,
					back: saved.back ?? builtinDefault.back,
					css: saved.css ?? builtinDefault.css,
					reversible: id === 'ob-deck-basic++',
					kind: normalizeDeckCardKind(saved.kind),
				};
			}
		}
		base.deckTemplateStyles = styles;
	}

	const knownIds = allDeckTemplateIdsOrdered(base);
	if (!knownIds.includes(base.deckTemplate)) {
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
	// Legacy unreleased name: originText (detected) → auto.
	const linkMode = base.backlinkLinkTextMode as string;
	if (linkMode === 'custom') {
		base.backlinkLinkTextMode = 'custom';
	} else if (linkMode === 'auto' || linkMode === 'originText') {
		base.backlinkLinkTextMode = 'auto';
	} else {
		base.backlinkLinkTextMode = DEFAULT_SETTINGS.backlinkLinkTextMode;
	}
	if (typeof base.backlinkLinkText !== 'string' || !base.backlinkLinkText.trim()) {
		base.backlinkLinkText = DEFAULT_SETTINGS.backlinkLinkText;
	} else {
		base.backlinkLinkText = base.backlinkLinkText.trim();
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
	/** Remember last settings tab across display() rebuilds. */
	private activeSettingsTab: 'parse' | 'sync' | 'template' | 'fields' =
		'parse';
	/** Template being edited in 模板设置 (independent of default type). */
	private editingTemplateId: DeckTemplateId | null = null;

	constructor(app: App, plugin: DeckToAnkiPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private orderedTemplateIds(): DeckTemplateId[] {
		return allDeckTemplateIdsOrdered(this.plugin.settings);
	}

	private resolveEditingTemplateId(): DeckTemplateId {
		const known = this.orderedTemplateIds();
		const current = this.editingTemplateId;
		if (current && known.includes(current)) {
			return current;
		}
		const fallback = this.plugin.settings.deckTemplate;
		const id = known.includes(fallback) ? fallback : 'ob-deck-basic';
		this.editingTemplateId = id;
		return id;
	}

	private ankiClient(): AnkiConnectClient {
		return new AnkiConnectClient(
			() =>
				this.plugin.settings.ankiConnectUrl ||
				'http://127.0.0.1:8765',
		);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('deck-to-anki-settings');

		const tabBar = containerEl.createDiv({ cls: 'dta-settings-tabs' });
		const parseTab = tabBar.createEl('button', {
			cls: 'dta-settings-tab',
			text: '常规',
			attr: { type: 'button' },
		});
		const syncTab = tabBar.createEl('button', {
			cls: 'dta-settings-tab',
			text: '同步',
			attr: { type: 'button' },
		});
		const templateTab = tabBar.createEl('button', {
			cls: 'dta-settings-tab',
			text: '模板',
			attr: { type: 'button' },
		});
		const fieldsTab = tabBar.createEl('button', {
			cls: 'dta-settings-tab',
			text: '字段',
			attr: { type: 'button' },
		});

		const parsePanel = containerEl.createDiv({
			cls: 'dta-settings-panel',
		});
		this.renderParseSettings(parsePanel);

		const syncPanel = containerEl.createDiv({
			cls: 'dta-settings-panel',
		});
		this.renderSyncSettings(syncPanel);
		this.renderMediaSettings(syncPanel);

		const templatePanel = containerEl.createDiv({
			cls: 'dta-settings-panel',
		});
		this.renderTemplateSettings(templatePanel);

		const fieldsPanel = containerEl.createDiv({
			cls: 'dta-settings-panel',
		});
		this.renderCustomFieldSettings(fieldsPanel);

		const syncTabs = (): void => {
			const tab = this.activeSettingsTab;
			parseTab.toggleClass('is-active', tab === 'parse');
			syncTab.toggleClass('is-active', tab === 'sync');
			templateTab.toggleClass('is-active', tab === 'template');
			fieldsTab.toggleClass('is-active', tab === 'fields');
			parsePanel.toggle(tab === 'parse');
			syncPanel.toggle(tab === 'sync');
			templatePanel.toggle(tab === 'template');
			fieldsPanel.toggle(tab === 'fields');
		};

		parseTab.addEventListener('click', () => {
			this.activeSettingsTab = 'parse';
			syncTabs();
		});
		syncTab.addEventListener('click', () => {
			this.activeSettingsTab = 'sync';
			syncTabs();
		});
		templateTab.addEventListener('click', () => {
			this.activeSettingsTab = 'template';
			syncTabs();
		});
		fieldsTab.addEventListener('click', () => {
			this.activeSettingsTab = 'fields';
			syncTabs();
		});
		syncTabs();
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

		const yamlSection = this.beginSection(
			containerEl,
			'笔记 YAML',
			'单篇笔记 frontmatter 使用 camelCase 字段（可覆盖插件默认）。',
		);
		const yamlList = yamlSection.createEl('ul', {
			cls: 'dta-yaml-field-list',
		});
		const yamlFields: Array<{ key: string; desc: string }> = [
			{
				key: 'deckType',
				desc: '解析模式：file / head / list / card。',
			},
			{
				key: 'deckName',
				desc: '牌组显示名；缺省时由文件名或标题推断。',
			},
			{
				key: 'deckLevel',
				desc: 'Head 模式：作为卡片正面的标题层级（1–6）。',
			},
			{
				key: 'deckStatus',
				desc: '学习状态：false = 学习中，true = 已归档。',
			},
			{
				key: 'deckTemplate',
				desc: '同步到 Anki 时使用的笔记类型。',
			},
			{
				key: 'deckFile',
				desc: 'File 模式：指向子牌组笔记的 wiki 链接。',
			},
			{
				key: 'deckNumbering',
				desc: '是否在同步树与 Anki 牌组路径显示序号。',
			},
		];
		for (const field of yamlFields) {
			const item = yamlList.createEl('li');
			item.createEl('code', { text: field.key });
			item.appendText(` — ${field.desc}`);
		}
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
				'将牌组同级序号显示在同步树，并写入 Anki 的 ob-deck-tree（如 1. 牌组）。不写入卡片标题/正文。YAML: deckNumbering。默认开启。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deckNumberingEnabled !== false)
					.onChange(async (value) => {
						this.plugin.settings.deckNumberingEnabled = value;
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

		let qualitySlider: { setValue: (v: number) => unknown } | undefined;
		let cacheSetting: Setting | undefined;

		const syncMediaVisibility = (): void => {
			const on = this.plugin.settings.mediaCompressEnabled !== false;
			qualitySetting.settingEl.toggle(on);
			cacheSetting?.settingEl.toggle(on);
		};

		const refreshCacheDesc = (): void => {
			cacheSetting?.setDesc(
				`按文件内容 hash + 质量缓存，保证同步与状态对比文件名一致。当前 ${this.plugin.mediaCompressCache.size} 条。`,
			);
		};

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
						syncMediaVisibility();
					}),
			);

		const qualitySetting = new Setting(section)
			.setName('压缩质量')
			.setDesc('JPEG 质量 1–100，默认 75。越低体积越小、画质越低。')
			.addSlider((slider) => {
				qualitySlider = slider;
				slider
					.setLimits(1, 100, 1)
					.setValue(this.plugin.settings.mediaCompressQuality ?? 75)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.mediaCompressQuality = value;
						await this.plugin.saveSettings();
					});
			})
			.addExtraButton((btn) =>
				btn
					.setIcon('reset')
					.setTooltip('恢复默认 75')
					.onClick(async () => {
						this.plugin.settings.mediaCompressQuality = 75;
						qualitySlider?.setValue(75);
						await this.plugin.saveSettings();
					}),
			);

		cacheSetting = new Setting(section)
			.setName('压缩缓存')
			.addButton((btn) =>
				btn.setButtonText('清空缓存').onClick(async () => {
					this.plugin.mediaCompressCache.clear();
					await this.plugin.mediaCompressCache.saveNow();
					new Notice('已清空图片压缩缓存');
					refreshCacheDesc();
				}),
			);
		refreshCacheDesc();
		syncMediaVisibility();
	}

	private renderTemplateSettings(containerEl: HTMLElement): void {
		const cardSection = this.beginSection(
			containerEl,
			'卡片模板',
			'笔记 YAML 无 deckTemplate 时使用的默认笔记类型。可在牌组设置中按笔记覆盖。',
		);

		new Setting(cardSection)
			.setName('默认类型')
			.addDropdown((dropdown) => {
				for (const id of this.orderedTemplateIds()) {
					dropdown.addOption(id, deckTemplateLabel(id));
				}
				dropdown
					.setValue(this.plugin.settings.deckTemplate)
					.onChange(async (value) => {
						this.plugin.settings.deckTemplate =
							value as DeckTemplateId;
						await this.plugin.saveSettings();
					});
			});

		const manageSection = this.beginSection(
			containerEl,
			'模板管理',
			'管理自定义模板：新建、重命名、删除；左侧拖拽排序。内置默认模板不在此列表。',
		);

		let newName = '';
		new Setting(manageSection)
			.setName('新建模板')
			.setDesc('名称即 Anki 笔记类型名；默认问答型、不可翻转。')
			.addText((text) =>
				text
					.setPlaceholder('例如 My Deck Template')
					.onChange((value) => {
						newName = value;
					}),
			)
			.addButton((btn) =>
				btn.setButtonText('新建').setCta().onClick(async () => {
					const name = sanitizeDeckTemplateId(newName);
					if (!name) {
						new Notice('请输入模板名称');
						return;
					}
					if (this.orderedTemplateIds().includes(name)) {
						new Notice(`模板「${name}」已存在`);
						return;
					}
					this.plugin.settings.deckTemplateStyles[name] =
						blankCustomTemplateStyle();
					this.plugin.settings.customDeckTemplates = [
						...this.plugin.settings.customDeckTemplates,
						name,
					];
					this.plugin.settings.deckTemplateOrder = [
						...this.orderedTemplateIds(),
						name,
					];
					this.plugin.settings.deckTemplateOrder =
						normalizeDeckTemplateOrder(
							this.plugin.settings.deckTemplateOrder,
							this.plugin.settings.customDeckTemplates,
						);
					this.editingTemplateId = name;
					await this.plugin.saveSettings();
					new Notice(`已新建模板「${name}」`);
					this.display();
				}),
			);

		const listEl = manageSection.createDiv({ cls: 'dta-template-list' });
		const customOrder = this.orderedTemplateIds().filter(
			(id) => !isBuiltInDeckTemplate(id),
		);

		if (customOrder.length === 0) {
			listEl.createEl('p', {
				cls: 'dta-template-list-empty',
				text: '暂无自定义模板',
			});
		} else {
			this.renderCustomTemplateList(listEl, customOrder);
		}

		const styleSection = this.beginSection(
			containerEl,
			'模板设置',
			'编辑所选模板的 Front / Back / CSS，并推送到 Anki。',
		);

		styleSection.createEl('p', {
			cls: 'dta-settings-section-desc',
			text: 'ob-deck-head：标题 · ob-deck-front：正面正文 · ob-deck-back：背面 · ob-deck-tags：标签 · ob-deck-backlink：回链 · ob-deck-tree：牌组树',
		});

		const editingId = this.resolveEditingTemplateId();
		const style =
			this.plugin.settings.deckTemplateStyles[editingId] ??
			defaultStyleFor(editingId);

		const controlsHost = styleSection.createDiv({
			cls: 'dta-template-style-controls',
		});
		const editorsHost = styleSection.createDiv({
			cls: 'dta-template-style-editors',
		});
		const actionsHost = styleSection.createDiv({
			cls: 'dta-template-style-actions',
		});

		let kindDropdown!: HTMLSelectElement;
		let reversibleToggle!: ToggleComponent;
		let frontArea!: TextAreaComponent;
		let backArea!: TextAreaComponent;
		let cssArea!: TextAreaComponent;

		const styleOf = (id: DeckTemplateId): DeckTemplateStyle =>
			this.plugin.settings.deckTemplateStyles[id] ?? defaultStyleFor(id);

		const persistStyle = async (
			id: DeckTemplateId,
			patch: Partial<DeckTemplateStyle>,
		): Promise<void> => {
			const st = { ...styleOf(id), ...patch };
			this.plugin.settings.deckTemplateStyles[id] = st;
			await this.plugin.saveSettings();
		};

		const refreshStyleControls = (id: DeckTemplateId): void => {
			const next = styleOf(id);
			const kind = normalizeDeckCardKind(next.kind);
			kindDropdown.value = DECK_CARD_KIND_AVAILABLE[kind] ? kind : 'qa';
			reversibleToggle.setValue(isReversibleDeckTemplate(id, next));
			reversibleToggle.setDisabled(id === 'ob-deck-basic++');
			frontArea.setValue(next.front);
			backArea.setValue(next.back);
			cssArea.setValue(next.css);
		};

		new Setting(controlsHost)
			.setName('模板')
			.setDesc('选择要编辑样式的笔记类型（可与默认类型不同）。')
			.addDropdown((dropdown) => {
				for (const id of this.orderedTemplateIds()) {
					dropdown.addOption(id, deckTemplateLabel(id));
				}
				dropdown.setValue(editingId).onChange((value) => {
					const id = value as DeckTemplateId;
					this.editingTemplateId = id;
					refreshStyleControls(id);
				});
			});

		new Setting(controlsHost)
			.setName('模板类型')
			.setDesc(
				'问答型：正反面问答。判断型 / 选择型 / 填空型暂未开放。',
			)
			.addDropdown((dropdown) => {
				kindDropdown = dropdown.selectEl;
				for (const kind of DECK_CARD_KIND_IDS) {
					const label = DECK_CARD_KIND_AVAILABLE[kind]
						? DECK_CARD_KIND_LABELS[kind]
						: `${DECK_CARD_KIND_LABELS[kind]}（暂未开放）`;
					dropdown.addOption(kind, label);
				}
				const kind = normalizeDeckCardKind(style.kind);
				dropdown.setValue(
					DECK_CARD_KIND_AVAILABLE[kind] ? kind : 'qa',
				);
				for (const k of DECK_CARD_KIND_IDS) {
					if (!DECK_CARD_KIND_AVAILABLE[k]) {
						const opt = Array.from(
							dropdown.selectEl.options,
						).find((o) => o.value === k);
						opt?.setAttr('disabled', 'true');
					}
				}
				dropdown.onChange(async (value) => {
					const next = value as DeckCardKind;
					if (!DECK_CARD_KIND_AVAILABLE[next]) {
						new Notice(
							`${DECK_CARD_KIND_LABELS[next]}暂未开放，仍使用问答型`,
						);
						dropdown.setValue('qa');
						return;
					}
					await persistStyle(this.resolveEditingTemplateId(), {
						kind: next,
					});
				});
			});

		new Setting(controlsHost)
			.setName('是否翻转')
			.setDesc('True：生成正反两张卡片；False：仅正面→背面。ob-deck-basic++ 锁定为 True。')
			.addToggle((toggle) => {
				reversibleToggle = toggle;
				const id = editingId;
				const locked = id === 'ob-deck-basic++';
				toggle
					.setValue(isReversibleDeckTemplate(id, style))
					.setDisabled(locked)
					.onChange(async (value) => {
						const tid = this.resolveEditingTemplateId();
						if (tid === 'ob-deck-basic++') {
							return;
						}
						await persistStyle(tid, { reversible: value });
					});
			});

		frontArea = this.addTemplateTextArea(
			editorsHost,
			'Front HTML',
			'Anki 卡片正面 HTML（可用 {{ob-deck-head}} {{ob-deck-front}} {{ob-deck-back}} {{ob-deck-tags}} {{ob-deck-tree}} {{ob-deck-backlink}}）',
			style.front,
			async (value) => {
				await persistStyle(this.resolveEditingTemplateId(), {
					front: value,
				});
			},
		);

		backArea = this.addTemplateTextArea(
			editorsHost,
			'Back HTML',
			'Anki 卡片背面 HTML',
			style.back,
			async (value) => {
				await persistStyle(this.resolveEditingTemplateId(), {
					back: value,
				});
			},
		);

		cssArea = this.addTemplateTextArea(
			editorsHost,
			'Deck CSS',
			'笔记类型 CSS（更新时同步到 Anki）',
			style.css,
			async (value) => {
				await persistStyle(this.resolveEditingTemplateId(), {
					css: value,
				});
			},
			12,
		);

		const actionRow = new Setting(actionsHost);
		actionRow.settingEl.addClass('dta-template-action-row');
		actionRow
			.addButton((btn) =>
				btn
					.setButtonText('更新')
					.setCta()
					.onClick(async () => {
						const id = this.resolveEditingTemplateId();
						btn.setDisabled(true);
						try {
							const result = await forceUpdateOneDeckTemplate(
								this.plugin.settings,
								id,
								() => this.plugin.saveSettings(),
							);
							if (result === 'created') {
								new Notice(
									`已创建并更新「${deckTemplateLabel(id)}」`,
								);
							} else {
								new Notice(
									`已更新「${deckTemplateLabel(id)}」到 Anki`,
								);
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
			)
			.addButton((btn) =>
				btn
					.setButtonText('重置')
					.setWarning()
					.onClick(async () => {
						const id = this.resolveEditingTemplateId();
						const prev = styleOf(id);
						const defaults = defaultStyleFor(id);
						this.plugin.settings.deckTemplateStyles[id] = {
							front: defaults.front,
							back: defaults.back,
							css: defaults.css,
							reversible: isReversibleDeckTemplate(id, prev),
							kind: normalizeDeckCardKind(prev.kind),
						};
						await this.plugin.saveSettings();
						refreshStyleControls(id);
						new Notice(`已重置 ${deckTemplateLabel(id)} 的样式`);
					}),
			)
			.addButton((btn) =>
				btn.setButtonText('导入').onClick(async () => {
					const id = this.resolveEditingTemplateId();
					btn.setDisabled(true);
					try {
						const imported = await importDeckTemplateStyleFromAnki(
							this.ankiClient(),
							id,
							styleOf(id),
						);
						this.plugin.settings.deckTemplateStyles[id] = imported;
						await this.plugin.saveSettings();
						refreshStyleControls(id);
						new Notice(
							`已从 Anki 导入「${deckTemplateLabel(id)}」`,
						);
					} catch (error) {
						const msg =
							error instanceof Error
								? error.message
								: String(error);
						new Notice(`导入失败：${msg}`);
					} finally {
						btn.setDisabled(false);
					}
				}),
			);
	}

	/**
	 * Reorder custom templates inside deckTemplateOrder while keeping
	 * built-in slots in place.
	 */
	private applyCustomTemplateOrder(newCustomOrder: string[]): void {
		const full = this.orderedTemplateIds();
		const queue = [...newCustomOrder];
		const merged = full.map((id) =>
			isBuiltInDeckTemplate(id) ? id : (queue.shift() ?? id),
		);
		this.plugin.settings.deckTemplateOrder = normalizeDeckTemplateOrder(
			[...merged, ...queue],
			this.plugin.settings.customDeckTemplates,
		);
	}

	private renderCustomTemplateList(
		listEl: HTMLElement,
		customOrder: string[],
	): void {
		let dragFromId: string | null = null;
		let editingRow: HTMLElement | null = null;

		const persistOrderFromDom = async (): Promise<void> => {
			const next = Array.from(
				listEl.querySelectorAll<HTMLElement>('.dta-template-list-row'),
			)
				.map((row) => row.dataset.templateId ?? '')
				.filter((id) => id.length > 0);
			this.applyCustomTemplateOrder(next);
			await this.plugin.saveSettings();
		};

		const exitEditMode = (row: HTMLElement): void => {
			const nameEl = row.querySelector('.dta-template-list-name');
			const input = row.querySelector<HTMLInputElement>(
				'.dta-template-list-input',
			);
			const actions = row.querySelector('.dta-template-list-actions');
			const id = row.dataset.templateId ?? '';
			if (nameEl instanceof HTMLElement) {
				nameEl.setText(deckTemplateLabel(id));
				nameEl.removeClass('is-hidden');
			}
			input?.remove();
			actions?.querySelectorAll('.dta-template-edit-btn').forEach((el) => {
				el.remove();
			});
			actions
				?.querySelectorAll('.dta-template-action-btn.is-idle')
				.forEach((el) => el.removeClass('is-hidden'));
			row.removeClass('is-editing');
			if (editingRow === row) {
				editingRow = null;
			}
		};

		const enterEditMode = (row: HTMLElement, id: string): void => {
			if (editingRow && editingRow !== row) {
				exitEditMode(editingRow);
			}
			if (row.hasClass('is-editing')) {
				return;
			}
			editingRow = row;
			row.addClass('is-editing');
			row.draggable = false;

			const nameEl = row.querySelector('.dta-template-list-name');
			const actions = row.querySelector('.dta-template-list-actions');
			if (!(nameEl instanceof HTMLElement) || !actions) {
				return;
			}

			nameEl.addClass('is-hidden');
			actions
				.querySelectorAll('.dta-template-action-btn.is-idle')
				.forEach((el) => el.addClass('is-hidden'));

			const input = row.createEl('input', {
				cls: 'dta-template-list-input',
				attr: { type: 'text', spellcheck: 'false' },
			});
			input.value = id;
			nameEl.insertAdjacentElement('afterend', input);
			input.focus();
			input.select();

			const cancelBtn = actions.createEl('button', {
				cls: 'dta-template-action-btn dta-template-edit-btn',
				attr: {
					type: 'button',
					title: '取消',
					'aria-label': '取消',
				},
			});
			setIcon(cancelBtn, 'x');

			const confirmBtn = actions.createEl('button', {
				cls: 'dta-template-action-btn dta-template-edit-btn is-confirm',
				attr: {
					type: 'button',
					title: '确认',
					'aria-label': '确认',
				},
			});
			setIcon(confirmBtn, 'check');

			const cancel = (): void => {
				exitEditMode(row);
			};

			const confirm = async (): Promise<void> => {
				const next = sanitizeDeckTemplateId(input.value);
				if (!next || next === id) {
					exitEditMode(row);
					return;
				}
				const ok = await this.renameCustomTemplate(id, next);
				if (!ok) {
					input.focus();
					input.select();
					return;
				}
			};

			cancelBtn.addEventListener('click', (event) => {
				event.preventDefault();
				cancel();
			});
			confirmBtn.addEventListener('click', (event) => {
				event.preventDefault();
				void confirm();
			});
			input.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					void confirm();
				} else if (event.key === 'Escape') {
					event.preventDefault();
					cancel();
				}
			});
		};

		for (const id of customOrder) {
			const row = listEl.createDiv({ cls: 'dta-template-list-row' });
			row.dataset.templateId = id;
			row.draggable = false;

			const handle = row.createEl('button', {
				cls: 'dta-template-drag-handle',
				attr: {
					type: 'button',
					title: '拖拽排序',
					'aria-label': '拖拽排序',
				},
			});
			setIcon(handle, 'grip-vertical');
			handle.addEventListener('mousedown', () => {
				if (row.hasClass('is-editing')) {
					return;
				}
				row.draggable = true;
			});
			handle.addEventListener('mouseup', () => {
				row.draggable = false;
			});

			row.createSpan({
				cls: 'dta-template-list-name',
				text: deckTemplateLabel(id),
			});

			const actions = row.createDiv({
				cls: 'dta-template-list-actions',
			});

			const renameBtn = actions.createEl('button', {
				cls: 'dta-template-action-btn is-idle',
				attr: {
					type: 'button',
					title: '重命名',
					'aria-label': '重命名',
				},
			});
			setIcon(renameBtn, 'pencil');
			renameBtn.addEventListener('click', (event) => {
				event.preventDefault();
				enterEditMode(row, id);
			});

			const deleteBtn = actions.createEl('button', {
				cls: 'dta-template-action-btn is-idle is-warning',
				attr: {
					type: 'button',
					title: '删除',
					'aria-label': '删除',
				},
			});
			setIcon(deleteBtn, 'trash-2');
			deleteBtn.addEventListener('click', async (event) => {
				event.preventDefault();
				this.plugin.settings.customDeckTemplates =
					this.plugin.settings.customDeckTemplates.filter(
						(x) => x !== id,
					);
				delete this.plugin.settings.deckTemplateStyles[id];
				this.plugin.settings.deckTemplateOrder =
					normalizeDeckTemplateOrder(
						this.plugin.settings.deckTemplateOrder.filter(
							(x) => x !== id,
						),
						this.plugin.settings.customDeckTemplates,
					);
				if (this.plugin.settings.deckTemplate === id) {
					this.plugin.settings.deckTemplate = 'ob-deck-basic';
				}
				if (this.editingTemplateId === id) {
					this.editingTemplateId = 'ob-deck-basic';
				}
				await this.plugin.saveSettings();
				new Notice(`已删除自定义模板「${id}」`);
				this.display();
			});

			row.addEventListener('dragstart', (event) => {
				if (!row.draggable || row.hasClass('is-editing')) {
					event.preventDefault();
					return;
				}
				dragFromId = id;
				row.addClass('is-dragging');
				event.dataTransfer?.setData('text/plain', id);
				if (event.dataTransfer) {
					event.dataTransfer.effectAllowed = 'move';
				}
			});

			row.addEventListener('dragend', () => {
				dragFromId = null;
				row.draggable = false;
				row.removeClass('is-dragging');
				listEl
					.querySelectorAll('.dta-template-list-row.is-drop-target')
					.forEach((el) => el.removeClass('is-drop-target'));
			});

			row.addEventListener('dragover', (event) => {
				event.preventDefault();
				if (!dragFromId || dragFromId === id || row.hasClass('is-editing')) {
					return;
				}
				if (event.dataTransfer) {
					event.dataTransfer.dropEffect = 'move';
				}
				listEl
					.querySelectorAll('.dta-template-list-row.is-drop-target')
					.forEach((el) => el.removeClass('is-drop-target'));
				row.addClass('is-drop-target');
			});

			row.addEventListener('dragleave', () => {
				row.removeClass('is-drop-target');
			});

			row.addEventListener('drop', (event) => {
				event.preventDefault();
				row.removeClass('is-drop-target');
				const fromId =
					dragFromId ?? event.dataTransfer?.getData('text/plain');
				if (!fromId || fromId === id) {
					return;
				}
				const rows = Array.from(
					listEl.querySelectorAll<HTMLElement>(
						'.dta-template-list-row',
					),
				);
				const fromRow = rows.find(
					(el) => el.dataset.templateId === fromId,
				);
				if (!fromRow || fromRow === row) {
					return;
				}
				const rect = row.getBoundingClientRect();
				const before = event.clientY < rect.top + rect.height / 2;
				if (before) {
					listEl.insertBefore(fromRow, row);
				} else {
					listEl.insertBefore(fromRow, row.nextSibling);
				}
				void persistOrderFromDom();
			});
		}
	}

	/** @returns false when rename was rejected (duplicate / invalid). */
	private async renameCustomTemplate(
		oldId: string,
		rawName: string,
	): Promise<boolean> {
		if (isBuiltInDeckTemplate(oldId)) {
			return false;
		}
		const name = sanitizeDeckTemplateId(rawName);
		if (!name || name === oldId) {
			return true;
		}
		if (this.orderedTemplateIds().includes(name)) {
			new Notice(`模板「${name}」已存在`);
			return false;
		}
		const prev =
			this.plugin.settings.deckTemplateStyles[oldId] ??
			defaultStyleFor(oldId);
		this.plugin.settings.deckTemplateStyles[name] = { ...prev };
		delete this.plugin.settings.deckTemplateStyles[oldId];
		this.plugin.settings.customDeckTemplates =
			this.plugin.settings.customDeckTemplates.map((x) =>
				x === oldId ? name : x,
			);
		this.plugin.settings.deckTemplateOrder =
			this.plugin.settings.deckTemplateOrder.map((x) =>
				x === oldId ? name : x,
			);
		this.plugin.settings.deckTemplateOrder = normalizeDeckTemplateOrder(
			this.plugin.settings.deckTemplateOrder,
			this.plugin.settings.customDeckTemplates,
		);
		if (this.plugin.settings.deckTemplate === oldId) {
			this.plugin.settings.deckTemplate = name;
		}
		if (this.editingTemplateId === oldId) {
			this.editingTemplateId = name;
		}
		await this.plugin.saveSettings();
		new Notice(`已重命名为「${name}」`);
		this.display();
		return true;
	}

	private renderCustomFieldSettings(containerEl: HTMLElement): void {
		const section = this.beginSection(
			containerEl,
			'字段设置',
			'写入 Anki 的 tags / backlink / tree 字段。',
		);

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

		const linkTextSetting = new Setting(section)
			.setName('回链链接文本')
			.setDesc(
				'Auto：自动识别（标题 / ^块 ID / 打开笔记）；Custom：使用下方固定文案。',
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('auto', 'Auto')
					.addOption('custom', 'Custom')
					.setValue(this.plugin.settings.backlinkLinkTextMode)
					.onChange(async (value) => {
						this.plugin.settings.backlinkLinkTextMode =
							value === 'custom' ? 'custom' : 'auto';
						await this.plugin.saveSettings();
						syncCustomVisibility();
					}),
			);

		const customTextSetting = new Setting(section)
			.setName('Custom 链接文本')
			.setDesc('卡片回链锚点文字。默认为 backlink。')
			.addText((text) =>
				text
					.setPlaceholder('backlink')
					.setValue(this.plugin.settings.backlinkLinkText)
					.onChange(async (value) => {
						const next = value.trim() || 'backlink';
						this.plugin.settings.backlinkLinkText = next;
						await this.plugin.saveSettings();
					}),
			);

		const treeLinkSetting = new Setting(section)
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
						syncCustomVisibility();
					}),
			);

		const schemeSetting = new Setting(section)
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
						syncCustomVisibility();
					}),
			);

		const uidSetting = new Setting(section)
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

		const syncCustomVisibility = (): void => {
			const cardOn =
				this.plugin.settings.deckCardBacklinkEnabled !== false;
			const treeOn = this.plugin.settings.deckTreeEnabled !== false;
			const customMode =
				this.plugin.settings.backlinkLinkTextMode === 'custom';
			const treeLinkOn =
				this.plugin.settings.deckTreeLinkEnabled !== false;
			const needScheme = cardOn || (treeOn && treeLinkOn);
			const aduri = this.plugin.settings.backlinkScheme === 'aduri';

			linkTextSetting.settingEl.toggle(cardOn);
			customTextSetting.settingEl.toggle(cardOn && customMode);
			treeLinkSetting.settingEl.toggle(treeOn);
			schemeSetting.settingEl.toggle(needScheme);
			uidSetting.settingEl.toggle(needScheme && aduri);
		};

		// Parent toggles first in DOM order (insert before dependents).
		const cardHost = section.createDiv();
		section.insertBefore(cardHost, linkTextSetting.settingEl);
		new Setting(cardHost)
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
						syncCustomVisibility();
					}),
			);

		const treeHost = section.createDiv();
		section.insertBefore(treeHost, treeLinkSetting.settingEl);
		new Setting(treeHost)
			.setName('牌组树（ob-deck-tree）')
			.setDesc('写入牌组路径 crumbs（一级 > 牌组2 > …）。默认开启。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.deckTreeEnabled !== false)
					.onChange(async (value) => {
						this.plugin.settings.deckTreeEnabled = value;
						await this.plugin.saveSettings();
						syncCustomVisibility();
					}),
			);

		syncCustomVisibility();
	}

	private addTemplateTextArea(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		value: string,
		onChange: (value: string) => Promise<void>,
		rows = 6,
	): TextAreaComponent {
		const setting = new Setting(containerEl).setName(name).setDesc(desc);
		setting.settingEl.addClass('dta-setting-textarea');
		let area!: TextAreaComponent;
		setting.addTextArea((text) => {
			area = text;
			text.setValue(value).onChange((v) => {
				void onChange(v);
			});
			text.inputEl.rows = rows;
			text.inputEl.addClass('dta-template-textarea');
		});
		return area;
	}
}
