import { App, Notice, PluginSettingTab, Setting, TextAreaComponent, setIcon } from 'obsidian';
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
import { renderScanScopeSettings } from './ui/settings/renderScanScopeSettings';

/** Fallback when settings / YAML have no deckLevel. */
export const DEFAULT_CARD_HEADING_LEVEL = 4;

/** Bump when shipping new built-in card Front/Back/CSS. */
export const DECK_TEMPLATE_STYLE_VERSION = 8;

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
	/**
	 * Parse Obsidian wiki links `[[...]]` into Anki field HTML.
	 * Default off: plain text only. On: `obsidian://open` (oburi) links.
	 */
	wikiLinkEnabled: boolean;
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
	 * - id: Anki note id (`ID 123456`)
	 * - custom: fixed label from `backlinkLinkText` (default "backlink")
	 */
	backlinkLinkTextMode: 'auto' | 'id' | 'custom';
	/** Used when backlinkLinkTextMode is custom. */
	backlinkLinkText: string;
	/** URI scheme for card backlink and tree links. */
	backlinkScheme: BacklinkScheme;
	/** Frontmatter property for Advanced URI uid. */
	advUriUidProperty: string;
	/**
	 * After parsing the current-card tab, auto-check Anki status in the
	 * background (tree renders first). Default on.
	 */
	autoCheckCurrentNote: boolean;
	/**
	 * After parsing the all-cards tab, auto-check Anki status in the
	 * background. Default off.
	 */
	autoCheckAllCards: boolean;
	/**
	 * When the user checks cards in the sync panel, auto-check Anki status
	 * for those cards in the background. Default on.
	 */
	autoCheckOnSelect: boolean;
	/**
	 * When status check finds Anki-only (deleted) notes, auto-check them
	 * in the sync panel. Default on.
	 */
	autoSelectDeletedCards: boolean;
	/**
	 * Require a successful Anki status check before Force/Update sync.
	 * Default on.
	 */
	requireCheckBeforeSync: boolean;
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
	/**
	 * Only scan notes under these folders (and subfolders).
	 * Empty = entire vault (`./`).
	 */
	includeFolders: string[];
	/** Exclude notes under these folders (and subfolders). */
	ignoreFolders: string[];
	/**
	 * Only scan notes that have at least one of these tags (nested match).
	 * Empty = no tag filter.
	 */
	includeTags: string[];
}

export const DEFAULT_SETTINGS: DeckToAnkiSettings = {
	defaultDeckType: 'head',
	cardHeadingLevel: DEFAULT_CARD_HEADING_LEVEL,
	headIncludeTitleInFront: false,
	wikiLinkEnabled: false,
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
	autoCheckAllCards: false,
	autoCheckOnSelect: true,
	autoSelectDeletedCards: true,
	requireCheckBeforeSync: true,
	deckNumberingEnabled: true,
	mediaCompressEnabled: true,
	mediaCompressQuality: 75,
	includeFolders: [],
	ignoreFolders: [],
	includeTags: [],
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
	if (typeof base.wikiLinkEnabled !== 'boolean') {
		base.wikiLinkEnabled = DEFAULT_SETTINGS.wikiLinkEnabled;
	}
	if (typeof base.autoCheckAllCards !== 'boolean') {
		base.autoCheckAllCards = DEFAULT_SETTINGS.autoCheckAllCards;
	}
	if (typeof base.autoCheckOnSelect !== 'boolean') {
		base.autoCheckOnSelect = DEFAULT_SETTINGS.autoCheckOnSelect;
	}
	if (!Array.isArray(base.includeFolders)) {
		base.includeFolders = [...DEFAULT_SETTINGS.includeFolders];
	}
	if (!Array.isArray(base.ignoreFolders)) {
		base.ignoreFolders = [...DEFAULT_SETTINGS.ignoreFolders];
	}
	if (!Array.isArray(base.includeTags)) {
		base.includeTags = [...DEFAULT_SETTINGS.includeTags];
	}
	// Drop unused legacy flag if present in old data.json.
	delete (base as { requireDeckTag?: unknown }).requireDeckTag;
	// Legacy unreleased name: originText (detected) → auto.
	const linkMode = base.backlinkLinkTextMode as string;
	if (linkMode === 'custom') {
		base.backlinkLinkTextMode = 'custom';
	} else if (linkMode === 'id') {
		base.backlinkLinkTextMode = 'id';
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
	/** Expanded template id in the merged template list (null = collapsed). */
	private editingTemplateId: DeckTemplateId | null = null;

	constructor(app: App, plugin: DeckToAnkiPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private orderedTemplateIds(): DeckTemplateId[] {
		return allDeckTemplateIdsOrdered(this.plugin.settings);
	}

	private resolveExpandedTemplateId(): DeckTemplateId | null {
		const known = this.orderedTemplateIds();
		const current = this.editingTemplateId;
		if (current && known.includes(current)) {
			return current;
		}
		this.editingTemplateId = null;
		return null;
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
		const fieldsTab = tabBar.createEl('button', {
			cls: 'dta-settings-tab',
			text: '字段',
			attr: { type: 'button' },
		});
		const templateTab = tabBar.createEl('button', {
			cls: 'dta-settings-tab',
			text: '模板',
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

		const fieldsPanel = containerEl.createDiv({
			cls: 'dta-settings-panel',
		});
		this.renderFieldReferenceSettings(fieldsPanel);
		this.renderCustomFieldSettings(fieldsPanel);

		const templatePanel = containerEl.createDiv({
			cls: 'dta-settings-panel',
		});
		this.renderTemplateSettings(templatePanel);

		const syncTabs = (): void => {
			const tab = this.activeSettingsTab;
			parseTab.toggleClass('is-active', tab === 'parse');
			syncTab.toggleClass('is-active', tab === 'sync');
			fieldsTab.toggleClass('is-active', tab === 'fields');
			templateTab.toggleClass('is-active', tab === 'template');
			parsePanel.toggle(tab === 'parse');
			syncPanel.toggle(tab === 'sync');
			fieldsPanel.toggle(tab === 'fields');
			templatePanel.toggle(tab === 'template');
		};

		parseTab.addEventListener('click', () => {
			this.activeSettingsTab = 'parse';
			syncTabs();
		});
		syncTab.addEventListener('click', () => {
			this.activeSettingsTab = 'sync';
			syncTabs();
		});
		fieldsTab.addEventListener('click', () => {
			this.activeSettingsTab = 'fields';
			syncTabs();
		});
		templateTab.addEventListener('click', () => {
			this.activeSettingsTab = 'template';
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
			.setName('Head 兼容模式：正面含标题')
			.setDesc(
				'Head 模式含 --- 时自动按 Card 解析。开启则正面包含标题；关闭则正面仅为 --- 上方正文。',
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
			.setName('解析 Wiki 链接')
			.setDesc(
				'关闭（默认）：`[[链接]]` 仅保留显示文本，不同步为可点击链接。开启：转为 oburi（obsidian://open）写入 Anki。不影响 `![[媒体]]` 嵌入。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.wikiLinkEnabled === true)
					.onChange(async (value) => {
						this.plugin.settings.wikiLinkEnabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(section)
			.setName('Deck View 默认视图')
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

		renderScanScopeSettings(this.plugin, containerEl, (el, title, desc) =>
			this.beginSection(el, title, desc),
		);

		const yamlSection = this.beginSection(
			containerEl,
			'YAML',
			'YAML 字段与解析结果对应关系。',
		);
		const yamlTable = yamlSection.createEl('table', {
			cls: 'dta-field-ref-table',
		});
		const yamlHead = yamlTable.createEl('thead').createEl('tr');
		yamlHead.createEl('th', { text: '字段' });
		yamlHead.createEl('th', { text: '说明' });
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
				key: 'deckID',
				desc: 'Card 模式：Anki 笔记 ID（同步后写入 YAML，不再写文件底部）。',
			},
			{
				key: 'deckNumbering',
				desc: '是否在同步树与 Anki 牌组路径显示序号。',
			},
		];
		const yamlBody = yamlTable.createEl('tbody');
		for (const field of yamlFields) {
			const tr = yamlBody.createEl('tr');
			const nameCell = tr.createEl('td');
			nameCell.createEl('code', { text: field.key });
			tr.createEl('td', { text: field.desc });
		}
	}

	private renderSyncSettings(containerEl: HTMLElement): void {
		const section = this.beginSection(
			containerEl,
			'同步',
			'AnkiConnect 连接与编号写入。',
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

		this.renderCheckSettings(containerEl);
	}

	private renderCheckSettings(containerEl: HTMLElement): void {
		const section = this.beginSection(
			containerEl,
			'检测',
			'同步面板对照 Anki 的自动检测与同步门槛。',
		);

		new Setting(section)
			.setName('打开当前卡片自动检测')
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
			.setName('打开所有卡片自动检测')
			.setDesc(
				'解析「所有卡片」后先显示树，再在后台对照 Anki 检测全部卡片。默认关闭。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoCheckAllCards === true)
					.onChange(async (value) => {
						this.plugin.settings.autoCheckAllCards = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(section)
			.setName('勾选时自动检测')
			.setDesc(
				'在同步面板勾选卡片或牌组时，后台对照 Anki 检测刚勾选的卡片。默认开启。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoCheckOnSelect !== false)
					.onChange(async (value) => {
						this.plugin.settings.autoCheckOnSelect = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(section)
			.setName('自动勾选已删除卡片')
			.setDesc(
				'状态检测发现「仅 Anki 存在」的卡片时自动勾选，便于 Update/Force 一并删除。默认开启。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.autoSelectDeletedCards !== false,
					)
					.onChange(async (value) => {
						this.plugin.settings.autoSelectDeletedCards = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(section)
			.setName('同步前需要检测')
			.setDesc(
				'开启后须先对照 Anki 完成状态检测，才能 Force/Update；关闭后可不检测直接同步。默认开启。',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.requireCheckBeforeSync !== false,
					)
					.onChange(async (value) => {
						this.plugin.settings.requireCheckBeforeSync = value;
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
		const manageSection = this.beginSection(containerEl, '模板');

		let newName = '';
		const createRow = manageSection.createDiv({
			cls: 'dta-template-create-row',
		});
		const nameInput = createRow.createEl('input', {
			cls: 'dta-template-create-input',
			attr: {
				type: 'text',
				placeholder: '新建模板名称',
				spellcheck: 'false',
			},
		});
		nameInput.addEventListener('input', () => {
			newName = nameInput.value;
		});
		const createBtn = createRow.createEl('button', {
			cls: 'dta-template-create-btn',
			text: '新建',
			attr: { type: 'button' },
		});
		const createTemplate = async (): Promise<void> => {
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
		};
		createBtn.addEventListener('click', () => {
			void createTemplate();
		});
		nameInput.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				void createTemplate();
			}
		});

		const listEl = manageSection.createDiv({ cls: 'dta-template-list' });
		this.renderTemplateList(listEl, this.orderedTemplateIds());
	}

	private styleOf(id: DeckTemplateId): DeckTemplateStyle {
		return (
			this.plugin.settings.deckTemplateStyles[id] ?? defaultStyleFor(id)
		);
	}

	private async persistStyle(
		id: DeckTemplateId,
		patch: Partial<DeckTemplateStyle>,
	): Promise<void> {
		this.plugin.settings.deckTemplateStyles[id] = {
			...this.styleOf(id),
			...patch,
		};
		await this.plugin.saveSettings();
	}

	private applyTemplateOrder(order: string[]): void {
		this.plugin.settings.deckTemplateOrder = normalizeDeckTemplateOrder(
			order,
			this.plugin.settings.customDeckTemplates,
		);
	}

	private renderTemplateList(
		listEl: HTMLElement,
		order: DeckTemplateId[],
	): void {
		let dragFromId: string | null = null;
		const expandedId = this.resolveExpandedTemplateId();

		const persistOrderFromDom = async (): Promise<void> => {
			const next = Array.from(
				listEl.querySelectorAll<HTMLElement>('.dta-template-item'),
			)
				.map((row) => row.dataset.templateId ?? '')
				.filter((id) => id.length > 0);
			this.applyTemplateOrder(next);
			await this.plugin.saveSettings();
		};

		for (const id of order) {
			const item = listEl.createDiv({ cls: 'dta-template-item' });
			item.dataset.templateId = id;
			const expanded = expandedId === id;
			if (expanded) {
				item.addClass('is-expanded');
			}

			const header = item.createDiv({ cls: 'dta-template-item-header' });
			header.draggable = false;

			const handle = header.createEl('button', {
				cls: 'dta-template-drag-handle',
				attr: {
					type: 'button',
					title: '拖拽排序',
					'aria-label': '拖拽排序',
				},
			});
			setIcon(handle, 'grip-vertical');
			handle.addEventListener('mousedown', () => {
				header.draggable = true;
			});
			handle.addEventListener('mouseup', () => {
				header.draggable = false;
			});

			const isDefault = this.plugin.settings.deckTemplate === id;
			if (isDefault) {
				item.addClass('is-default');
			}

			const defaultBtn = header.createEl('button', {
				cls: 'dta-template-default-btn' + (isDefault ? ' is-active' : ''),
				attr: {
					type: 'button',
					title: isDefault ? '当前默认类型' : '设为默认类型',
					'aria-label': isDefault ? '当前默认类型' : '设为默认类型',
				},
			});
			setIcon(defaultBtn, isDefault ? 'star' : 'star');
			defaultBtn.addEventListener('click', async (event) => {
				event.preventDefault();
				event.stopPropagation();
				if (this.plugin.settings.deckTemplate === id) {
					return;
				}
				this.plugin.settings.deckTemplate = id;
				await this.plugin.saveSettings();
				new Notice(`已设「${deckTemplateLabel(id)}」为默认类型`);
				this.display();
			});

			const nameWrap = header.createDiv({ cls: 'dta-template-list-name-wrap' });
			nameWrap.createSpan({
				cls: 'dta-template-list-name',
				text: deckTemplateLabel(id),
			});
			if (isDefault) {
				nameWrap.createSpan({
					cls: 'dta-template-default-badge',
					text: '默认',
				});
			}

			const actions = header.createDiv({
				cls: 'dta-template-list-actions',
			});

			const sendBtn = actions.createEl('button', {
				cls: 'dta-template-text-btn is-cta',
				text: '发送',
				attr: { type: 'button', title: '发送到 Anki' },
			});
			sendBtn.addEventListener('click', async (event) => {
				event.preventDefault();
				event.stopPropagation();
				sendBtn.setAttr('disabled', 'true');
				try {
					const result = await forceUpdateOneDeckTemplate(
						this.plugin.settings,
						id,
						() => this.plugin.saveSettings(),
					);
					if (result === 'created') {
						new Notice(`已创建并发送「${deckTemplateLabel(id)}」`);
					} else {
						new Notice(`已发送「${deckTemplateLabel(id)}」到 Anki`);
					}
				} catch (error) {
					const msg =
						error instanceof Error ? error.message : String(error);
					new Notice(`发送失败：${msg}`);
				} finally {
					sendBtn.removeAttribute('disabled');
				}
			});

			const resetBtn = actions.createEl('button', {
				cls: 'dta-template-text-btn is-warning',
				text: '重置',
				attr: { type: 'button', title: '重置 Front / Back / CSS' },
			});
			resetBtn.addEventListener('click', async (event) => {
				event.preventDefault();
				event.stopPropagation();
				const prev = this.styleOf(id);
				const defaults = defaultStyleFor(id);
				this.plugin.settings.deckTemplateStyles[id] = {
					front: defaults.front,
					back: defaults.back,
					css: defaults.css,
					reversible: isReversibleDeckTemplate(id, prev),
					kind: normalizeDeckCardKind(prev.kind),
				};
				await this.plugin.saveSettings();
				new Notice(`已重置 ${deckTemplateLabel(id)} 的样式`);
				if (this.editingTemplateId === id) {
					this.display();
				}
			});

			const importBtn = actions.createEl('button', {
				cls: 'dta-template-text-btn is-import',
				text: '导入',
				attr: { type: 'button', title: '从 Anki 导入同名笔记类型' },
			});
			importBtn.addEventListener('click', async (event) => {
				event.preventDefault();
				event.stopPropagation();
				importBtn.setAttr('disabled', 'true');
				try {
					const imported = await importDeckTemplateStyleFromAnki(
						this.ankiClient(),
						id,
						this.styleOf(id),
					);
					this.plugin.settings.deckTemplateStyles[id] = imported;
					await this.plugin.saveSettings();
					new Notice(`已从 Anki 导入「${deckTemplateLabel(id)}」`);
					if (this.editingTemplateId === id) {
						this.display();
					}
				} catch (error) {
					const msg =
						error instanceof Error ? error.message : String(error);
					new Notice(`导入失败：${msg}`);
				} finally {
					importBtn.removeAttribute('disabled');
				}
			});

			const editBtn = actions.createEl('button', {
				cls: 'dta-template-action-btn',
				attr: {
					type: 'button',
					title: expanded ? '收起' : '编辑',
					'aria-label': expanded ? '收起' : '编辑',
				},
			});
			setIcon(editBtn, expanded ? 'chevron-up' : 'pencil');
			editBtn.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.editingTemplateId = expanded ? null : id;
				this.display();
			});

			if (!isBuiltInDeckTemplate(id)) {
				const deleteBtn = actions.createEl('button', {
					cls: 'dta-template-action-btn is-warning',
					attr: {
						type: 'button',
						title: '删除',
						'aria-label': '删除',
					},
				});
				setIcon(deleteBtn, 'trash-2');
				deleteBtn.addEventListener('click', async (event) => {
					event.preventDefault();
					event.stopPropagation();
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
						this.editingTemplateId = null;
					}
					await this.plugin.saveSettings();
					new Notice(`已删除自定义模板「${id}」`);
					this.display();
				});
			}

			header.addEventListener('dragstart', (event) => {
				if (!header.draggable) {
					event.preventDefault();
					return;
				}
				dragFromId = id;
				item.addClass('is-dragging');
				event.dataTransfer?.setData('text/plain', id);
				if (event.dataTransfer) {
					event.dataTransfer.effectAllowed = 'move';
				}
			});
			header.addEventListener('dragend', () => {
				dragFromId = null;
				header.draggable = false;
				item.removeClass('is-dragging');
				listEl
					.querySelectorAll('.dta-template-item.is-drop-target')
					.forEach((el) => el.removeClass('is-drop-target'));
			});
			item.addEventListener('dragover', (event) => {
				event.preventDefault();
				if (!dragFromId || dragFromId === id) {
					return;
				}
				if (event.dataTransfer) {
					event.dataTransfer.dropEffect = 'move';
				}
				listEl
					.querySelectorAll('.dta-template-item.is-drop-target')
					.forEach((el) => el.removeClass('is-drop-target'));
				item.addClass('is-drop-target');
			});
			item.addEventListener('dragleave', () => {
				item.removeClass('is-drop-target');
			});
			item.addEventListener('drop', (event) => {
				event.preventDefault();
				item.removeClass('is-drop-target');
				const fromId =
					dragFromId ?? event.dataTransfer?.getData('text/plain');
				if (!fromId || fromId === id) {
					return;
				}
				const items = Array.from(
					listEl.querySelectorAll<HTMLElement>('.dta-template-item'),
				);
				const fromItem = items.find(
					(el) => el.dataset.templateId === fromId,
				);
				if (!fromItem || fromItem === item) {
					return;
				}
				const rect = item.getBoundingClientRect();
				const before = event.clientY < rect.top + rect.height / 2;
				if (before) {
					listEl.insertBefore(fromItem, item);
				} else {
					listEl.insertBefore(fromItem, item.nextSibling);
				}
				void persistOrderFromDom();
			});

			if (expanded) {
				this.renderTemplateEditor(
					item.createDiv({ cls: 'dta-template-item-body' }),
					id,
				);
			}
		}
	}

	private renderTemplateEditor(
		body: HTMLElement,
		id: DeckTemplateId,
	): void {
		const style = this.styleOf(id);
		const builtin = isBuiltInDeckTemplate(id);

		if (builtin) {
			new Setting(body)
				.setName('模板名称')
				.addText((text) => text.setValue(id).setDisabled(true));
		} else {
			let draftName = id;
			new Setting(body)
				.setName('模板名称')
				.addText((text) => {
					text.setValue(id).onChange((value) => {
						draftName = value;
					});
					text.inputEl.addEventListener('keydown', (event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							text.inputEl.blur();
						}
					});
					text.inputEl.addEventListener('blur', () => {
						void this.renameCustomTemplate(id, draftName);
					});
				});
		}

		new Setting(body)
			.setName('模板类型')
			.addDropdown((dropdown) => {
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
					await this.persistStyle(id, { kind: next });
				});
			});

		new Setting(body)
			.setName('是否翻转')
			.addToggle((toggle) => {
				const locked = id === 'ob-deck-basic++';
				toggle
					.setValue(isReversibleDeckTemplate(id, style))
					.setDisabled(locked)
					.onChange(async (value) => {
						if (id === 'ob-deck-basic++') {
							return;
						}
						await this.persistStyle(id, { reversible: value });
					});
			});

		this.addTemplateTextArea(
			body,
			'Front HTML',
			'',
			style.front,
			async (value) => {
				await this.persistStyle(id, { front: value });
			},
		);

		this.addTemplateTextArea(
			body,
			'Back HTML',
			'',
			style.back,
			async (value) => {
				await this.persistStyle(id, { back: value });
			},
		);

		this.addTemplateTextArea(
			body,
			'Deck CSS',
			'',
			style.css,
			async (value) => {
				await this.persistStyle(id, { css: value });
			},
			12,
		);
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
		if (!name) {
			new Notice('模板名称不能为空');
			return false;
		}
		if (name === oldId) {
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

	private renderFieldReferenceSettings(containerEl: HTMLElement): void {
		const section = this.beginSection(
			containerEl,
			'字段说明',
			'Anki 笔记类型（ob-deck-*）固定字段含义。',
		);

		const table = section.createEl('table', {
			cls: 'dta-field-ref-table',
		});
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		headRow.createEl('th', { text: '字段' });
		headRow.createEl('th', { text: '说明' });

		const rows: Array<{ field: string; desc: string }> = [
			{
				field: 'ob-deck-id',
				desc: '笔记身份字段（模型首字段，供 AnkiConnect 使用）；不在卡片正反面 HTML 中显示。',
			},
			{
				field: 'ob-deck-head',
				desc: '卡片标题（导航标题）；与正面正文分开存储。',
			},
			{
				field: 'ob-deck-front',
				desc: '卡片正面正文（不含标题时仅正文）。',
			},
			{
				field: 'ob-deck-back',
				desc: '卡片背面内容。',
			},
			{
				field: 'ob-deck-tags',
				desc: 'Obsidian 标签展示；可同步为 Anki 笔记标签。',
			},
			{
				field: 'ob-deck-tree',
				desc: '牌组路径面包屑（如 一级 > 子牌组）。',
			},
			{
				field: 'ob-deck-backlink',
				desc: '回链到 Obsidian 当前卡片（标题 / 块 / 文件）。',
			},
		];

		const tbody = table.createEl('tbody');
		for (const row of rows) {
			const tr = tbody.createEl('tr');
			const nameCell = tr.createEl('td');
			nameCell.createEl('code', { text: row.field });
			tr.createEl('td', { text: row.desc });
		}
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
				'Auto：自动识别（标题 / ^块 ID / 打开笔记）；ID：显示 Anki 笔记 ID；Custom：使用下方固定文案。',
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('auto', 'Auto')
					.addOption('id', 'ID')
					.addOption('custom', 'Custom')
					.setValue(this.plugin.settings.backlinkLinkTextMode)
					.onChange(async (value) => {
						this.plugin.settings.backlinkLinkTextMode =
							value === 'custom'
								? 'custom'
								: value === 'id'
									? 'id'
									: 'auto';
						await this.plugin.saveSettings();
						syncCustomVisibility();
					}),
			);

		const customTextSetting = new Setting(section)
			.setName('Custom 自定义文本')
			.setDesc('卡片回链锚点文字。默认为 backlink。')
			.addText((text) =>
				text
					.setPlaceholder('🔗backlink')
					.setValue(this.plugin.settings.backlinkLinkText)
					.onChange(async (value) => {
						const next = value.trim() || '🔗backlink';
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
				'从笔记 YAML 读取 uid；缺失或为空时自动生成并写入。head/list/card 分别用标题、块、仅文件定位。',
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
				'写入定位到当前卡片的链接：Head → 标题，List → 一级列表块（^AnkiID），Card → 文件。默认开启。',
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
		const setting = new Setting(containerEl).setName(name);
		if (desc) {
			setting.setDesc(desc);
		}
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
