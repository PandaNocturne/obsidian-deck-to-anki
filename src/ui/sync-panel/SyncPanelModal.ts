import { parseFrontmatter } from '../../domain/head/frontmatter';
import type {
	CardNode,
	DeletedAnkiCardNode,
	DeckNode,
	DeckType,
	ParsedHeadFile,
} from '../../domain/head/types';
import { parseNoteFile } from '../../domain/parseNote';
import { resolveDeckFileParent } from '../../domain/resolveWikiFile';
import { parseVaultDeckForest } from '../../domain/scanDeckNotes';
import { assignSiblingIndexes } from '../../domain/head/siblingIndex';
import { resolveNumberingOptions } from '../../anki/numbering';
import type DeckToAnkiPlugin from '../../../main';
import { AnkiConnectClient } from '../../anki/AnkiConnectClient';
import {
	DECK_TEMPLATE_IDS,
	type DeckTemplateId,
} from '../../anki/templates';
import { syncCardListToAnki, syncNodesToAnki } from '../../anki/syncCard';
import {
	cardIdentityKeys,
	collectLocalCards,
	findCardsByIdentityKeys,
	prefetchSyncStatusForCards,
	restoreSyncStatusTree,
	shouldSkipOnUpdate,
	snapshotSyncStatusTree,
	type SyncStatusTreeSnapshot,
} from '../../anki/syncStatus';
import { DEFAULT_CARD_HEADING_LEVEL } from '../../settings';
import { App, MarkdownView, Modal, Notice, setIcon, TFile } from 'obsidian';
import { openCardPreview } from './CardPreviewModal';
import { openFileDeckSettings } from './FileDeckSettingsModal';
import { SyncPanelState, type SyncPanelTab } from './SyncPanelState';
import { renderSyncPanelTree } from './SyncPanelTree';
import { ProgressNotice } from './progressNotice';

export interface SyncPanelUIOptions {
	/**
	 * Tab set: `full` = 当前/所有/归档；`forest` = 仅所有/归档（侧边栏）。
	 * Default `full`.
	 */
	tabsMode?: 'full' | 'forest';
	/** Show Cancel in the footer (modal). Default false. */
	showCancel?: boolean;
	/** Close host when opening plugin settings (modal). Default false. */
	closeOnOpenSettings?: boolean;
	onRequestClose?: () => void;
}

interface SessionDeckSettings {
	deckType: DeckType;
	deckName: string;
	deckLevel: number;
	deckStatus: boolean;
	deckTemplate: DeckTemplateId;
	deckNumbering: boolean;
}

function asDeckTemplateId(
	value: string | undefined,
	fallback: DeckTemplateId,
): DeckTemplateId {
	if (value && DECK_TEMPLATE_IDS.includes(value as DeckTemplateId)) {
		return value as DeckTemplateId;
	}
	return fallback;
}

/** Note-level child under a file parent (deck or card leaf). */
function findChildNoteNode(
	root: DeckNode,
	childFilePath: string,
): DeckNode | CardNode | null {
	for (const child of root.children) {
		if (child.kind === 'deleted-anki') {
			continue;
		}
		if (child.sourceFilePath !== childFilePath) {
			continue;
		}
		if (child.kind === 'card' && child.deckClass === 'card') {
			return child;
		}
		if (child.kind === 'deck' && child.deckType) {
			return child;
		}
	}
	const walk = (node: DeckNode): DeckNode | CardNode | null => {
		for (const child of node.children) {
			if (child.kind === 'card') {
				if (
					child.sourceFilePath === childFilePath &&
					child.deckClass === 'card'
				) {
					return child;
				}
				continue;
			}
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

/**
 * Sync panel UI shared by modal and right-sidebar ItemView.
 * Does not touch vault files beyond the existing sync write paths.
 */
export class SyncPanelUI {
	private readonly plugin: DeckToAnkiPlugin;
	private readonly app: App;
	private readonly options: SyncPanelUIOptions;
	private hostEl!: HTMLElement;
	private readonly state = new SyncPanelState();
	/** Current-tab single note parse; null on all/archived forest views. */
	private parsed: ParsedHeadFile | null = null;
	/** Active tree root (single note or forest). */
	private viewRoot: DeckNode | null = null;
	private forestItems: ParsedHeadFile[] = [];
	private forestWarnings: string[] = [];
	private treeHostEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private currentTabEl: HTMLButtonElement | null = null;
	private allTabEl!: HTMLButtonElement;
	private archivedTabEl!: HTMLButtonElement;
	/** Session parse override for the active note (not written to YAML until Save/Update). */
	private sessionOverride: SessionDeckSettings | null = null;
	/** Session type overrides for file-mode child notes (path → values). */
	private readonly childOverrides = new Map<string, SessionDeckSettings>();
	/** When opened from a child via deckFile, the focused child deck name. */
	private focusChildLabel: string | null = null;
	/** True after a successful toolbar 检查; statuses survive reload until closed. */
	private ankiStatusChecked = false;
	/** Bumps to cancel in-flight background auto-check. */
	private bgCheckId = 0;
	/** Blocks overlapping check / sync / reload; drives button loading UI. */
	private busy: null | 'check' | 'sync' | 'reload' = null;
	private busyNodeId: string | null = null;
	private checkBtnEl!: HTMLButtonElement;
	private refreshBtnEl!: HTMLButtonElement;
	private updateBtnEl!: HTMLButtonElement;
	private forceBtnEl!: HTMLButtonElement;
	private progressEl!: HTMLElement;
	private progressLabelEl!: HTMLElement;
	private progressBarEl!: HTMLElement;

	constructor(plugin: DeckToAnkiPlugin, options: SyncPanelUIOptions = {}) {
		this.plugin = plugin;
		this.app = plugin.app;
		this.options = options;
		this.state.parseType = this.plugin.settings.defaultDeckType || 'head';
		this.state.cardLevel = this.defaultCardHeadingLevel();
		if (options.tabsMode === 'forest') {
			this.state.tab = 'all';
		}
	}

	/** Plugin setting default for head-mode card level (YAML deckLevel fallback). */
	private defaultCardHeadingLevel(): number {
		const level = this.plugin.settings.cardHeadingLevel;
		return Number.isInteger(level) && level >= 1 && level <= 6
			? level
			: DEFAULT_CARD_HEADING_LEVEL;
	}

	mount(hostEl: HTMLElement): void {
		this.hostEl = hostEl;
		this.renderChrome();
		void this.reload();
	}

	unmount(): void {
		this.hostEl?.empty();
		this.parsed = null;
		this.viewRoot = null;
		this.forestItems = [];
		this.focusChildLabel = null;
		this.ankiStatusChecked = false;
		this.bgCheckId += 1;
		this.busy = null;
		this.busyNodeId = null;
	}

	private renderChrome(): void {
		const contentEl = this.hostEl;
		contentEl.empty();

		const forestOnly = this.options.tabsMode === 'forest';
		const tabs = contentEl.createDiv({
			cls: forestOnly
				? 'dta-sync-tabs dta-sync-tabs--two'
				: 'dta-sync-tabs',
		});
		if (!forestOnly) {
			this.currentTabEl = tabs.createEl('button', {
				cls: 'dta-sync-tab',
				text: '当前卡片',
			});
			this.currentTabEl.addEventListener('click', () => {
				void this.switchTab('current');
			});
		} else {
			this.currentTabEl = null;
		}
		this.allTabEl = tabs.createEl('button', {
			cls: 'dta-sync-tab',
			text: '所有卡片',
		});
		this.archivedTabEl = tabs.createEl('button', {
			cls: 'dta-sync-tab',
			text: '归档卡片',
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
			if (this.busy) {
				return;
			}
			this.state.expandAll();
			this.renderBody();
		});

		const collapseBtn = toolbar.createEl('button', {
			cls: 'dta-sync-toolbar-btn clickable-icon',
			attr: { 'aria-label': '全部折叠', title: '全部折叠' },
		});
		setIcon(collapseBtn, 'chevrons-up');
		collapseBtn.addEventListener('click', () => {
			if (this.busy) {
				return;
			}
			this.state.collapseAll();
			this.renderBody();
		});

		const refreshBtn = toolbar.createEl('button', {
			cls: 'dta-sync-toolbar-btn clickable-icon',
			attr: { 'aria-label': '刷新', title: '重新解析' },
		});
		this.refreshBtnEl = refreshBtn;
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.addEventListener('click', () => {
			void this.handleRefresh();
		});

		const checkBtn = toolbar.createEl('button', {
			cls: 'dta-sync-toolbar-btn clickable-icon',
			attr: {
				'aria-label': '检查',
				title: '对照 Anki 检测勾选卡片的同步状态',
			},
		});
		this.checkBtnEl = checkBtn;
		setIcon(checkBtn, 'info');
		checkBtn.addEventListener('click', () => {
			void this.handleCheckStatus();
		});

		const settingsBtn = toolbar.createEl('button', {
			cls: 'dta-sync-toolbar-btn clickable-icon',
			attr: { 'aria-label': '插件设置', title: '打开插件设置' },
		});
		setIcon(settingsBtn, 'settings');
		settingsBtn.addEventListener('click', () => {
			if (this.busy) {
				return;
			}
			if (this.options.closeOnOpenSettings) {
				this.options.onRequestClose?.();
			}
			const setting = (
				this.app as unknown as {
					setting: { open: () => void; openTabById: (id: string) => void };
				}
			).setting;
			setting.open();
			setting.openTabById(this.plugin.manifest.id);
		});

		const bodyEl = contentEl.createDiv({ cls: 'dta-sync-body' });
		this.treeHostEl = bodyEl.createDiv({ cls: 'dta-sync-tree-host' });

		this.progressEl = contentEl.createDiv({
			cls: 'dta-sync-progress',
		});
		this.progressLabelEl = this.progressEl.createDiv({
			cls: 'dta-sync-progress-label',
			text: '就绪',
		});
		const track = this.progressEl.createDiv({
			cls: 'dta-sync-progress-track',
		});
		this.progressBarEl = track.createDiv({
			cls: 'dta-sync-progress-bar',
		});

		const footer = contentEl.createDiv({
			cls: this.options.showCancel
				? 'dta-sync-footer'
				: 'dta-sync-footer dta-sync-footer--two',
		});

		const forceBtn = footer.createEl('button', {
			cls: 'dta-sync-footer-btn mod-warning',
			text: 'Force',
			attr: { title: '强制同步勾选卡片（含已同步）' },
		});
		this.forceBtnEl = forceBtn;
		forceBtn.addEventListener('click', () => {
			void this.handleForce();
		});

		const updateBtn = footer.createEl('button', {
			cls: 'dta-sync-footer-btn mod-success',
			text: 'Update',
			attr: { title: '同步勾选卡片（跳过已同步）' },
		});
		this.updateBtnEl = updateBtn;
		updateBtn.addEventListener('click', () => {
			void this.handleUpdate();
		});

		if (this.options.showCancel) {
			const cancelBtn = footer.createEl('button', {
				cls: 'dta-sync-footer-btn',
				text: 'Cancel',
			});
			cancelBtn.addEventListener('click', () => {
				this.options.onRequestClose?.();
			});
		}
	}

	private setBusy(
		kind: 'check' | 'sync' | 'reload',
		nodeId?: string | null,
	): boolean {
		if (this.busy) {
			return false;
		}
		// Cancel background auto-check so it won't overwrite UI mid-action.
		this.bgCheckId += 1;
		this.busy = kind;
		this.busyNodeId = nodeId ?? null;
		this.applyBusyChrome();
		return true;
	}

	private clearBusy(): void {
		this.busy = null;
		this.busyNodeId = null;
		this.hidePanelProgress();
		this.applyBusyChrome();
	}

	private setPanelProgress(
		current: number,
		total: number,
		label: string,
	): void {
		const safeTotal = Math.max(total, 1);
		const ratio = Math.max(0, Math.min(1, current / safeTotal));
		this.progressLabelEl.setText(
			`${label} · ${Math.round(ratio * 100)}%`,
		);
		this.progressBarEl.style.width = `${(ratio * 100).toFixed(1)}%`;
	}

	/** Reset to idle; progress bar stays visible. */
	private hidePanelProgress(): void {
		this.progressBarEl.style.width = '0%';
		this.progressLabelEl.setText('就绪');
	}

	/** Keep toolbar / footer / row sync buttons disabled + spinning until done. */
	private applyBusyChrome(): void {
		const busy = this.busy !== null;
		const controls: HTMLButtonElement[] = [
			this.checkBtnEl,
			this.refreshBtnEl,
			this.updateBtnEl,
			this.forceBtnEl,
			this.allTabEl,
			this.archivedTabEl,
		];
		if (this.currentTabEl) {
			controls.push(this.currentTabEl);
		}
		for (const el of controls) {
			el.disabled = busy;
		}

		this.checkBtnEl.toggleClass('is-loading', this.busy === 'check');
		setIcon(
			this.checkBtnEl,
			this.busy === 'check' ? 'loader-circle' : 'info',
		);
		this.checkBtnEl.title =
			this.busy === 'check'
				? '检测中…'
				: '对照 Anki 检测勾选卡片的同步状态';

		this.refreshBtnEl.toggleClass('is-loading', this.busy === 'reload');
		setIcon(
			this.refreshBtnEl,
			this.busy === 'reload' ? 'loader-circle' : 'refresh-cw',
		);
		this.refreshBtnEl.title =
			this.busy === 'reload' ? '刷新中…' : '重新解析';

		const updateLoading = this.busy === 'sync' && !this.busyNodeId;
		this.updateBtnEl.toggleClass('is-loading', updateLoading);
		this.updateBtnEl.setText(updateLoading ? '同步中…' : 'Update');

		this.treeHostEl
			?.querySelectorAll<HTMLButtonElement>('[data-dta-sync]')
			.forEach((btn) => {
				const id = btn.getAttribute('data-dta-sync');
				const active = this.busy === 'sync' && id === this.busyNodeId;
				const idleIcon =
					(btn.getAttribute('aria-label') ?? '').includes('删除')
						? 'trash-2'
						: 'refresh-cw';
				btn.disabled = busy;
				btn.toggleClass('is-loading', active);
				setIcon(btn, active ? 'loader-circle' : idleIcon);
				btn.title = busy
					? '进行中…'
					: (btn.getAttribute('aria-label') ?? '');
			});
	}

	private async handleRefresh(): Promise<void> {
		if (!this.setBusy('reload')) {
			return;
		}
		try {
			await this.reload({ preserveTab: true });
		} finally {
			this.clearBusy();
		}
	}

	private async switchTab(tab: SyncPanelTab): Promise<void> {
		if (this.busy) {
			return;
		}
		if (this.options.tabsMode === 'forest' && tab === 'current') {
			tab = 'all';
		}
		if (tab === 'current' && !this.getActiveMarkdownFile()) {
			new Notice('未打开笔记，已切换到「所有卡片」');
			this.state.tab = 'all';
		} else {
			this.state.tab = tab;
		}
		// Status check is per view; switching tabs starts without prior colors.
		this.ankiStatusChecked = false;
		this.bgCheckId += 1;
		if (!this.setBusy('reload')) {
			return;
		}
		try {
			await this.reload({ preserveTab: true });
		} finally {
			this.clearBusy();
		}
	}

	private async reload(options?: {
		preserveTab?: boolean;
		/** Identity keys of cards to re-check against Anki after restore. */
		recheckKeys?: string[];
		/** Deleted phantoms removed from Anki during this sync. */
		removedDeletedNoteIds?: number[];
		/** Sticky notice to update during incremental recheck. */
		progress?: ProgressNotice;
	}): Promise<void> {
		const previousTab = this.state.tab;
		if (options?.preserveTab) {
			this.state.tab = previousTab;
		}
		const preserveCollapse = options?.preserveTab === true;

		let statusSnapshot: SyncStatusTreeSnapshot | null = null;
		if (
			preserveCollapse &&
			this.ankiStatusChecked &&
			this.viewRoot
		) {
			statusSnapshot = snapshotSyncStatusTree(this.viewRoot, (id) =>
				this.state.isSelected(id),
			);
		}

		const file = this.getActiveMarkdownFile();
		if (this.options.tabsMode === 'forest' && this.state.tab === 'current') {
			this.state.tab = 'all';
		}
		if (this.state.tab === 'current' && !file) {
			this.state.tab = 'all';
		}

		this.updateChromeState();
		const parsingMsg = '解析中…';
		this.statusEl.setText(parsingMsg);
		options?.progress?.setMessage(parsingMsg);

		if (this.state.tab === 'current') {
			await this.reloadCurrent(file!, { preserveCollapse });
		} else {
			await this.reloadForest(
				this.state.tab === 'archived' ? 'archived' : 'active',
				{ preserveCollapse },
			);
		}

		if (statusSnapshot && this.viewRoot) {
			restoreSyncStatusTree(this.viewRoot, statusSnapshot, {
				removedDeletedNoteIds: options?.removedDeletedNoteIds,
			});

			const recheckKeys = options?.recheckKeys ?? [];
			if (recheckKeys.length > 0) {
				const msg = '增量检测同步状态…';
				this.statusEl.setText(msg);
				options?.progress?.setMessage(msg);
				const cards = findCardsByIdentityKeys(
					this.viewRoot,
					recheckKeys,
				);
				const result = await prefetchSyncStatusForCards(
					this.app,
					this.plugin.settings,
					cards,
					async (p) => {
						this.setPanelProgress(p.current, p.total, p.label);
						options?.progress?.setMessage(p.label);
						await new Promise<void>((resolve) => {
							window.setTimeout(resolve, 0);
						});
					},
					{ root: this.viewRoot, mediaCache: this.plugin.mediaCompressCache },
				);
				this.state.restoreLeafSelection(
					this.viewRoot,
					statusSnapshot.selectedKeys,
				);
				if (result.warning) {
					this.statusEl.setText(result.warning);
					options?.progress?.setMessage(result.warning);
				}
			} else {
				this.state.restoreLeafSelection(
					this.viewRoot,
					statusSnapshot.selectedKeys,
				);
			}
		}

		this.renderBody();

		const skipAutoCheck =
			this.state.tab !== 'current' ||
			(options?.recheckKeys?.length ?? 0) > 0;
		if (!skipAutoCheck) {
			this.scheduleAutoCheckCurrentNote();
		}
	}

	/**
	 * After current-note tree is painted, optionally refresh Anki status
	 * in the background (setting: autoCheckCurrentNote).
	 */
	private scheduleAutoCheckCurrentNote(): void {
		if (this.plugin.settings.autoCheckCurrentNote === false) {
			return;
		}
		if (this.state.tab !== 'current' || !this.viewRoot) {
			return;
		}
		if (this.busy) {
			return;
		}

		const id = ++this.bgCheckId;
		window.setTimeout(() => {
			void this.runBackgroundAutoCheck(id);
		}, 0);
	}

	private async runBackgroundAutoCheck(id: number): Promise<void> {
		if (id !== this.bgCheckId || this.busy) {
			return;
		}
		if (this.state.tab !== 'current' || !this.viewRoot) {
			return;
		}

		const cards = this.collectSelectedCards();
		if (cards.length === 0) {
			return;
		}

		this.checkBtnEl.addClass('is-loading');
		setIcon(this.checkBtnEl, 'loader-circle');
		this.checkBtnEl.title = '后台检测中…';
		this.setPanelProgress(0, 1, `后台检测 ${cards.length} 张…`);
		this.statusEl.setText(`后台检测 ${cards.length} 张勾选卡片…`);

		try {
			const result = await prefetchSyncStatusForCards(
				this.app,
				this.plugin.settings,
				cards,
				async (p) => {
					if (id !== this.bgCheckId) {
						return;
					}
					this.setPanelProgress(p.current, p.total, p.label);
					this.statusEl.setText(p.label);
					await new Promise<void>((resolve) => {
						window.setTimeout(resolve, 0);
					});
				},
				{ root: this.viewRoot, mediaCache: this.plugin.mediaCompressCache },
			);

			if (id !== this.bgCheckId || this.busy) {
				return;
			}

			this.ankiStatusChecked = true;
			// Keep checkboxes; only refresh status colors on checked cards.
			this.renderBody();

			if (result.warning) {
				this.statusEl.setText(result.warning);
			} else {
				const hint =
					result.deletedCount > 0
						? `，仅 Anki ${result.deletedCount} 条`
						: '';
				this.statusEl.setText(
					`后台检测完成（${cards.length} 张${hint}）`,
				);
			}
		} catch (error) {
			if (id !== this.bgCheckId) {
				return;
			}
			const msg = error instanceof Error ? error.message : String(error);
			this.statusEl.setText(`后台检测失败：${msg}`);
		} finally {
			if (id === this.bgCheckId && !this.busy) {
				this.hidePanelProgress();
				this.applyBusyChrome();
			}
		}
	}

	private async reloadCurrent(
		file: TFile,
		options?: { preserveCollapse?: boolean },
	): Promise<void> {
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
			fallbackDeckLevel: this.defaultCardHeadingLevel(),
			childCardHeadingLevel: this.defaultCardHeadingLevel(),
			includeHeadingInFront:
				this.plugin.settings.headIncludeTitleInFront === true,
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

		const focusNode = focusChildPath
			? findChildNoteNode(parsed.root, focusChildPath)
			: null;
		this.focusChildLabel =
			focusNode?.kind === 'deck'
				? focusNode.name
				: focusNode?.kind === 'card'
					? focusNode.front
					: null;

		if (focusChildPath && !focusNode) {
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
			selectOnly: focusNode ?? undefined,
			preserveCollapse: options?.preserveCollapse === true,
		});
		assignSiblingIndexes(parsed.root);
	}

	private async reloadForest(
		mode: 'active' | 'archived',
		options?: { preserveCollapse?: boolean },
	): Promise<void> {
		this.sessionOverride = null;
		const result = await parseVaultDeckForest(this.app, {
			mode,
			includeFolders: this.plugin.settings.includeFolders ?? [],
			fallbackDeckLevel: this.defaultCardHeadingLevel(),
			childCardHeadingLevel: this.defaultCardHeadingLevel(),
			includeHeadingInFront:
				this.plugin.settings.headIncludeTitleInFront === true,
		});

		this.parsed = null;
		this.viewRoot = result.root;
		this.forestItems = result.items;
		this.forestWarnings = result.warnings;
		this.focusChildLabel = null;

		this.state.resetFromTree(result.root, {
			parseType: this.plugin.settings.defaultDeckType || 'head',
			cardLevel: this.defaultCardHeadingLevel(),
			preserveCollapse: options?.preserveCollapse === true,
		});
		assignSiblingIndexes(result.root);
	}

	private resolvePanelNumbering(): {
		deckNumbering: boolean;
	} {
		if (this.state.tab === 'current') {
			if (this.sessionOverride) {
				return {
					deckNumbering: this.sessionOverride.deckNumbering,
				};
			}
			if (this.parsed) {
				return resolveNumberingOptions(
					{
						deckNumbering: this.parsed.yamlDeckNumbering,
					},
					this.plugin.settings,
				);
			}
		}
		return resolveNumberingOptions({}, this.plugin.settings);
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

		const numbering = this.resolvePanelNumbering();
		const treeOptions = {
			parseType:
				this.parsed?.deckType ??
				this.state.parseType ??
				('head' as DeckType),
			showRootMeta: !isForest && this.parsed?.deckType !== 'card',
			// Forest + standalone card: no synthetic / nested deck chrome.
			skipRootRow: isForest || this.parsed?.deckType === 'card',
			busy: this.busy !== null,
			busyNodeId: this.busyNodeId,
			showDeckNumbers: numbering.deckNumbering,
		};

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
							: this.parsed?.deckType === 'card'
								? '未识别到卡片。去除 YAML 后，用单独一行的 --- 分隔正面与反面。'
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
					void this.handleSyncNode(node);
				},
				onDeckSettings: (deck) => {
					void this.openDeckSettings(deck);
				},
				onCardSettings: (card) => {
					void this.openCardNoteSettings(card);
				},
				onCardPreview: (card) => {
					openCardPreview(
						this.app,
						card,
						this.plugin.settings.deckViewMode ?? 'source',
					);
				},
				onCardOpen: (card) => {
					void this.openCard(card);
				},
				onOpenInAnki: (noteId) => {
					void this.openNoteInAnki(noteId);
				},
				onDeckOpen: (deck) => {
					void this.openDeck(deck);
				},
			},
			treeOptions,
		);
	}

	private async handleSyncNode(
		node: DeckNode | CardNode | DeletedAnkiCardNode,
	): Promise<void> {
		if (!this.setBusy('sync', node.id)) {
			return;
		}

		if (this.viewRoot) {
			assignSiblingIndexes(this.viewRoot);
		}

		try {
			if (node.kind === 'deleted-anki') {
				const noteId = node.noteId;
				const progress = new ProgressNotice(
					`正在从 Anki 删除「${node.front.slice(0, 24)}」…`,
				);
				try {
					await this.deleteAnkiNotes(
						[noteId],
						`已删除「${node.front.slice(0, 24)}」`,
						{ quiet: true },
					);
					await this.reload({
						preserveTab: true,
						removedDeletedNoteIds: [noteId],
						progress,
					});
					const done = `已删除「${node.front.slice(0, 24)}」`;
					this.statusEl.setText(done);
					progress.finish(done);
				} catch (error) {
					const msg =
						error instanceof Error ? error.message : String(error);
					progress.finish(`删除失败：${msg}`, 6000);
				}
				return;
			}

			const label =
				node.kind === 'deck'
					? `牌组「${node.name}」`
					: `卡片「${(node.front || '').slice(0, 32)}」`;
			const progress = new ProgressNotice(`${label}：同步中…`);
			this.statusEl.setText(`${label}：同步中…`);
			try {
				const cards =
					node.kind === 'deck' ? collectLocalCards(node) : [node];
				const result = await syncNodesToAnki(
					this.app,
					this.plugin.settings,
					node,
					{
						persistSettings: () => this.plugin.saveSettings(),
						mediaCache: this.plugin.mediaCompressCache,
					},
				);
				if (result.ok === 0 && result.fail === 0) {
					const empty = `${label}：没有可同步的卡片`;
					this.statusEl.setText(empty);
					progress.finish(empty);
					return;
				}
				const cleanupHint =
					result.emptyDecksDeleted > 0
						? `，清理空牌组 ${result.emptyDecksDeleted}`
						: '';
				const summary = `${label}：成功 ${result.ok}，失败 ${result.fail}${cleanupHint}`;
				this.statusEl.setText(summary);
				if (result.warnings.length > 0) {
					console.warn('[Deck To Anki] sync warnings', result.warnings);
				}
				progress.setMessage(`${summary}，刷新中…`);
				const recheckKeys = cards.flatMap((card) =>
					cardIdentityKeys(card),
				);
				await this.reload({ preserveTab: true, recheckKeys, progress });
				progress.finish(summary);
			} catch (error) {
				const msg =
					error instanceof Error ? error.message : String(error);
				this.statusEl.setText(`同步失败：${msg}`);
				progress.finish(`同步失败：${msg}`, 6000);
			}
		} finally {
			this.clearBusy();
		}
	}

	private async deleteAnkiNotes(
		noteIds: number[],
		label: string,
		options?: { quiet?: boolean },
	): Promise<void> {
		if (noteIds.length === 0) {
			return;
		}
		const client = new AnkiConnectClient(
			() =>
				this.plugin.settings.ankiConnectUrl ||
				'http://127.0.0.1:8765',
		);
		try {
			await client.ping();
			await client.deleteNotes(noteIds);
			const done = `${label}：已从 Anki 删除 ${noteIds.length} 条`;
			this.statusEl.setText(done);
			if (!options?.quiet) {
				new Notice(done);
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.statusEl.setText(`删除失败：${msg}`);
			if (!options?.quiet) {
				new Notice(`删除 Anki 笔记失败：${msg}`);
			}
			throw error;
		}
	}

	private async openNoteInAnki(noteId: number): Promise<void> {
		const client = new AnkiConnectClient(
			() =>
				this.plugin.settings.ankiConnectUrl ||
				'http://127.0.0.1:8765',
		);
		try {
			await client.ping();
			const cards = await client.guiBrowseNote(noteId);
			if (cards.length === 0) {
				new Notice(
					`Anki 中未找到笔记 ID ${noteId}（可能已删除，可重新同步）`,
				);
				return;
			}
			new Notice(`已在 Anki 浏览器中打开 ID ${noteId}`);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			new Notice(`无法打开 Anki 卡片：${msg}`);
		}
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
		if (card.deckClass === 'list') {
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

		// Card mode: one file one card — open the note (front is not a heading).
		if (card.deckClass === 'card') {
			await this.app.workspace.openLinkText(filePath, '', false);
			return;
		}

		const heading =
			(card.navTitle ?? card.front).trim();
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

	/** Card-mode note leaf → YAML settings (no nested deck row). */
	private async openCardNoteSettings(card: CardNode): Promise<void> {
		if (
			this.state.tab === 'current' &&
			this.parsed?.deckType === 'card' &&
			card.sourceFilePath === this.parsed.filePath
		) {
			await this.openDeckSettings(this.parsed.root);
			return;
		}

		const synthetic: DeckNode = {
			kind: 'deck',
			id: `deck:card-note:${card.sourceFilePath ?? card.id}`,
			name: card.front.slice(0, 40) || 'card',
			deckPath: card.deckPath,
			headingLevel: 0,
			lineStart: card.lineStart,
			cardCount: 1,
			children: [],
			sourceFilePath: card.sourceFilePath,
			deckType: 'card',
		};
		await this.openDeckSettings(synthetic);
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

		const fallbackLevel = this.defaultCardHeadingLevel();
		const fallbackTemplate = this.plugin.settings.deckTemplate;
		const defaultNumbering = resolveNumberingOptions(
			{},
			this.plugin.settings,
		);
		let deckType: DeckType = deck.deckType ?? this.state.parseType ?? 'head';
		let deckName = '';
		let deckLevel = fallbackLevel;
		let deckStatus = noteParsed?.deckStatus ?? false;
		let deckTemplate = asDeckTemplateId(
			noteParsed?.yamlDeckTemplate,
			fallbackTemplate,
		);
		let deckNumbering = defaultNumbering.deckNumbering;

		if (isCurrentRoot && this.parsed) {
			if (this.sessionOverride) {
				deckType = this.sessionOverride.deckType;
				deckName = this.sessionOverride.deckName;
				deckLevel = this.sessionOverride.deckLevel;
				deckStatus = this.sessionOverride.deckStatus;
				deckTemplate = this.sessionOverride.deckTemplate;
				deckNumbering = this.sessionOverride.deckNumbering;
			} else {
				deckType = this.state.parseType;
				deckName = this.parsed.yamlDeckName ?? '';
				deckLevel = this.state.cardLevel;
				deckStatus = this.parsed.deckStatus;
				deckTemplate = asDeckTemplateId(
					this.parsed.yamlDeckTemplate,
					fallbackTemplate,
				);
				const n = resolveNumberingOptions(
					{
						deckNumbering: this.parsed.yamlDeckNumbering,
					},
					this.plugin.settings,
				);
				deckNumbering = n.deckNumbering;
			}
		} else {
			const childOverride = this.childOverrides.get(file.path);
			if (childOverride) {
				deckType = childOverride.deckType;
				deckName = childOverride.deckName;
				deckLevel = childOverride.deckLevel;
				deckStatus = childOverride.deckStatus;
				deckTemplate = childOverride.deckTemplate;
				deckNumbering = childOverride.deckNumbering;
			} else {
				const content = await this.app.vault.cachedRead(file);
				const meta = parseFrontmatter(content);
				deckType = meta.deckType ?? deck.deckType ?? 'head';
				deckName = meta.deckName ?? '';
				deckLevel = meta.deckLevel ?? fallbackLevel;
				deckStatus = meta.deckStatus;
				deckTemplate = asDeckTemplateId(
					meta.deckTemplate,
					fallbackTemplate,
				);
				const n = resolveNumberingOptions(meta, this.plugin.settings);
				deckNumbering = n.deckNumbering;
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
			{
				deckType,
				deckName,
				deckLevel,
				deckStatus,
				deckTemplate,
				deckNumbering,
			},
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
							deckTemplate: values.deckTemplate,
							deckNumbering: values.deckNumbering,
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
						deckTemplate: values.deckTemplate,
						deckNumbering: values.deckNumbering,
					});
					new Notice(
						`子笔记已按 ${values.deckType} 解析（未写入 YAML）`,
					);
				}

				await this.reload({ preserveTab: true });
			},
			allowFileType
				? undefined
				: { allowedDeckTypes: ['head', 'list', 'card'] },
		);
	}

	/**
	 * Compare selected cards against Anki (toolbar 检查).
	 * Does not change checkbox selection.
	 */
	private async handleCheckStatus(): Promise<void> {
		if (!this.viewRoot) {
			new Notice('没有可检查的牌组');
			return;
		}
		const cards = this.collectSelectedCards();
		if (cards.length === 0) {
			new Notice('请先勾选要检测的卡片');
			this.statusEl.setText('未勾选卡片');
			return;
		}
		if (!this.setBusy('check')) {
			return;
		}

		const progress = new ProgressNotice(
			`正在检测 ${cards.length} 张勾选卡片…`,
		);
		this.statusEl.setText(`正在检测 ${cards.length} 张勾选卡片…`);
		this.setPanelProgress(0, 1, '准备检测…');
		try {
			const result = await prefetchSyncStatusForCards(
				this.app,
				this.plugin.settings,
				cards,
				async (p) => {
					this.setPanelProgress(p.current, p.total, p.label);
					progress.setMessage(p.label);
					this.statusEl.setText(p.label);
					await new Promise<void>((resolve) => {
						window.setTimeout(resolve, 0);
					});
				},
				{ root: this.viewRoot ?? undefined, mediaCache: this.plugin.mediaCompressCache },
			);
			this.ankiStatusChecked = true;
			this.renderBody();

			if (result.warning) {
				this.statusEl.setText(result.warning);
				progress.finish(result.warning, 6000);
				return;
			}

			const hint =
				result.deletedCount > 0
					? `，仅 Anki ${result.deletedCount} 条`
					: '';
			const summary = `状态检测完成（${cards.length} 张${hint}）`;
			this.statusEl.setText(summary);
			this.setPanelProgress(1, 1, summary);
			progress.finish(summary);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.statusEl.setText(`状态检测失败：${msg}`);
			progress.finish(`状态检测失败：${msg}`, 6000);
		} finally {
			this.clearBusy();
		}
	}

	/** Collect checked leaf cards under the current view tree. */
	private collectSelectedCards(): CardNode[] {
		if (!this.viewRoot) {
			return [];
		}
		const out: CardNode[] = [];
		const walk = (node: DeckNode | CardNode | DeletedAnkiCardNode) => {
			if (node.kind === 'card') {
				if (this.state.isSelected(node.id)) {
					out.push(node);
				}
				return;
			}
			if (node.kind === 'deleted-anki') {
				return;
			}
			for (const child of node.children) {
				walk(child);
			}
		};
		walk(this.viewRoot);
		return out;
	}

	private collectSelectedDeleted(): DeletedAnkiCardNode[] {
		if (!this.viewRoot) {
			return [];
		}
		const out: DeletedAnkiCardNode[] = [];
		const walk = (node: DeckNode | CardNode | DeletedAnkiCardNode) => {
			if (node.kind === 'deleted-anki') {
				if (this.state.isSelected(node.id)) {
					out.push(node);
				}
				return;
			}
			if (node.kind === 'card') {
				return;
			}
			for (const child of node.children) {
				walk(child);
			}
		};
		walk(this.viewRoot);
		return out;
	}

	/** Sync checked cards to Anki (Update：跳过已同步). */
	private async handleUpdate(): Promise<void> {
		await this.syncSelectedCards({
			skipSynced: true,
			actionLabel: 'Update',
		});
	}

	/** Force sync checked cards (含已同步，不跳过). */
	private async handleForce(): Promise<void> {
		await this.syncSelectedCards({
			skipSynced: false,
			actionLabel: 'Force',
		});
	}

	private async syncSelectedCards(options: {
		skipSynced: boolean;
		actionLabel: string;
	}): Promise<void> {
		const selectedCards = this.collectSelectedCards();
		const deleted = this.collectSelectedDeleted();
		const cards = options.skipSynced
			? selectedCards.filter((c) => !shouldSkipOnUpdate(c.syncStatus))
			: selectedCards;
		const skipped = selectedCards.length - cards.length;

		if (cards.length === 0 && deleted.length === 0) {
			if (options.skipSynced && selectedCards.length > 0) {
				new Notice(
					`已勾选 ${selectedCards.length} 张均为已同步，Update 已跳过（可用 Force 强制同步）`,
				);
				this.statusEl.setText('全部为已同步，已跳过');
				return;
			}
			new Notice('请先勾选要同步的卡片');
			this.statusEl.setText('未勾选卡片');
			return;
		}
		if (!this.setBusy('sync')) {
			return;
		}

		if (this.viewRoot) {
			assignSiblingIndexes(this.viewRoot);
		}

		const skipHint = skipped > 0 ? `，跳过已同步 ${skipped}` : '';
		const startMsg = `${options.actionLabel}：同步 ${cards.length} 张、删除 ${deleted.length} 条${skipHint}…`;
		const progress = new ProgressNotice(startMsg);
		this.statusEl.setText(startMsg);

		let ok = 0;
		let fail = 0;
		let emptyDecksDeleted = 0;
		const warnings: string[] = [];

		try {
			if (cards.length > 0) {
				const result = await syncCardListToAnki(
					this.app,
					this.plugin.settings,
					cards,
					{
						persistSettings: () => this.plugin.saveSettings(),
						mediaCache: this.plugin.mediaCompressCache,
					},
				);
				ok += result.ok;
				fail += result.fail;
				emptyDecksDeleted += result.emptyDecksDeleted;
				warnings.push(...result.warnings);
			}

			if (deleted.length > 0) {
				progress.setMessage(
					`正在从 Anki 删除 ${deleted.length} 条…`,
				);
				try {
					await this.deleteAnkiNotes(
						deleted.map((d) => d.noteId),
						'已删除条目',
						{ quiet: true },
					);
					ok += deleted.length;
				} catch {
					fail += deleted.length;
				}
			}

			const cleanupHint =
				emptyDecksDeleted > 0
					? `，清理空牌组 ${emptyDecksDeleted}`
					: '';
			const skippedHint = skipped > 0 ? `，跳过 ${skipped}` : '';
			const summary = `${options.actionLabel}：成功 ${ok}，失败 ${fail}${cleanupHint}${skippedHint}`;
			this.statusEl.setText(summary);
			if (warnings.length > 0) {
				console.warn(
					`[Deck To Anki] ${options.actionLabel} sync warnings`,
					warnings,
				);
			}
			progress.setMessage(`${summary}，刷新中…`);
			await this.reload({
				preserveTab: true,
				recheckKeys: cards.flatMap((card) => cardIdentityKeys(card)),
				removedDeletedNoteIds: deleted.map((d) => d.noteId),
				progress,
			});
			progress.finish(summary);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.statusEl.setText(`同步失败：${msg}`);
			progress.finish(`同步失败：${msg}`, 6000);
		} finally {
			this.clearBusy();
		}
	}

	private updateChromeState(): void {
		this.currentTabEl?.toggleClass(
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

export class SyncPanelModal extends Modal {
	private ui: SyncPanelUI | null = null;

	constructor(private readonly plugin: DeckToAnkiPlugin) {
		super(plugin.app);
	}

	onOpen(): void {
		this.modalEl.addClass('dta-sync-modal');
		this.titleEl.setText('Deck To Anki');
		this.ui = new SyncPanelUI(this.plugin, {
			showCancel: true,
			closeOnOpenSettings: true,
			onRequestClose: () => this.close(),
		});
		this.ui.mount(this.contentEl);
	}

	onClose(): void {
		this.ui?.unmount();
		this.ui = null;
	}
}

export function openSyncPanel(plugin: DeckToAnkiPlugin): void {
	new SyncPanelModal(plugin).open();
}
