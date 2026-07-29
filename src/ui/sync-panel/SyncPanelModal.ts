import { clearAllDeckYaml, upsertDeckYaml, parseFrontmatter } from '../../domain/head/frontmatter';
import type {
	CardNode,
	DeckNode,
	DeckType,
	ParsedHeadFile,
} from '../../domain/head/types';
import { parseNoteFile } from '../../domain/parseNote';
import { resolveDeckFileParent } from '../../domain/resolveWikiFile';
import { parseVaultDeckForest } from '../../domain/scanDeckNotes';
import type DeckToAnkiPlugin from '../../../main';
import { MarkdownView, Modal, Notice, setIcon, TFile } from 'obsidian';
import { openFileDeckSettings } from './FileDeckSettingsModal';
import { SyncPanelState, type SyncPanelTab } from './SyncPanelState';
import { renderSyncPanelTree } from './SyncPanelTree';

interface SessionDeckSettings {
	deckType: DeckType;
	deckName: string;
	deckLevel: number;
	deckStatus: boolean;
}

/** Note-level deck under a file parent (has deckType + matching source path). */
function findChildNoteDeck(
	root: DeckNode,
	childFilePath: string,
): DeckNode | null {
	for (const child of root.children) {
		if (
			child.kind === 'deck' &&
			child.sourceFilePath === childFilePath &&
			child.deckType
		) {
			return child;
		}
	}
	const walk = (node: DeckNode): DeckNode | null => {
		for (const child of node.children) {
			if (child.kind !== 'deck') {
				continue;
			}
			if (
				child.sourceFilePath === childFilePath &&
				child.deckType &&
				child.id.startsWith('deck:file:')
			) {
				return child;
			}
			const found = walk(child);
			if (found) {
				return found;
			}
		}
		return null;
	};
	return walk(root);
}

export class SyncPanelModal extends Modal {
	private readonly plugin: DeckToAnkiPlugin;
	private readonly state = new SyncPanelState();
	/** Current-tab single note parse; null on all/archived forest views. */
	private parsed: ParsedHeadFile | null = null;
	/** Active tree root (single note or forest). */
	private viewRoot: DeckNode | null = null;
	private forestItems: ParsedHeadFile[] = [];
	private forestWarnings: string[] = [];
	private treeHostEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private currentTabEl!: HTMLButtonElement;
	private allTabEl!: HTMLButtonElement;
	private archivedTabEl!: HTMLButtonElement;
	/** Session parse override for the active note (not written to YAML until Save/Update). */
	private sessionOverride: SessionDeckSettings | null = null;
	/** Session type overrides for file-mode child notes (path → values). */
	private readonly childOverrides = new Map<string, SessionDeckSettings>();
	/** When opened from a child via deckFile, the focused child deck name. */
	private focusChildLabel: string | null = null;

	constructor(plugin: DeckToAnkiPlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.state.parseType = this.plugin.settings.defaultDeckType || 'head';
		this.state.cardLevel = this.plugin.settings.cardHeadingLevel || 4;
	}

	onOpen(): void {
		this.modalEl.addClass('dta-sync-modal');
		this.titleEl.setText('Deck To Anki Sync');
		this.renderChrome();
		void this.reload();
	}

	onClose(): void {
		this.contentEl.empty();
		this.parsed = null;
		this.viewRoot = null;
		this.forestItems = [];
		this.focusChildLabel = null;
	}

	private renderChrome(): void {
		const { contentEl } = this;
		contentEl.empty();

		const tabs = contentEl.createDiv({ cls: 'dta-sync-tabs' });
		this.currentTabEl = tabs.createEl('button', {
			cls: 'dta-sync-tab',
			text: '当前卡片',
		});
		this.allTabEl = tabs.createEl('button', {
			cls: 'dta-sync-tab',
			text: '所有卡片',
		});
		this.archivedTabEl = tabs.createEl('button', {
			cls: 'dta-sync-tab',
			text: '归档卡片',
		});
		this.currentTabEl.addEventListener('click', () => {
			void this.switchTab('current');
		});
		this.allTabEl.addEventListener('click', () => {
			void this.switchTab('all');
		});
		this.archivedTabEl.addEventListener('click', () => {
			void this.switchTab('archived');
		});

		const meta = contentEl.createDiv({ cls: 'dta-sync-meta' });
		this.statusEl = meta.createDiv({ cls: 'dta-sync-status' });
		const toolbar = meta.createDiv({ cls: 'dta-sync-toolbar' });

		const expandBtn = toolbar.createEl('button', {
			cls: 'dta-sync-toolbar-btn clickable-icon',
			attr: { 'aria-label': '全部展开', title: '全部展开' },
		});
		setIcon(expandBtn, 'chevrons-down');
		expandBtn.addEventListener('click', () => {
			this.state.expandAll();
			this.renderBody();
		});

		const collapseBtn = toolbar.createEl('button', {
			cls: 'dta-sync-toolbar-btn clickable-icon',
			attr: { 'aria-label': '全部折叠', title: '全部折叠' },
		});
		setIcon(collapseBtn, 'chevrons-up');
		collapseBtn.addEventListener('click', () => {
			this.state.collapseAll();
			this.renderBody();
		});

		const refreshBtn = toolbar.createEl('button', {
			cls: 'dta-sync-toolbar-btn clickable-icon',
			attr: { 'aria-label': '刷新', title: '重新解析' },
		});
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.addEventListener('click', () => {
			void this.reload({ preserveTab: true });
		});

		const bodyEl = contentEl.createDiv({ cls: 'dta-sync-body' });
		this.treeHostEl = bodyEl.createDiv({ cls: 'dta-sync-tree-host' });

		const footer = contentEl.createDiv({ cls: 'dta-sync-footer' });

		const forceBtn = footer.createEl('button', {
			cls: 'dta-sync-footer-btn mod-warning',
			text: 'Force',
		});
		forceBtn.addEventListener('click', () => {
			new Notice('Force 同步尚未实现');
		});

		const updateBtn = footer.createEl('button', {
			cls: 'dta-sync-footer-btn mod-success',
			text: 'Update',
		});
		updateBtn.addEventListener('click', () => {
			void this.handleUpdate();
		});

		const cancelBtn = footer.createEl('button', {
			cls: 'dta-sync-footer-btn',
			text: 'Cancel',
		});
		cancelBtn.addEventListener('click', () => {
			this.close();
		});
	}

	private async switchTab(tab: SyncPanelTab): Promise<void> {
		if (tab === 'current' && !this.getActiveMarkdownFile()) {
			new Notice('未打开笔记，已切换到「所有卡片」');
			this.state.tab = 'all';
		} else {
			this.state.tab = tab;
		}
		await this.reload({ preserveTab: true });
	}

	private async reload(options?: { preserveTab?: boolean }): Promise<void> {
		const previousTab = this.state.tab;
		if (options?.preserveTab) {
			this.state.tab = previousTab;
		}

		const file = this.getActiveMarkdownFile();
		if (this.state.tab === 'current' && !file) {
			this.state.tab = 'all';
		}

		this.updateChromeState();
		this.statusEl.setText('解析中…');

		if (this.state.tab === 'current') {
			await this.reloadCurrent(file!);
		} else {
			await this.reloadForest(
				this.state.tab === 'archived' ? 'archived' : 'active',
			);
		}

		this.renderBody();
	}

	private async reloadCurrent(file: TFile): Promise<void> {
		const content = await this.app.vault.read(file);
		const meta = parseFrontmatter(content);

		let parseFile = file;
		let parseContent = content;
		let focusChildPath: string | null = null;

		// Child note with deckFile → open parent file deck, focus this child.
		if (meta.deckFile) {
			const parent = resolveDeckFileParent(this.app, meta.deckFile);
			if (parent && parent.path !== file.path) {
				parseFile = parent;
				parseContent = await this.app.vault.read(parent);
				focusChildPath = file.path;
			}
		}

		const childTypeOverrides = new Map<
			string,
			Exclude<DeckType, 'file'>
		>();
		for (const [path, values] of this.childOverrides) {
			if (values.deckType !== 'file') {
				childTypeOverrides.set(path, values.deckType);
			}
		}

		const useSessionOnParseTarget =
			Boolean(this.sessionOverride) && !focusChildPath;

		const parsed = await parseNoteFile(this.app, parseFile, parseContent, {
			deckType: useSessionOnParseTarget
				? this.sessionOverride?.deckType
				: undefined,
			deckLevel: useSessionOnParseTarget
				? this.sessionOverride?.deckLevel
				: undefined,
			fallbackDeckType: this.plugin.settings.defaultDeckType || 'head',
			fallbackDeckLevel: this.plugin.settings.cardHeadingLevel || 4,
			childCardHeadingLevel: this.plugin.settings.cardHeadingLevel || 4,
			childTypeOverrides,
		});

		if (!parsed) {
			this.parsed = null;
			this.viewRoot = null;
			this.forestItems = [];
			this.focusChildLabel = null;
			return;
		}

		if (useSessionOnParseTarget && this.sessionOverride) {
			parsed.deckStatus = this.sessionOverride.deckStatus;
		}

		this.parsed = parsed;
		this.viewRoot = parsed.root;
		this.forestItems = [parsed];
		this.forestWarnings = parsed.warnings;

		const focusDeck = focusChildPath
			? findChildNoteDeck(parsed.root, focusChildPath)
			: null;
		this.focusChildLabel = focusDeck?.name ?? null;

		if (focusChildPath && !focusDeck) {
			this.focusChildLabel = null;
			this.forestWarnings = [
				...this.forestWarnings,
				`未在父牌组中找到当前子笔记（deckFile → ${meta.deckFile}）`,
			];
		}

		this.state.resetFromTree(parsed.root, {
			parseType:
				(useSessionOnParseTarget
					? this.sessionOverride?.deckType
					: undefined) ?? parsed.deckType,
			cardLevel:
				(useSessionOnParseTarget
					? this.sessionOverride?.deckLevel
					: undefined) ?? parsed.deckLevel,
			selectOnly: focusDeck ?? undefined,
		});
	}

	private async reloadForest(mode: 'active' | 'archived'): Promise<void> {
		this.sessionOverride = null;
		const result = await parseVaultDeckForest(this.app, {
			mode,
			includeFolders: this.plugin.settings.includeFolders ?? [],
			fallbackDeckLevel: this.plugin.settings.cardHeadingLevel || 4,
			childCardHeadingLevel: this.plugin.settings.cardHeadingLevel || 4,
		});

		this.parsed = null;
		this.viewRoot = result.root;
		this.forestItems = result.items;
		this.forestWarnings = result.warnings;
		this.focusChildLabel = null;
		this.state.resetFromTree(result.root, {
			parseType: this.plugin.settings.defaultDeckType || 'head',
			cardLevel: this.plugin.settings.cardHeadingLevel || 4,
		});
	}

	private renderBody(): void {
		this.updateChromeState();
		this.treeHostEl.empty();

		if (!this.viewRoot) {
			this.statusEl.setText(
				this.state.tab === 'current'
					? '请先打开一个 Markdown 笔记。'
					: '没有可显示的牌组。',
			);
			return;
		}

		const isForest = this.state.tab !== 'current';
		const warningText =
			this.forestWarnings.length > 0
				? this.forestWarnings.slice(0, 5).join('；') +
					(this.forestWarnings.length > 5
						? `…（共 ${this.forestWarnings.length} 条）`
						: '')
				: '';

		if (isForest) {
			const label =
				this.state.tab === 'archived' ? '归档卡片' : '所有卡片';
			const summary = `${label} · ${this.forestItems.length} 个笔记 · ${this.viewRoot.cardCount} 张（仅含 YAML deckType）`;
			this.statusEl.setText(
				warningText ? `${summary} — ${warningText}` : summary,
			);
		} else if (this.parsed) {
			const yamlHint = this.parsed.yamlDeckType
				? `YAML ${this.parsed.yamlDeckType}`
				: 'YAML 未完整设置';
			const sessionHint =
				this.sessionOverride &&
				this.sessionOverride.deckType !== this.parsed.yamlDeckType
					? ' · 会话未写入'
					: '';
			const focusHint = this.focusChildLabel
				? ` · 仅勾选「${this.focusChildLabel}」`
				: '';
			const levelHint =
				this.parsed.deckType === 'head'
					? ` · H${this.parsed.deckLevel}`
					: '';
			const summary = `${this.parsed.deckName} · ${this.parsed.root.cardCount} 张 · ${this.parsed.deckType}${levelHint} · ${yamlHint}${sessionHint}${focusHint}`;
			this.statusEl.setText(
				warningText ? `${summary} — ${warningText}` : summary,
			);
		}

		const treeOptions = {
			parseType:
				this.parsed?.deckType ??
				this.state.parseType ??
				('head' as DeckType),
			showRootMeta: !isForest,
			skipRootRow: isForest,
			iconMode: this.plugin.settings.deckTreeIconMode ?? 'unified',
		};

		if (!isForest && this.parsed?.deckType === 'basic') {
			renderSyncPanelTree(
				this.treeHostEl,
				this.viewRoot,
				this.state,
				{
					onToggleCollapse: () => undefined,
					onToggleSelect: () => undefined,
					onSyncStub: () => undefined,
					onDeckSettings: (deck) => {
						void this.openDeckSettings(deck);
					},
					onDeckOpen: (deck) => {
						void this.openDeck(deck);
					},
				},
				treeOptions,
			);
			this.treeHostEl.createDiv({
				cls: 'dta-sync-empty',
				text: 'basic 解析尚未实现。点根牌组设置修改 deckType。',
			});
			return;
		}

		if (
			this.viewRoot.cardCount === 0 &&
			this.viewRoot.children.length === 0
		) {
			renderSyncPanelTree(
				this.treeHostEl,
				this.viewRoot,
				this.state,
				{
					onToggleCollapse: () => undefined,
					onToggleSelect: () => undefined,
					onSyncStub: () => undefined,
					onDeckSettings: (deck) => {
						void this.openDeckSettings(deck);
					},
					onDeckOpen: (deck) => {
						void this.openDeck(deck);
					},
				},
				treeOptions,
			);
			this.treeHostEl.createDiv({
				cls: 'dta-sync-empty',
				text: isForest
					? this.state.tab === 'archived'
						? '未找到带 deckType 且 deckStatus 为 true 的笔记。'
						: '未找到带 deckType 的笔记（已归档的在「归档卡片」）。'
					: this.parsed?.deckType === 'file'
						? '未找到关联笔记或子笔记中无卡片。在正文添加 [[笔记]] 链接。'
						: this.parsed?.deckType === 'list'
							? '未识别到一级列表项。标题用于分组，- / * / 1. 一级列表为卡片，次级列表为反面。'
							: '未识别到牌组或卡片。点根牌组设置调整 deckLevel。',
			});
			return;
		}

		renderSyncPanelTree(
			this.treeHostEl,
			this.viewRoot,
			this.state,
			{
				onToggleCollapse: (deckId) => {
					this.state.toggleCollapsed(deckId);
					this.renderBody();
				},
				onToggleSelect: (node, selected) => {
					this.state.setSelectedCascade(node, selected);
					this.renderBody();
				},
				onSyncStub: (node) => {
					const label =
						node.kind === 'deck'
							? `牌组「${node.name}」`
							: `卡片「${node.front}」`;
					new Notice(`${label}：同步功能尚未实现`);
				},
				onDeckSettings: (deck) => {
					void this.openDeckSettings(deck);
				},
				onCardOpen: (card) => {
					void this.openCard(card);
				},
				onDeckOpen: (deck) => {
					void this.openDeck(deck);
				},
			},
			treeOptions,
		);
	}

	private async openCard(card: CardNode): Promise<void> {
		const filePath =
			card.sourceFilePath ??
			this.parsed?.filePath ??
			this.forestItems.find((item) =>
				card.id.includes(item.filePath),
			)?.filePath;
		if (!filePath) {
			new Notice('找不到卡片对应笔记');
			return;
		}

		// List cards jump via Obsidian block id only.
		if (card.headingLevel === 0) {
			if (!card.blockId) {
				new Notice('列表项无块 ID（^id），无法跳转（仅可解析）');
				return;
			}
			await this.app.workspace.openLinkText(
				`${filePath}#^${card.blockId}`,
				'',
				false,
			);
			return;
		}

		const heading = card.front.trim();
		const linktext = heading ? `${filePath}#${heading}` : filePath;
		await this.app.workspace.openLinkText(linktext, '', false);
	}

	private async openDeck(deck: DeckNode): Promise<void> {
		const filePath =
			deck.sourceFilePath ??
			this.parsed?.filePath ??
			this.findParsedForDeck(deck)?.filePath;
		if (!filePath) {
			new Notice('找不到牌组对应笔记');
			return;
		}

		// Heading decks → file#heading; note-level / file root → file only.
		const heading =
			deck.headingLevel > 0 && deck.lineStart >= 0
				? deck.name.trim()
				: '';
		const linktext = heading ? `${filePath}#${heading}` : filePath;
		await this.app.workspace.openLinkText(linktext, '', false);
	}

	private findParsedForDeck(deck: DeckNode): ParsedHeadFile | null {
		if (this.parsed && deck.id === this.parsed.root.id) {
			return this.parsed;
		}
		const byPath = deck.sourceFilePath
			? this.forestItems.find((item) => item.filePath === deck.sourceFilePath)
			: undefined;
		if (byPath) {
			return byPath;
		}
		return (
			this.forestItems.find((item) => item.root.id === deck.id) ?? null
		);
	}

	private async openDeckSettings(deck: DeckNode): Promise<void> {
		const noteParsed = this.findParsedForDeck(deck);
		const isCurrentRoot =
			this.state.tab === 'current' &&
			this.parsed != null &&
			deck.id === this.parsed.root.id;
		const isForestNoteRoot = this.forestItems.some(
			(item) => item.root.id === deck.id,
		);

		if (!deck.deckType && !isCurrentRoot) {
			new Notice('该节点不是笔记级牌组，无法设置 YAML');
			return;
		}

		const filePath = deck.sourceFilePath ?? noteParsed?.filePath;
		const file = filePath
			? this.app.vault.getAbstractFileByPath(filePath)
			: this.getActiveMarkdownFile();
		if (!(file instanceof TFile)) {
			new Notice('找不到对应笔记文件');
			return;
		}

		const fallbackLevel = this.plugin.settings.cardHeadingLevel || 4;
		let deckType: DeckType = deck.deckType ?? this.state.parseType ?? 'head';
		let deckName = '';
		let deckLevel = fallbackLevel;
		let deckStatus = noteParsed?.deckStatus ?? false;

		if (isCurrentRoot && this.parsed) {
			if (this.sessionOverride) {
				deckType = this.sessionOverride.deckType;
				deckName = this.sessionOverride.deckName;
				deckLevel = this.sessionOverride.deckLevel;
				deckStatus = this.sessionOverride.deckStatus;
			} else {
				deckType = this.state.parseType;
				deckName = this.parsed.yamlDeckName ?? '';
				deckLevel = this.state.cardLevel;
				deckStatus = this.parsed.deckStatus;
			}
		} else {
			const childOverride = this.childOverrides.get(file.path);
			if (childOverride) {
				deckType = childOverride.deckType;
				deckName = childOverride.deckName;
				deckLevel = childOverride.deckLevel;
				deckStatus = childOverride.deckStatus;
			} else {
				const content = await this.app.vault.cachedRead(file);
				const meta = parseFrontmatter(content);
				deckType = meta.deckType ?? deck.deckType ?? 'head';
				deckName = meta.deckName ?? '';
				deckLevel = meta.deckLevel ?? fallbackLevel;
				deckStatus = meta.deckStatus;
				if (
					deckType === 'file' &&
					!isForestNoteRoot &&
					!isCurrentRoot
				) {
					deckType = 'head';
				}
			}
		}

		const allowFileType = isCurrentRoot || isForestNoteRoot;
		openFileDeckSettings(
			this.plugin,
			file,
			{ deckType, deckName, deckLevel, deckStatus },
			async (values, result) => {
				if (values.deckType === 'none') {
					if (result.persisted) {
						if (isCurrentRoot) {
							this.sessionOverride = null;
						}
						this.childOverrides.delete(file.path);
						new Notice('已清除 deck 属性，将按默认类型解析');
					}
					await this.reload({ preserveTab: true });
					return;
				}

				if (isCurrentRoot) {
					if (result.persisted) {
						this.sessionOverride = null;
					} else {
						this.sessionOverride = {
							deckType: values.deckType,
							deckName: values.deckName,
							deckLevel: values.deckLevel,
							deckStatus: values.deckStatus,
						};
						new Notice(
							`已切换解析为 ${values.deckType}（未写入 YAML，可用 Update/Save 保存）`,
						);
					}
				} else if (result.persisted) {
					this.childOverrides.delete(file.path);
				} else if (values.deckType !== 'file') {
					this.childOverrides.set(file.path, {
						deckType: values.deckType,
						deckName: values.deckName,
						deckLevel: values.deckLevel,
						deckStatus: values.deckStatus,
					});
					new Notice(
						`子笔记已按 ${values.deckType} 解析（未写入 YAML）`,
					);
				}

				await this.reload({ preserveTab: true });
			},
			allowFileType
				? undefined
				: { allowedDeckTypes: ['head', 'basic', 'list'] },
		);
	}

	private async handleUpdate(): Promise<void> {
		if (this.state.tab !== 'current') {
			new Notice('请在「当前卡片」中更新打开笔记的 YAML');
			return;
		}

		const file = this.getActiveMarkdownFile();
		if (!file) {
			new Notice('请先打开一个 Markdown 笔记');
			return;
		}

		const content = await this.app.vault.read(file);
		const meta = parseFrontmatter(content);
		// Preserve file-mode child → parent index; rewrite in quoted form on Update.
		const preservedDeckFile = meta.deckFile;

		const deckType = this.state.parseType;
		const deckName =
			this.sessionOverride?.deckName?.trim() ||
			this.parsed?.yamlDeckName?.trim() ||
			'';
		const deckStatus =
			this.sessionOverride?.deckStatus ??
			this.parsed?.deckStatus ??
			false;

		// Full overwrite: clear all deck* keys, then write current panel values.
		const cleared = clearAllDeckYaml(content);
		const next = upsertDeckYaml(cleared, {
			deckType,
			deckName: deckName || undefined,
			deckLevel: deckType === 'head' ? this.state.cardLevel : undefined,
			deckStatus,
			deckFile: preservedDeckFile ?? null,
		});

		if (next === content) {
			new Notice('YAML 已是最新');
		} else {
			await this.app.vault.modify(file, next);
			new Notice('已覆盖写入 YAML：deckType / deckName / deckLevel / deckStatus');
		}

		this.sessionOverride = null;
		await this.reload({ preserveTab: true });
	}

	private updateChromeState(): void {
		this.currentTabEl.toggleClass(
			'is-active',
			this.state.tab === 'current',
		);
		this.allTabEl.toggleClass('is-active', this.state.tab === 'all');
		this.archivedTabEl.toggleClass(
			'is-active',
			this.state.tab === 'archived',
		);
	}

	private getActiveMarkdownFile(): TFile | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		return file instanceof TFile ? file : null;
	}
}

export function openSyncPanel(plugin: DeckToAnkiPlugin): void {
	new SyncPanelModal(plugin).open();
}
