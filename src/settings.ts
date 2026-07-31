import { App, Notice, PluginSettingTab, Setting, TextAreaComponent } from 'obsidian';
import type DeckToAnkiPlugin from '../main';
import type { MediaCompressCache } from './anki/mediaCompressCache';
import type { MediaProcessOptions } from './anki/processMedia';
import { forceUpdateDeckTemplate } from './anki/syncCard';
import {
	allDeckTemplateIds,
	createDefaultDeckTemplateStyles,
	defaultStyleFor,
	deckTemplateLabel,
	isBuiltInDeckTemplate,
	isReversibleDeckTemplate,
	normalizeDeckCardKind,
	sanitizeDeckTemplateId,
	BUILT_IN_DECK_TEMPLATE_IDS,
	DECK_CARD_KIND_AVAILABLE,
	DECK_CARD_KIND_IDS,
	DECK_CARD_KIND_LABELS,
	type DeckCardKind,
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
	/** User-defined Anki note type ids (in addition to built-ins). */
	customDeckTemplates: string[];
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

	const knownIds = allDeckTemplateIds(base.customDeckTemplates);
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
	private activeSettingsTab: 'parse' | 'sync' | 'template' = 'parse';

	constructor(app: App, plugin: DeckToAnkiPlugin) {
		super(app, plugin);
		this.plugin = plugin;
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

		const parsePanel = containerEl.createDiv({
			cls: 'dta-settings-panel',
		});
		this.renderParseSettings(parsePanel);

		const syncPanel = containerEl.createDiv({
			cls: 'dta-settings-panel',
		});
		this.renderSyncSettings(syncPanel);
		this.renderMediaSettings(syncPanel);
		this.renderCustomFieldSettings(syncPanel);

		const templatePanel = containerEl.createDiv({
			cls: 'dta-settings-panel',
		});
		this.renderTemplateSettings(templatePanel);

		containerEl.createEl('p', {
			cls: 'deck-to-anki-settings-hint',
			text: '笔记 YAML（camelCase）：deckType、deckName、deckLevel、deckStatus、deckTemplate、deckFile、deckNumbering。',
		});

		const syncTabs = (): void => {
			const tab = this.activeSettingsTab;
			parseTab.toggleClass('is-active', tab === 'parse');
			syncTab.toggleClass('is-active', tab === 'sync');
			templateTab.toggleClass('is-active', tab === 'template');
			parsePanel.toggle(tab === 'parse');
			syncPanel.toggle(tab === 'sync');
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
			'选择默认笔记类型，或将当前样式另存为新的 Anki 笔记类型。',
		);

		const styleSection = this.beginSection(
			containerEl,
			'样式设置',
			'编辑当前笔记类型的 Front / Back / CSS。',
		);

		styleSection.createEl('p', {
			cls: 'dta-settings-section-desc',
			text: 'ob-deck-head：标题 · ob-deck-front：正面正文 · ob-deck-back：背面 · ob-deck-tags：标签 · ob-deck-backlink：回链 · ob-deck-tree：牌组树',
		});

		const knownIds = (): DeckTemplateId[] =>
			allDeckTemplateIds(this.plugin.settings.customDeckTemplates);

		const templateId = this.plugin.settings.deckTemplate;
		const style =
			this.plugin.settings.deckTemplateStyles[templateId] ??
			defaultStyleFor(templateId);

		const headingEl = styleSection.createEl('h4', {
			text: `样式 · ${deckTemplateLabel(templateId)}`,
		});

		const frontArea = this.addTemplateTextArea(
			styleSection,
			'正面模板',
			'Anki 卡片正面 HTML（可用 {{ob-deck-head}} {{ob-deck-front}} {{ob-deck-back}} {{ob-deck-tags}} {{ob-deck-tree}} {{ob-deck-backlink}}）',
			style.front,
			async (value) => {
				const id = this.plugin.settings.deckTemplate;
				const st =
					this.plugin.settings.deckTemplateStyles[id] ??
					defaultStyleFor(id);
				st.front = value;
				this.plugin.settings.deckTemplateStyles[id] = st;
				await this.plugin.saveSettings();
			},
		);

		const backArea = this.addTemplateTextArea(
			styleSection,
			'背面模板',
			'Anki 卡片背面 HTML',
			style.back,
			async (value) => {
				const id = this.plugin.settings.deckTemplate;
				const st =
					this.plugin.settings.deckTemplateStyles[id] ??
					defaultStyleFor(id);
				st.back = value;
				this.plugin.settings.deckTemplateStyles[id] = st;
				await this.plugin.saveSettings();
			},
		);

		const cssArea = this.addTemplateTextArea(
			styleSection,
			'卡片 CSS',
			'笔记类型 CSS（仅首次创建或强制更新时同步到 Anki）',
			style.css,
			async (value) => {
				const id = this.plugin.settings.deckTemplate;
				const st =
					this.plugin.settings.deckTemplateStyles[id] ??
					defaultStyleFor(id);
				st.css = value;
				this.plugin.settings.deckTemplateStyles[id] = st;
				await this.plugin.saveSettings();
			},
			12,
		);

		const applyStyleToEditors = (id: DeckTemplateId): void => {
			const next =
				this.plugin.settings.deckTemplateStyles[id] ??
				defaultStyleFor(id);
			headingEl.setText(`样式 · ${deckTemplateLabel(id)}`);
			frontArea.setValue(next.front);
			backArea.setValue(next.back);
			cssArea.setValue(next.css);
		};

		new Setting(styleSection)
			.setName('重置样式')
			.setDesc('将当前笔记类型的正面 / 背面 / CSS 恢复为插件内置默认（保留可翻转设置）。')
			.addButton((btn) =>
				btn.setButtonText('重置').onClick(async () => {
					const id = this.plugin.settings.deckTemplate;
					const prev = this.plugin.settings.deckTemplateStyles[id];
					const defaults = defaultStyleFor(id);
					this.plugin.settings.deckTemplateStyles[id] = {
						front: defaults.front,
						back: defaults.back,
						css: defaults.css,
						reversible: isReversibleDeckTemplate(id, prev),
						kind: normalizeDeckCardKind(prev?.kind),
					};
					applyStyleToEditors(id);
					await this.plugin.saveSettings();
					new Notice(`已重置 ${deckTemplateLabel(id)} 的样式`);
				}),
			);

		new Setting(cardSection)
			.setName('默认笔记类型')
			.setDesc(
				'笔记 YAML 无 deckTemplate 时使用。可在牌组设置中按笔记覆盖。',
			)
			.addDropdown((dropdown) => {
				for (const id of knownIds()) {
					dropdown.addOption(id, deckTemplateLabel(id));
				}
				dropdown
					.setValue(this.plugin.settings.deckTemplate)
					.onChange(async (value) => {
						const id = value as DeckTemplateId;
						this.plugin.settings.deckTemplate = id;
						await this.plugin.saveSettings();
						applyStyleToEditors(id);
						this.display();
					});
			});

		new Setting(cardSection)
			.setName('模板类型')
			.setDesc(
				'问答型：正反面问答。判断型 / 选择型 / 填空型暂未开放。',
			)
			.addDropdown((dropdown) => {
				for (const kind of DECK_CARD_KIND_IDS) {
					const label = DECK_CARD_KIND_AVAILABLE[kind]
						? DECK_CARD_KIND_LABELS[kind]
						: `${DECK_CARD_KIND_LABELS[kind]}（暂未开放）`;
					dropdown.addOption(kind, label);
				}
				const id = this.plugin.settings.deckTemplate;
				const current =
					this.plugin.settings.deckTemplateStyles[id] ??
					defaultStyleFor(id);
				const kind = normalizeDeckCardKind(current.kind);
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
					const tid = this.plugin.settings.deckTemplate;
					const st =
						this.plugin.settings.deckTemplateStyles[tid] ??
						defaultStyleFor(tid);
					st.kind = next;
					this.plugin.settings.deckTemplateStyles[tid] = st;
					await this.plugin.saveSettings();
				});
			});

		new Setting(cardSection)
			.setName('是否可翻转')
			.setDesc(
				'开启后，一张笔记在 Anki 中生成两张卡片：正面→背面 与 背面→正面。ob-deck-basic++ 即默认开启可翻转。改动后请「强制更新」到 Anki。',
			)
			.addToggle((toggle) => {
				const id = this.plugin.settings.deckTemplate;
				const current =
					this.plugin.settings.deckTemplateStyles[id] ??
					defaultStyleFor(id);
				const locked = id === 'ob-deck-basic++';
				toggle
					.setValue(isReversibleDeckTemplate(id, current))
					.setDisabled(locked)
					.onChange(async (value) => {
						const tid = this.plugin.settings.deckTemplate;
						if (tid === 'ob-deck-basic++') {
							return;
						}
						const st =
							this.plugin.settings.deckTemplateStyles[tid] ??
							defaultStyleFor(tid);
						st.reversible = value;
						this.plugin.settings.deckTemplateStyles[tid] = st;
						await this.plugin.saveSettings();
					});
			});

		let saveAsName = '';
		new Setting(cardSection)
			.setName('另存为新模板')
			.setDesc(
				'用当前 Front / Back / CSS 与可翻转设置，创建新的 Anki 笔记类型（名称即 model 名）。',
			)
			.addText((text) =>
				text
					.setPlaceholder('例如 My Deck Template')
					.onChange((value) => {
						saveAsName = value;
					}),
			)
			.addButton((btn) =>
				btn.setButtonText('保存').setCta().onClick(async () => {
					const name = sanitizeDeckTemplateId(saveAsName);
					if (!name) {
						new Notice('请输入新模板名称');
						return;
					}
					if (knownIds().includes(name)) {
						new Notice(`模板「${name}」已存在`);
						return;
					}
					const fromId = this.plugin.settings.deckTemplate;
					const from =
						this.plugin.settings.deckTemplateStyles[fromId] ??
						defaultStyleFor(fromId);
					this.plugin.settings.deckTemplateStyles[name] = {
						front: from.front,
						back: from.back,
						css: from.css,
						reversible: isReversibleDeckTemplate(fromId, from),
						kind: normalizeDeckCardKind(from.kind),
					};
					this.plugin.settings.customDeckTemplates = [
						...this.plugin.settings.customDeckTemplates,
						name,
					];
					this.plugin.settings.deckTemplate = name;
					await this.plugin.saveSettings();
					new Notice(`已保存模板「${name}」`);
					this.display();
				}),
			);

		if (!isBuiltInDeckTemplate(this.plugin.settings.deckTemplate)) {
			new Setting(cardSection)
				.setName('删除当前自定义模板')
				.setDesc(
					'仅从插件设置移除；不会删除 Anki 中已有的笔记类型。',
				)
				.addButton((btn) =>
					btn.setButtonText('删除').setWarning().onClick(async () => {
						const id = this.plugin.settings.deckTemplate;
						if (isBuiltInDeckTemplate(id)) {
							return;
						}
						this.plugin.settings.customDeckTemplates =
							this.plugin.settings.customDeckTemplates.filter(
								(x) => x !== id,
							);
						delete this.plugin.settings.deckTemplateStyles[id];
						this.plugin.settings.deckTemplate = 'ob-deck-basic';
						await this.plugin.saveSettings();
						new Notice(`已删除自定义模板「${id}」`);
						this.display();
					}),
				);
		}

		new Setting(cardSection)
			.setName('强制更新模板到 Anki')
			.setDesc(
				'将所有内置与自定义模板的正面 / 背面 / CSS 写入 Anki。',
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
								new Notice('已创建并更新笔记类型');
							} else {
								new Notice('已强制更新全部模板样式');
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
		const section = this.beginSection(
			containerEl,
			'自定义字段',
			'控制写入 Anki 的标签、回链与牌组树字段。',
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
