import { App, Component, MarkdownRenderer, Modal } from 'obsidian';
import type { CardNode } from '../../domain/head/types';

/** Deck View display mode. */
export type DeckViewMode = 'source' | 'reading';

/**
 * Preview parsed card front / back with a source / reading segment toggle.
 */
export class CardPreviewModal extends Modal {
	private readonly card: CardNode;
	private mode: DeckViewMode;
	private bodyHostEl!: HTMLElement;
	private sourceBtnEl!: HTMLButtonElement;
	private readingBtnEl!: HTMLButtonElement;
	private readonly mdComponent = new Component();
	private renderToken = 0;

	constructor(app: App, card: CardNode, defaultMode: DeckViewMode = 'source') {
		super(app);
		this.card = card;
		this.mode = defaultMode === 'reading' ? 'reading' : 'source';
	}

	onOpen(): void {
		this.mdComponent.load();
		this.modalEl.addClass('dta-card-preview-modal');
		this.titleEl.setText('Deck View');

		const { contentEl } = this;
		contentEl.empty();

		const header = contentEl.createDiv({ cls: 'dta-deck-view-header' });
		header.createDiv({
			cls: 'dta-deck-view-subtitle',
			text: '查看解析后的卡片正反面',
		});

		const modeSwitch = header.createDiv({
			cls: 'dta-deck-view-mode-switch',
			attr: { role: 'tablist', 'aria-label': '显示模式' },
		});
		this.sourceBtnEl = this.addModeButton(modeSwitch, 'source', '源码');
		this.readingBtnEl = this.addModeButton(modeSwitch, 'reading', '阅读');
		this.syncModeButtons();

		this.bodyHostEl = contentEl.createDiv({ cls: 'dta-deck-view-body-host' });
		void this.renderBody();
	}

	onClose(): void {
		this.renderToken += 1;
		this.mdComponent.unload();
		this.contentEl.empty();
	}

	private addModeButton(
		parent: HTMLElement,
		value: DeckViewMode,
		label: string,
	): HTMLButtonElement {
		const btn = parent.createEl('button', {
			cls: 'dta-deck-view-mode-btn',
			text: label,
			attr: {
				type: 'button',
				role: 'tab',
				'aria-selected': 'false',
			},
		});
		btn.addEventListener('click', () => {
			if (this.mode === value) return;
			this.mode = value;
			this.syncModeButtons();
			void this.renderBody();
		});
		return btn;
	}

	private syncModeButtons(): void {
		const sourceActive = this.mode === 'source';
		this.sourceBtnEl.toggleClass('is-active', sourceActive);
		this.readingBtnEl.toggleClass('is-active', !sourceActive);
		this.sourceBtnEl.setAttribute(
			'aria-selected',
			sourceActive ? 'true' : 'false',
		);
		this.readingBtnEl.setAttribute(
			'aria-selected',
			sourceActive ? 'false' : 'true',
		);
	}

	/** Drop previous MarkdownRenderChild instances before re-render. */
	private resetMarkdownLifecycle(): void {
		this.mdComponent.unload();
		this.mdComponent.load();
	}

	private async renderBody(): Promise<void> {
		const token = ++this.renderToken;
		this.resetMarkdownLifecycle();
		const host = this.bodyHostEl;
		host.empty();

		const head = (this.card.navTitle ?? '').trim();
		if (head) {
			await this.renderSection(host, '标题', head, token);
			if (token !== this.renderToken) return;
		}

		await this.renderSection(host, '正面', this.card.front, token);
		if (token !== this.renderToken) return;

		await this.renderSection(host, '反面', this.card.back, token);
		if (token !== this.renderToken) return;

		const tags = this.card.tags ?? [];
		if (tags.length === 0) return;

		const section = host.createDiv({ cls: 'dta-card-preview-section' });
		section.createDiv({
			cls: 'dta-card-preview-label',
			text: '标签',
		});
		const tagsEl = section.createDiv({ cls: 'dta-card-preview-tags' });
		for (const tag of tags) {
			tagsEl.createSpan({
				cls: 'dta-sync-card-tag',
				text: `#${tag}`,
			});
		}
	}

	private async renderSection(
		parent: HTMLElement,
		label: string,
		raw: string,
		token: number,
	): Promise<void> {
		const section = parent.createDiv({ cls: 'dta-card-preview-section' });
		section.createDiv({
			cls: 'dta-card-preview-label',
			text: label,
		});

		const bodyEl = section.createDiv({
			cls: `dta-card-preview-body is-${this.mode}`,
		});
		const text = raw.trim();
		if (!text) {
			bodyEl.addClass('is-empty');
			bodyEl.setText('（空）');
			return;
		}

		if (this.mode === 'source') {
			bodyEl.createEl('pre', {
				cls: 'dta-card-preview-source',
				text,
			});
			return;
		}

		// Match Obsidian reading-view class hooks so theme CSS applies.
		const previewEl = bodyEl.createDiv({
			cls: 'markdown-preview-view markdown-rendered dta-card-preview-md',
		});
		const sourcePath = this.card.sourceFilePath ?? '';
		await MarkdownRenderer.render(
			this.app,
			text,
			previewEl,
			sourcePath,
			this.mdComponent,
		);
		if (token !== this.renderToken) return;
	}
}

export function openCardPreview(
	app: App,
	card: CardNode,
	defaultMode: DeckViewMode = 'source',
): void {
	new CardPreviewModal(app, card, defaultMode).open();
}
