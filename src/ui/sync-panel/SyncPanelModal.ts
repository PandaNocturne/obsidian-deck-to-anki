import { MarkdownView, Modal, Notice, setIcon, TFile } from 'obsidian';
import type DeckToAnkiPlugin from '../../../main';
import { parseFrontmatter, upsertDeckYaml } from '../../domain/head/frontmatter';
import { parseHeadFile } from '../../domain/head/parseHeadFile';
import type { CardNode, ParsedHeadFile } from '../../domain/head/types';
import { openFileDeckSettings } from './FileDeckSettingsModal';
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
			meta.deckType ?? this.plugin.settings.defaultDeckType ?? 'head';
		const deckLevel =
			meta.deckLevel ?? this.plugin.settings.cardHeadingLevel ?? 4;

		this.parsed = parseHeadFile(file.path, content, {
			deckType,
			deckLevel,
		});
		this.state.resetFromParsed(this.parsed);
		if (options?.preserveTab) {
			this.state.tab = previousTab;
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
			? `YAML ${this.parsed.yamlDeckType}/H${this.parsed.yamlDeckLevel ?? this.parsed.deckLevel}`
			: 'YAML 未完整设置';
		const warningText =
			this.parsed.warnings.length > 0
				? this.parsed.warnings.join('；')
				: '';
		const summary = `${this.parsed.deckName} · ${this.parsed.root.cardCount} 张 · ${this.parsed.deckType} · H${this.parsed.deckLevel} · ${yamlHint}`;
		this.statusEl.setText(
			warningText ? `${summary} — ${warningText}` : summary,
		);

		if (this.parsed.deckType !== 'head') {
			renderSyncPanelTree(
				this.treeHostEl,
				this.parsed.root,
				this.state,
				{
					onToggleCollapse: () => undefined,
					onToggleSelect: () => undefined,
					onSyncStub: () => undefined,
					onRootSettings: () => this.openRootSettings(),
				},
				{ parseType: this.parsed.deckType },
			);
			this.treeHostEl.createDiv({
				cls: 'dta-sync-empty',
				text: `${this.parsed.deckType} 解析尚未实现。点根牌组设置修改 deckType。`,
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
					onRootSettings: () => this.openRootSettings(),
				},
				{ parseType: this.parsed.deckType },
			);
			this.treeHostEl.createDiv({
				cls: 'dta-sync-empty',
				text: '未识别到牌组或卡片。点根牌组设置调整 deckLevel。',
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
				onRootSettings: () => this.openRootSettings(),
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

		const filePath = this.parsed.filePath;
		const heading = card.front.trim();
		// In-app silent jump (avoid obsidian:// which prompts "open file").
		const linktext = heading ? `${filePath}#${heading}` : filePath;
		await this.app.workspace.openLinkText(linktext, '', false);
	}

	private openRootSettings(): void {
		const file = this.getActiveMarkdownFile();
		if (!file) {
			new Notice('请先打开一个 Markdown 笔记');
			return;
		}

		openFileDeckSettings(
			this.plugin,
			file,
			{
				deckType: this.state.parseType,
				deckName: this.parsed?.yamlDeckName ?? '',
				deckLevel: this.state.cardLevel,
				deckStatus:
					this.parsed?.deckStatus ?? this.state.tab === 'archived',
			},
			async () => {
				await this.reload({ preserveTab: true });
			},
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
