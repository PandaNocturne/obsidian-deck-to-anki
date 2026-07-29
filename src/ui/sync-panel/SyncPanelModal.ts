import { MarkdownView, Modal, Notice, setIcon, TFile } from 'obsidian';
import type DeckToAnkiPlugin from '../../../main';
import { parseHeadFile } from '../../domain/head/parseHeadFile';
import type { ParsedHeadFile } from '../../domain/head/types';
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
			void this.reload();
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
			cls: 'dta-sync-footer-btn mod-cta',
			text: 'Update',
		});
		updateBtn.addEventListener('click', () => {
			new Notice('Update 同步尚未实现');
		});

		const cancelBtn = footer.createEl('button', {
			cls: 'dta-sync-footer-btn',
			text: 'Cancel',
		});
		cancelBtn.addEventListener('click', () => {
			this.close();
		});
	}

	private async reload(): Promise<void> {
		const file = this.getActiveMarkdownFile();
		if (!file) {
			this.parsed = null;
			this.statusEl.setText('请先打开一个 Markdown 笔记。');
			this.treeHostEl.empty();
			this.updateTabs();
			return;
		}

		const content = await this.app.vault.read(file);
		this.parsed = parseHeadFile(file.path, content, {
			defaultDeckType: this.plugin.settings.defaultDeckType,
			cardHeadingLevel: this.plugin.settings.cardHeadingLevel,
		});
		this.state.resetFromParsed(this.parsed);
		this.renderBody();
	}

	private renderBody(): void {
		this.updateTabs();
		this.treeHostEl.empty();

		if (!this.parsed) {
			this.statusEl.setText('请先打开一个 Markdown 笔记。');
			return;
		}

		const showArchived = this.state.tab === 'archived';
		if (this.parsed.archived !== showArchived) {
			this.statusEl.setText(
				showArchived
					? '当前文件未归档（ARCHIVED 不为 true）。'
					: '当前文件已归档，请切换到「已归档」查看。',
			);
			return;
		}

		const warningText =
			this.parsed.warnings.length > 0
				? this.parsed.warnings.join('；')
				: '';
		const summary = `${this.parsed.fileName} · ${this.parsed.root.cardCount} 张卡片 · ${this.parsed.deckType}`;
		this.statusEl.setText(
			warningText ? `${summary} — ${warningText}` : summary,
		);

		if (
			this.parsed.deckType === 'head' &&
			this.parsed.root.cardCount === 0 &&
			this.parsed.root.children.length === 0
		) {
			this.treeHostEl.createDiv({
				cls: 'dta-sync-empty',
				text: '未识别到标题牌组或 H4 卡片。',
			});
			return;
		}

		if (this.parsed.deckType !== 'head') {
			this.treeHostEl.createDiv({
				cls: 'dta-sync-empty',
				text: `当前为 ${this.parsed.deckType} 模式，本面板仅支持 head。`,
			});
			return;
		}

		renderSyncPanelTree(this.treeHostEl, this.parsed.root, this.state, {
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
		});
	}

	private updateTabs(): void {
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
