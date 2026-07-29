import { setIcon } from 'obsidian';
import type { CardNode, DeckNode } from '../../domain/head/types';
import type { SyncPanelState } from './SyncPanelState';

export interface SyncPanelTreeHandlers {
	onToggleCollapse: (deckId: string) => void;
	onToggleSelect: (node: DeckNode | CardNode, selected: boolean) => void;
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
	renderDeck(list, root, state, handlers, 0, null);
}

function renderDeck(
	parent: HTMLElement,
	deck: DeckNode,
	state: SyncPanelState,
	handlers: SyncPanelTreeHandlers,
	depth: number,
	siblingIndex: number | null,
): void {
	const row = parent.createDiv({
		cls: 'dta-sync-row dta-sync-row--deck',
		attr: { 'data-depth': String(depth) },
	});

	const hasChildren = deck.children.length > 0;
	const collapsed = state.isCollapsed(deck.id);

	if (hasChildren) {
		row.addClass('is-clickable');
		row.addEventListener('click', () => {
			handlers.onToggleCollapse(deck.id);
		});
	}

	const twisty = row.createSpan({
		cls: 'dta-sync-twisty',
		attr: {
			title: hasChildren
				? collapsed
					? '展开牌组'
					: '折叠牌组'
				: '',
		},
	});
	if (hasChildren) {
		setIcon(twisty, collapsed ? 'plus-circle' : 'minus-circle');
	} else {
		twisty.addClass('is-empty');
		setIcon(twisty, 'plus-circle');
	}

	const label = formatDeckLabel(deck.name, depth, siblingIndex);
	row.createSpan({
		cls: 'dta-sync-name',
		text: label,
	});

	row.createSpan({
		cls: 'dta-sync-count',
		text: String(deck.cardCount),
	});

	const syncBtn = row.createEl('button', {
		cls: 'dta-sync-action clickable-icon',
		attr: { 'aria-label': '同步牌组', title: '同步牌组（尚未实现）' },
	});
	setIcon(syncBtn, 'refresh-cw');
	syncBtn.addEventListener('click', (evt) => {
		evt.stopPropagation();
		handlers.onSyncStub(deck);
	});

	const checkbox = row.createEl('input', {
		type: 'checkbox',
		cls: 'dta-sync-check',
	});
	checkbox.checked = state.isSelected(deck.id);
	checkbox.addEventListener('click', (evt) => {
		evt.stopPropagation();
	});
	checkbox.addEventListener('change', () => {
		handlers.onToggleSelect(deck, checkbox.checked);
	});

	if (!hasChildren || collapsed) {
		return;
	}

	const childrenEl = parent.createDiv({ cls: 'dta-sync-children' });
	let deckSibling = 0;
	for (const child of deck.children) {
		if (child.kind === 'deck') {
			deckSibling += 1;
			renderDeck(
				childrenEl,
				child,
				state,
				handlers,
				depth + 1,
				deckSibling,
			);
		} else {
			renderCard(childrenEl, child, state, handlers);
		}
	}
}

function renderCard(
	parent: HTMLElement,
	card: CardNode,
	state: SyncPanelState,
	handlers: SyncPanelTreeHandlers,
): void {
	const row = parent.createDiv({
		cls: 'dta-sync-row dta-sync-row--card',
	});

	const icon = row.createSpan({ cls: 'dta-sync-card-icon' });
	setIcon(icon, 'sticky-note');

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

	const syncBtn = row.createEl('button', {
		cls: 'dta-sync-action clickable-icon',
		attr: { 'aria-label': '同步卡片', title: '同步卡片（尚未实现）' },
	});
	setIcon(syncBtn, 'refresh-cw');
	syncBtn.addEventListener('click', (evt) => {
		evt.stopPropagation();
		handlers.onSyncStub(card);
	});

	const checkbox = row.createEl('input', {
		type: 'checkbox',
		cls: 'dta-sync-check',
	});
	checkbox.checked = state.isSelected(card.id);
	checkbox.addEventListener('click', (evt) => {
		evt.stopPropagation();
	});
	checkbox.addEventListener('change', () => {
		handlers.onToggleSelect(card, checkbox.checked);
	});
}

function formatDeckLabel(
	name: string,
	depth: number,
	siblingIndex: number | null,
): string {
	if (depth === 0 || siblingIndex === null) {
		return name;
	}
	return `${siblingIndex}. ${name}`;
}
