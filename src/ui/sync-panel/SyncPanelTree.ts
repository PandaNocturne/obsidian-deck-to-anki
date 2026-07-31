import { setIcon } from 'obsidian';
import { countSyncStatusInDeck } from '../../anki/syncStatus';
import type {
	CardNode,
	DeckClass,
	DeckNode,
	DeckType,
	DeletedAnkiCardNode,
	SyncCardStatus,
} from '../../domain/head/types';
import type { SyncPanelState, SyncSelectableNode } from './SyncPanelState';

export interface SyncPanelTreeHandlers {
	onToggleCollapse: (deckId: string) => void;
	onToggleSelect: (node: SyncSelectableNode, selected: boolean) => void;
	onSyncStub: (node: SyncSelectableNode) => void;
	/** Open YAML settings for a note-level deck (root or file-mode child). */
	onDeckSettings?: (deck: DeckNode) => void;
	/**
	 * YAML settings for a card-mode note leaf (no nested deck).
	 * Prefer this over treating the card as a deck row.
	 */
	onCardSettings?: (card: CardNode) => void;
	/** Preview parsed front / back. */
	onCardPreview?: (card: CardNode) => void;
	onCardOpen?: (card: CardNode) => void;
	/** Click Anki note id → open that note in Anki browser. */
	onOpenInAnki?: (noteId: number) => void;
	/** Double-click deck title → open source file or heading. */
	onDeckOpen?: (deck: DeckNode) => void;
}

export interface SyncPanelTreeOptions {
	/** Fallback parse type badge when a deck has no deckType. */
	parseType: DeckType;
	/** When false, root row omits type badge / settings (forest views). Default true. */
	showRootMeta?: boolean;
	/**
	 * Do not render the synthetic root row; show its children at the first level.
	 * Used by forest views and standalone card-mode notes (card is a leaf, no deck row).
	 */
	skipRootRow?: boolean;
	/** Disable sync actions while check/sync/reload is running. */
	busy?: boolean;
	/** Node id whose sync button should show a spinner. */
	busyNodeId?: string | null;
	/** Show deck sibling indexes in the tree (default true). */
	showDeckNumbers?: boolean;
}

function bindSyncActionButton(
	row: HTMLElement,
	nodeId: string,
	label: string,
	options: SyncPanelTreeOptions,
	onSync: () => void,
	idleIcon = 'refresh-cw',
): void {
	const busy = options.busy === true;
	const active = busy && options.busyNodeId === nodeId;
	const syncBtn = row.createEl('button', {
		cls: `dta-sync-action clickable-icon${active ? ' is-loading' : ''}`,
		attr: {
			'aria-label': label,
			title: busy ? '进行中…' : label,
			'data-dta-sync': nodeId,
		},
	});
	syncBtn.disabled = busy;
	setIcon(syncBtn, active ? 'loader-circle' : idleIcon);
	syncBtn.addEventListener('click', (evt) => {
		evt.stopPropagation();
		if (busy) {
			return;
		}
		onSync();
	});
}

export function renderSyncPanelTree(
	container: HTMLElement,
	root: DeckNode,
	state: SyncPanelState,
	handlers: SyncPanelTreeHandlers,
	options: SyncPanelTreeOptions,
): void {
	container.empty();
	const list = container.createDiv({ cls: 'dta-sync-tree' });

	if (options.skipRootRow) {
		let deckSibling = 0;
		let cardSibling = 0;
		for (const child of root.children) {
			if (child.kind === 'deck') {
				deckSibling += 1;
				renderDeck(
					list,
					child,
					state,
					handlers,
					options,
					0,
					deckSibling,
				);
			} else {
				cardSibling += 1;
				renderLeaf(list, child, state, handlers, options, cardSibling);
			}
		}
		return;
	}

	renderDeck(list, root, state, handlers, options, 0, null);
}

/** All decks use circle +/− (collapsed +, expanded −). */
function resolveDeckLeadIcon(
	hasChildren: boolean,
	collapsed: boolean,
): string {
	if (!hasChildren) {
		return 'minus-circle';
	}
	return collapsed ? 'plus-circle' : 'minus-circle';
}

/** Card icons follow deckClass: head / list / card. */
function resolveCardIcon(deckClass: DeckClass): string {
	switch (deckClass) {
		case 'list':
			return 'list';
		case 'card':
			return 'sticky-note';
		case 'head':
		default:
			return 'heading';
	}
}

function statusCheckClass(status: SyncCardStatus | undefined): string {
	switch (status) {
		case 'synced':
			return 'dta-sync-check--synced';
		case 'modified':
			return 'dta-sync-check--modified';
		case 'deleted':
			return 'dta-sync-check--deleted';
		case 'unsynced':
			return 'dta-sync-check--unsynced';
		default:
			return 'dta-sync-check--pending';
	}
}

function statusIdClass(status: SyncCardStatus | undefined): string {
	switch (status) {
		case 'synced':
			return 'dta-sync-id--synced';
		case 'modified':
			return 'dta-sync-id--modified';
		case 'deleted':
			return 'dta-sync-id--deleted';
		case 'unsynced':
			return 'dta-sync-id--unsynced';
		default:
			return 'dta-sync-id--pending';
	}
}

function renderStatusBadges(
	parent: HTMLElement,
	counts: Record<SyncCardStatus | 'pending', number>,
): void {
	const order: Array<{
		key: SyncCardStatus | 'pending';
		title: string;
	}> = [
		{ key: 'synced', title: '已同步' },
		{ key: 'modified', title: '被修改' },
		{ key: 'unsynced', title: '未同步' },
		{ key: 'pending', title: '未检测' },
		{ key: 'deleted', title: '已删除' },
	];
	const host = parent.createSpan({ cls: 'dta-sync-status-badges' });
	for (const { key, title } of order) {
		const n = counts[key];
		if (n <= 0) {
			continue;
		}
		host.createSpan({
			cls: `dta-sync-status-badge dta-sync-status-badge--${key}`,
			text: String(n),
			attr: { title: `${title} ${n}` },
		});
	}
}

function renderDeck(
	parent: HTMLElement,
	deck: DeckNode,
	state: SyncPanelState,
	handlers: SyncPanelTreeHandlers,
	options: SyncPanelTreeOptions,
	depth: number,
	siblingIndex: number | null,
): void {
	const row = parent.createDiv({
		cls: 'dta-sync-row dta-sync-row--deck',
		attr: { 'data-depth': String(depth) },
	});

	const hasChildren = deck.children.length > 0;
	const collapsed = state.isCollapsed(deck.id);
	const isRoot = depth === 0;
	const showRootMeta = options.showRootMeta !== false;
	const badgeType =
		deck.deckType ?? (isRoot && showRootMeta ? options.parseType : undefined);
	const showSettings = Boolean(badgeType && handlers.onDeckSettings);
	const leadIcon = resolveDeckLeadIcon(hasChildren, collapsed);

	const toggleCollapse = (evt: MouseEvent): void => {
		if (!hasChildren) {
			return;
		}
		evt.stopPropagation();
		handlers.onToggleCollapse(deck.id);
	};

	const isInteractiveTarget = (target: HTMLElement | null): boolean =>
		Boolean(
			target?.closest(
				'.dta-sync-name, .dta-sync-action, .dta-sync-check, input, button, .dta-sync-type-badge, .dta-sync-count',
			),
		);

	// Blank row / icon → fold; title click does not.
	if (hasChildren) {
		row.addClass('is-clickable');
		row.addEventListener('click', (evt) => {
			if (isInteractiveTarget(evt.target as HTMLElement | null)) {
				return;
			}
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
	setIcon(twisty, leadIcon);
	if (!hasChildren) {
		twisty.addClass('is-empty');
	} else {
		twisty.addClass('is-unified');
		twisty.addEventListener('click', toggleCollapse);
	}

	// Title text only (no flex grow); remaining gap is blank → fold.
	const nameSlot = row.createSpan({ cls: 'dta-sync-name-slot' });
	const nameEl = nameSlot.createSpan({
		cls: 'dta-sync-name',
		text: formatDeckLabel(
			deck.name,
			siblingIndex ?? deck.siblingIndex ?? null,
			options.showDeckNumbers === true,
		),
	});
	nameEl.setAttribute(
		'title',
		handlers.onDeckOpen
			? '双击打开笔记或标题'
			: isRoot
				? `Root deck: ${deck.name}`
				: deck.name,
	);
	nameEl.addEventListener('click', (evt) => {
		evt.stopPropagation();
	});
	nameEl.addEventListener('dblclick', (evt) => {
		evt.stopPropagation();
		handlers.onDeckOpen?.(deck);
	});

	if (badgeType) {
		row.createSpan({
			cls: 'dta-sync-type-badge',
			text: badgeType,
			attr: { title: `deckType: ${badgeType}` },
		});
	}

	renderStatusBadges(row, countSyncStatusInDeck(deck));

	if (showSettings) {
		const settingsBtn = row.createEl('button', {
			cls: 'dta-sync-action clickable-icon',
			attr: {
				'aria-label': '牌组 YAML 设置',
				title: '牌组 YAML 设置',
			},
		});
		setIcon(settingsBtn, 'settings');
		settingsBtn.addEventListener('click', (evt) => {
			evt.stopPropagation();
			handlers.onDeckSettings?.(deck);
		});
	}

	bindSyncActionButton(row, deck.id, '同步牌组', options, () => {
		handlers.onSyncStub(deck);
	});

	const checkbox = row.createEl('input', {
		type: 'checkbox',
		cls: 'dta-sync-check',
	});
	const deckCheck = state.getCheckState(deck);
	checkbox.checked = deckCheck === 'checked';
	checkbox.indeterminate = deckCheck === 'indeterminate';
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
	let cardSibling = 0;
	for (const child of deck.children) {
		if (child.kind === 'deck') {
			deckSibling += 1;
			renderDeck(
				childrenEl,
				child,
				state,
				handlers,
				options,
				depth + 1,
				deckSibling,
			);
		} else {
			cardSibling += 1;
			renderLeaf(childrenEl, child, state, handlers, options, cardSibling);
		}
	}
}

function renderLeaf(
	parent: HTMLElement,
	leaf: CardNode | DeletedAnkiCardNode,
	state: SyncPanelState,
	handlers: SyncPanelTreeHandlers,
	options: SyncPanelTreeOptions,
	siblingIndex: number,
): void {
	if (leaf.kind === 'deleted-anki') {
		renderDeletedCard(parent, leaf, state, handlers, options, siblingIndex);
		return;
	}
	renderCard(parent, leaf, state, handlers, options, siblingIndex);
}

function renderDeletedCard(
	parent: HTMLElement,
	card: DeletedAnkiCardNode,
	state: SyncPanelState,
	handlers: SyncPanelTreeHandlers,
	options: SyncPanelTreeOptions,
	siblingIndex: number,
): void {
	const row = parent.createDiv({
		cls: 'dta-sync-row dta-sync-row--card dta-sync-row--deleted',
	});
	row.setAttribute('title', '仅存在于 Anki（本地已删除）');

	const icon = row.createSpan({ cls: 'dta-sync-card-icon' });
	setIcon(icon, 'trash-2');

	const nameSlot = row.createSpan({ cls: 'dta-sync-name-slot' });
	nameSlot.createSpan({
		cls: 'dta-sync-name is-deleted',
		text: card.front,
	});

	const idEl = row.createSpan({
		cls: `dta-sync-id ${statusIdClass('deleted')}`,
		text: `ID ${card.noteId}`,
		attr: {
			title: handlers.onOpenInAnki
				? '在 Anki 中打开此笔记'
				: `Anki note id: ${card.noteId}`,
		},
	});
	if (handlers.onOpenInAnki) {
		idEl.addClass('is-clickable');
		idEl.addEventListener('click', (evt) => {
			evt.stopPropagation();
			handlers.onOpenInAnki?.(card.noteId);
		});
	}

	bindSyncActionButton(
		row,
		card.id,
		'从 Anki 删除',
		options,
		() => {
			handlers.onSyncStub(card);
		},
		'trash-2',
	);

	const checkbox = row.createEl('input', {
		type: 'checkbox',
		cls: `dta-sync-check ${statusCheckClass('deleted')}`,
	});
	checkbox.checked = state.isSelected(card.id);
	checkbox.addEventListener('click', (evt) => {
		evt.stopPropagation();
	});
	checkbox.addEventListener('change', () => {
		handlers.onToggleSelect(card, checkbox.checked);
	});
}

function renderCard(
	parent: HTMLElement,
	card: CardNode,
	state: SyncPanelState,
	handlers: SyncPanelTreeHandlers,
	options: SyncPanelTreeOptions,
	siblingIndex: number,
): void {
	const isListCard = card.deckClass === 'list';
	const canJump = !isListCard || Boolean(card.blockId);

	const row = parent.createDiv({
		cls: 'dta-sync-row dta-sync-row--card is-clickable',
	});
	row.setAttribute(
		'title',
		canJump
			? '双击打开'
			: '列表项无块 ID（^id），解析可用但无法跳转',
	);
	// Cards have no fold — dblclick anywhere (except controls) opens.
	row.addEventListener('dblclick', (evt) => {
		const target = evt.target as HTMLElement | null;
		if (
			target?.closest(
				'input, button, .dta-sync-action, .dta-sync-check, .dta-sync-id',
			)
		) {
			return;
		}
		handlers.onCardOpen?.(card);
	});

	const icon = row.createSpan({ cls: 'dta-sync-card-icon' });
	setIcon(icon, resolveCardIcon(card.deckClass));

	const nameSlot = row.createSpan({ cls: 'dta-sync-name-slot' });
	nameSlot.createSpan({
		cls: 'dta-sync-name',
		text: card.front,
	});

	if (card.deckClass === 'card') {
		row.createSpan({
			cls: 'dta-sync-type-badge',
			text: 'card',
			attr: { title: 'deckClass: card' },
		});
	}

	if (card.tags && card.tags.length > 0) {
		const tagsEl = row.createSpan({ cls: 'dta-sync-card-tags' });
		for (const tag of card.tags) {
			tagsEl.createSpan({
				cls: 'dta-sync-card-tag',
				text: `#${tag}`,
				attr: { title: `tag: #${tag}` },
			});
		}
	}

	if (card.noteId !== undefined) {
		const idEl = row.createSpan({
			cls: `dta-sync-id ${statusIdClass(card.syncStatus)}`,
			text: `ID ${card.noteId}`,
			attr: {
				title: handlers.onOpenInAnki
					? '在 Anki 中打开此笔记'
					: `Anki note id: ${card.noteId}`,
			},
		});
		if (handlers.onOpenInAnki) {
			idEl.addClass('is-clickable');
			idEl.addEventListener('click', (evt) => {
				evt.stopPropagation();
				handlers.onOpenInAnki?.(card.noteId!);
			});
		}
	} else if (card.blockId) {
		row.createSpan({
			cls: `dta-sync-id ${statusIdClass(card.syncStatus)}`,
			text: `^${card.blockId}`,
		});
	}

	if (card.deckClass === 'card' && handlers.onCardSettings) {
		const settingsBtn = row.createEl('button', {
			cls: 'dta-sync-action clickable-icon',
			attr: {
				'aria-label': '牌组 YAML 设置',
				title: '牌组 YAML 设置',
			},
		});
		setIcon(settingsBtn, 'settings');
		settingsBtn.addEventListener('click', (evt) => {
			evt.stopPropagation();
			handlers.onCardSettings?.(card);
		});
	}

	if (handlers.onCardPreview) {
		const previewBtn = row.createEl('button', {
			cls: 'dta-sync-action clickable-icon',
			attr: {
				'aria-label': '查看解析效果',
				title: '查看解析效果',
			},
		});
		setIcon(previewBtn, 'scan-eye');
		previewBtn.addEventListener('click', (evt) => {
			evt.stopPropagation();
			handlers.onCardPreview?.(card);
		});
	}

	bindSyncActionButton(row, card.id, '同步卡片', options, () => {
		handlers.onSyncStub(card);
	});

	const checkbox = row.createEl('input', {
		type: 'checkbox',
		cls: `dta-sync-check ${statusCheckClass(card.syncStatus)}`,
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
	siblingIndex: number | null,
	showDeckNumbers: boolean,
): string {
	if (!showDeckNumbers || siblingIndex === null || siblingIndex < 1) {
		return name;
	}
	return `${siblingIndex}. ${name}`;
}
