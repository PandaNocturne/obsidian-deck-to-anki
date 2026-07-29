import { setIcon } from 'obsidian';
import type { CardNode, DeckNode } from '../../domain/head/types';
import type { SyncPanelState } from './SyncPanelState';

export interface SyncPanelTreeHandlers {
	onToggleCollapse: (deckId: string) => void;
	onToggleSelect: (node: DeckNode | CardNode, selected: boolean) => void;
	onLocate: (lineStart: number) => void;
	onSyncStub: (node: DeckNode | CardNode) => void;
}

export function renderSyncPanelTree(
	container: HTMLElement,
	root: DeckNode,
	state: SyncPanelState,
	handlers: SyncPanelTreeHandlers,
): void {
	container.empty();
	const list = container.createDiv({ cls: 'dta-sync-tree' });
	renderDeck(list, root, state, handlers, 0);
}

function renderDeck(
	parent: HTMLElement,
	deck: DeckNode,
	state: SyncPanelState,
	handlers: SyncPanelTreeHandlers,
	depth: number,
): void {
	const row = parent.createDiv({
		cls: 'dta-sync-row dta-sync-row--deck',
		attr: { 'data-depth': String(depth) },
	});
	row.style.setProperty('--dta-depth', String(depth));

	const hasChildren = deck.children.length > 0;
	const collapsed = state.isCollapsed(deck.id);

	const twisty = row.createSpan({ cls: 'dta-sync-twisty' });
	if (hasChildren) {
		setIcon(twisty, collapsed ? 'chevron-right' : 'chevron-down');
		twisty.addEventListener('click', (evt) => {
			evt.stopPropagation();
			handlers.onToggleCollapse(deck.id);
		});
	} else {
		twisty.addClass('is-empty');
	}

	const checkbox = row.createEl('input', {
		type: 'checkbox',
		cls: 'dta-sync-check',
	});
	checkbox.checked = state.isSelected(deck.id);
	checkbox.addEventListener('change', () => {
		handlers.onToggleSelect(deck, checkbox.checked);
	});

	row.createSpan({
		cls: 'dta-sync-name',
		text: deck.name,
	});

	row.createSpan({
		cls: 'dta-sync-count',
		text: String(deck.cardCount),
	});

	const actions = row.createDiv({ cls: 'dta-sync-actions' });

	const locateBtn = actions.createEl('button', {
		cls: 'dta-sync-action clickable-icon',
		attr: { 'aria-label': '定位到标题', title: '定位到标题' },
	});
	setIcon(locateBtn, 'file-text');
	locateBtn.disabled = deck.lineStart < 0;
	locateBtn.addEventListener('click', (evt) => {
		evt.stopPropagation();
		if (deck.lineStart >= 0) {
			handlers.onLocate(deck.lineStart);
		}
	});

	const syncBtn = actions.createEl('button', {
		cls: 'dta-sync-action clickable-icon',
		attr: { 'aria-label': '同步牌组', title: '同步牌组（尚未实现）' },
	});
	setIcon(syncBtn, 'refresh-cw');
	syncBtn.addEventListener('click', (evt) => {
		evt.stopPropagation();
		handlers.onSyncStub(deck);
	});

	if (!hasChildren || collapsed) {
		return;
	}

	const childrenEl = parent.createDiv({ cls: 'dta-sync-children' });
	for (const child of deck.children) {
		if (child.kind === 'deck') {
			renderDeck(childrenEl, child, state, handlers, depth + 1);
		} else {
			renderCard(childrenEl, child, state, handlers, depth + 1);
		}
	}
}

function renderCard(
	parent: HTMLElement,
	card: CardNode,
	state: SyncPanelState,
	handlers: SyncPanelTreeHandlers,
	depth: number,
): void {
	const row = parent.createDiv({
		cls: 'dta-sync-row dta-sync-row--card',
		attr: { 'data-depth': String(depth) },
	});
	row.style.setProperty('--dta-depth', String(depth));

	row.createSpan({ cls: 'dta-sync-twisty is-leaf' });

	const checkbox = row.createEl('input', {
		type: 'checkbox',
		cls: 'dta-sync-check',
	});
	checkbox.checked = state.isSelected(card.id);
	checkbox.addEventListener('change', () => {
		handlers.onToggleSelect(card, checkbox.checked);
	});

	row.createSpan({
		cls: 'dta-sync-name',
		text: card.front,
	});

	if (card.noteId !== undefined) {
		row.createSpan({
			cls: 'dta-sync-id',
			text: `ID ${card.noteId}`,
		});
	}

	const actions = row.createDiv({ cls: 'dta-sync-actions' });

	const locateBtn = actions.createEl('button', {
		cls: 'dta-sync-action clickable-icon',
		attr: { 'aria-label': '定位到卡片', title: '定位到卡片' },
	});
	setIcon(locateBtn, 'file-text');
	locateBtn.addEventListener('click', (evt) => {
		evt.stopPropagation();
		handlers.onLocate(card.lineStart);
	});

	const syncBtn = actions.createEl('button', {
		cls: 'dta-sync-action clickable-icon',
		attr: { 'aria-label': '同步卡片', title: '同步卡片（尚未实现）' },
	});
	setIcon(syncBtn, 'refresh-cw');
	syncBtn.addEventListener('click', (evt) => {
		evt.stopPropagation();
		handlers.onSyncStub(card);
	});
}
