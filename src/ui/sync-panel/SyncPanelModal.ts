import { MarkdownView, Modal, Notice, setIcon, TFile } from 'obsidian';
import type DeckToAnkiPlugin from '../../../main';
import { parseFileMode } from '../../domain/file/parseFileMode';
import { parseFrontmatter, upsertDeckYaml } from '../../domain/head/frontmatter';
import { parseHeadFile } from '../../domain/head/parseHeadFile';
import { parseListFile } from '../../domain/list/parseListFile';
import type {
	CardNode,
	DeckNode,
	DeckType,
	ParsedHeadFile,
} from '../../domain/head/types';
import { openFileDeckSettings } from './FileDeckSettingsModal';
import type { FileDeckSettingsValues } from './FileDeckSettingsModal';
import { SyncPanelState } from './SyncPanelState';
import { renderSyncPanelTree } from './SyncPanelTree';

export class SyncPanelModal extends Modal {
	private readonly plugin: DeckToAnkiPlugin;
	private readonly state = new SyncPanelState();
	private parsed: ParsedHeadFile | null = null;
	private treeHostEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private learningTabEl!: HTMLButtonElement;
	private archivedTabEl!: HTMLButtonElement;
	/** Session parse override for the active note (not written to YAML until Save/Update). */
	private sessionOverride: FileDeckSettingsValues | null = null;
	/** Session type overrides for file-mode child notes (path → values). */
	private readonly childOverrides = new Map<string, FileDeckSettingsValues>();

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
	}

	private renderChrome(): void {
		const { contentEl } = this;
		contentEl.empty();

		const tabs = contentEl.createDiv({ cls: 'dta-sync-tabs' });
		this.learningTabEl = tabs.createEl('button', {
			cls: 'dta-sync-tab',
			text: '学习中',
		});
		this.archivedTabEl = tabs.createEl('button', {
			cls: 'dta-sync-tab',
			text: '已归档',
		});
		this.learningTabEl.addEventListener('click', () => {
			this.state.tab = 'learning';
			this.renderBody();
		});
		this.archivedTabEl.addEventListener('click', () => {
			this.state.tab = 'archived';
			this.renderBody();
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
			attr: { 'aria-label': '刷新', title: '重新解析当前文件' },
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

	private async reload(options?: { preserveTab?: boolean }): Promise<void> {
		const previousTab = this.state.tab;
		const file = this.getActiveMarkdownFile();
		if (!file) {
			this.parsed = null;
			this.statusEl.setText('请先打开一个 Markdown 笔记。');
			this.treeHostEl.empty();
			this.updateChromeState();
			return;
		}

		const content = await this.app.vault.read(file);
		const meta = parseFrontmatter(content);
		const deckType =
			this.sessionOverride?.deckType ??
			meta.deckType ??
			this.plugin.settings.defaultDeckType ??
			'head';
		const deckLevel =
			this.sessionOverride?.deckLevel ??
			meta.deckLevel ??
			this.plugin.settings.cardHeadingLevel ??
			4;
		const childLevel = this.plugin.settings.cardHeadingLevel || 4;

		const childTypeOverrides = new Map<
			string,
			Exclude<DeckType, 'file'>
		>();
		for (const [path, values] of this.childOverrides) {
			if (values.deckType !== 'file') {
				childTypeOverrides.set(path, values.deckType);
			}
		}

		if (deckType === 'file') {
			this.parsed = await parseFileMode({
				app: this.app,
				sourceFile: file,
				content,
				options: { deckType: 'file', deckLevel },
				childCardHeadingLevel: childLevel,
				childTypeOverrides,
			});
		} else if (deckType === 'list') {
			this.parsed = parseListFile(file.path, content, {
				deckType: 'list',
				deckLevel,
			});
		} else if (deckType === 'head') {
			this.parsed = parseHeadFile(file.path, content, {
				deckType: 'head',
				deckLevel,
			});
		} else {
			this.parsed = parseHeadFile(file.path, content, {
				deckType,
				deckLevel,
			});
		}

		if (this.sessionOverride && this.parsed) {
			this.parsed = {
				...this.parsed,
				deckStatus: this.sessionOverride.deckStatus,
			};
		}

		this.state.resetFromParsed(this.parsed);
		if (this.sessionOverride) {
			this.state.parseType = this.sessionOverride.deckType;
			this.state.cardLevel = this.sessionOverride.deckLevel;
		}
		if (options?.preserveTab) {
			this.state.tab = previousTab;
		} else if (this.sessionOverride) {
			this.state.tab = this.sessionOverride.deckStatus
				? 'archived'
				: 'learning';
		}
		this.renderBody();
	}

	private renderBody(): void {
		this.updateChromeState();
		this.treeHostEl.empty();

		if (!this.parsed) {
			this.statusEl.setText('请先打开一个 Markdown 笔记。');
			return;
		}

		const showArchived = this.state.tab === 'archived';
		if (this.parsed.deckStatus !== showArchived) {
			this.statusEl.setText(
				showArchived
					? '当前文件 deckStatus 不为 true。'
					: '当前文件 deckStatus 为 true，请切换到「已归档」查看。',
			);
			return;
		}

		const yamlHint = this.parsed.yamlDeckType
			? `YAML ${this.parsed.yamlDeckType}`
			: 'YAML 未完整设置';
		const sessionHint =
			this.sessionOverride &&
			this.sessionOverride.deckType !== this.parsed.yamlDeckType
				? ' · 会话未写入'
				: '';
		const levelHint =
			this.parsed.deckType === 'head'
				? ` · H${this.parsed.deckLevel}`
				: '';
		const warningText =
			this.parsed.warnings.length > 0
				? this.parsed.warnings.join('；')
				: '';
		const summary = `${this.parsed.deckName} · ${this.parsed.root.cardCount} 张 · ${this.parsed.deckType}${levelHint} · ${yamlHint}${sessionHint}`;
		this.statusEl.setText(
			warningText ? `${summary} — ${warningText}` : summary,
		);

		if (this.parsed.deckType === 'basic') {
			renderSyncPanelTree(
				this.treeHostEl,
				this.parsed.root,
				this.state,
				{
					onToggleCollapse: () => undefined,
					onToggleSelect: () => undefined,
					onSyncStub: () => undefined,
					onDeckSettings: (deck) => {
						void this.openDeckSettings(deck);
					},
				},
				{ parseType: this.parsed.deckType },
			);
			this.treeHostEl.createDiv({
				cls: 'dta-sync-empty',
				text: 'basic 解析尚未实现。点根牌组设置修改 deckType。',
			});
			return;
		}

		if (
			this.parsed.root.cardCount === 0 &&
			this.parsed.root.children.length === 0
		) {
			renderSyncPanelTree(
				this.treeHostEl,
				this.parsed.root,
				this.state,
				{
					onToggleCollapse: () => undefined,
					onToggleSelect: () => undefined,
					onSyncStub: () => undefined,
					onDeckSettings: (deck) => {
						void this.openDeckSettings(deck);
					},
				},
				{ parseType: this.parsed.deckType },
			);
			this.treeHostEl.createDiv({
				cls: 'dta-sync-empty',
				text:
					this.parsed.deckType === 'file'
						? '未找到关联笔记或子笔记中无卡片。在正文添加 [[笔记]] 链接。'
						: this.parsed.deckType === 'list'
							? '未识别到一级列表项。标题用于分组，- / * / 1. 一级列表为卡片，次级列表为反面。'
							: '未识别到牌组或卡片。点根牌组设置调整 deckLevel。',
			});
			return;
		}

		renderSyncPanelTree(
			this.treeHostEl,
			this.parsed.root,
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
			},
			{ parseType: this.parsed.deckType },
		);
	}

	private async openCard(card: CardNode): Promise<void> {
		if (!this.parsed) {
			return;
		}

		const filePath = card.sourceFilePath ?? this.parsed.filePath;
		const heading =
			card.headingLevel > 0 ? card.front.trim() : '';
		const linktext = heading ? `${filePath}#${heading}` : filePath;
		await this.app.workspace.openLinkText(linktext, '', false);
	}

	private async openDeckSettings(deck: DeckNode): Promise<void> {
		const isRoot = deck.id === this.parsed?.root.id;
		const filePath = deck.sourceFilePath ?? this.parsed?.filePath;
		const file = filePath
			? this.app.vault.getAbstractFileByPath(filePath)
			: this.getActiveMarkdownFile();
		if (!(file instanceof TFile)) {
			new Notice('找不到对应笔记文件');
			return;
		}

		const fallbackLevel = this.plugin.settings.cardHeadingLevel || 4;
		let deckType: DeckType =
			deck.deckType ?? this.state.parseType ?? 'head';
		let deckName = '';
		let deckLevel = fallbackLevel;
		let deckStatus = this.state.tab === 'archived';

		if (isRoot && this.parsed) {
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
				if (deckType === 'file') {
					deckType = 'head';
				}
			}
		}

		openFileDeckSettings(
			this.plugin,
			file,
			{ deckType, deckName, deckLevel, deckStatus },
			async (values, result) => {
				if (isRoot) {
					if (result.persisted) {
						this.sessionOverride = null;
					} else {
						this.sessionOverride = { ...values };
						new Notice(
							`已切换解析为 ${values.deckType}（未写入 YAML，可用 Update/Save 保存）`,
						);
					}
				} else if (result.persisted) {
					this.childOverrides.delete(file.path);
				} else if (values.deckType !== 'file') {
					this.childOverrides.set(file.path, { ...values });
					new Notice(
						`子笔记已按 ${values.deckType} 解析（未写入 YAML）`,
					);
				}

				await this.reload({ preserveTab: true });
			},
			isRoot ? undefined : { allowedDeckTypes: ['head', 'basic', 'list'] },
		);
	}

	private async handleUpdate(): Promise<void> {
		const file = this.getActiveMarkdownFile();
		if (!file) {
			new Notice('请先打开一个 Markdown 笔记');
			return;
		}

		const content = await this.app.vault.read(file);
		const next = upsertDeckYaml(content, {
			deckType: this.state.parseType,
			deckName: this.parsed?.yamlDeckName,
			deckLevel:
				this.state.parseType === 'head' ? this.state.cardLevel : undefined,
			deckStatus: this.state.tab === 'archived',
		});

		if (next === content) {
			new Notice('YAML 已是最新');
		} else {
			await this.app.vault.modify(file, next);
			new Notice('已写入 YAML：deckType / deckName / deckLevel / deckStatus');
		}

		this.sessionOverride = null;
		await this.reload({ preserveTab: true });
	}

	private updateChromeState(): void {
		this.learningTabEl.toggleClass(
			'is-active',
			this.state.tab === 'learning',
		);
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
