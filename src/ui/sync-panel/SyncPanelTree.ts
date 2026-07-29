import { setIcon } from 'obsidian';
import type { CardNode, DeckNode, DeckType } from '../../domain/head/types';
import type { DeckTreeIconMode } from '../../settings';
import type { SyncPanelState } from './SyncPanelState';

export interface SyncPanelTreeHandlers {
	onToggleCollapse: (deckId: string) => void;
	onToggleSelect: (node: DeckNode | CardNode, selected: boolean) => void;
	onSyncStub: (node: DeckNode | CardNode) => void;
	/** Open YAML settings for a note-level deck (root or file-mode child). */
	onDeckSettings?: (deck: DeckNode) => void;
	onCardOpen?: (card: CardNode) => void;
	/** Double-click deck title → open source file or heading. */
	onDeckOpen?: (deck: DeckNode) => void;
}

export interface SyncPanelTreeOptions {
	/** Fallback parse type badge when a deck has no deckType. */
	parseType: DeckType;
	/** When false, root row omits type badge / settings (forest views). Default true. */
	showRootMeta?: boolean;
	/**
	 * Forest views: do not render the synthetic root row (e.g. 「所有卡片」);
	 * only its deck children appear at the first level. Cards at that level are skipped.
	 */
	skipRootRow?: boolean;
	/** Deck lead icon style from plugin settings. Default unified. */
	iconMode?: DeckTreeIconMode;
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
		for (const child of root.children) {
			if (child.kind !== 'deck') {
				// Nested cards must not appear at the first directory level.
				continue;
			}
			renderDeck(list, child, state, handlers, options, 0, null);
		}
		return;
	}

	renderDeck(list, root, state, handlers, options, 0, null);
}

/**
 * L1 decks always use layers (fold state by color).
 * Nested unified: circle +/−; nested byType: file / heading / list.
 */
function resolveDeckLeadIcon(
	deck: DeckNode,
	depth: number,
	hasChildren: boolean,
	collapsed: boolean,
	iconMode: DeckTreeIconMode,
): { icon: string; foldable: boolean; useFoldColor: boolean } {
	if (depth === 0) {
		return {
			icon: 'layers',
			foldable: hasChildren,
			useFoldColor: true,
		};
	}

	if (iconMode === 'unified') {
		return {
			icon: hasChildren
				? collapsed
					? 'plus-circle'
					: 'minus-circle'
				: 'minus-circle',
			foldable: hasChildren,
			useFoldColor: false,
		};
	}

	if (deck.deckType === 'list') {
		return { icon: 'list', foldable: hasChildren, useFoldColor: true };
	}
	if (
		deck.deckType === 'file' ||
		deck.id.startsWith('deck:file:') ||
		deck.deckType === 'head' ||
		deck.deckType === 'basic'
	) {
		return { icon: 'file-text', foldable: hasChildren, useFoldColor: true };
	}
	if (deck.headingLevel > 0) {
		return { icon: 'heading', foldable: hasChildren, useFoldColor: true };
	}
	return { icon: 'folder', foldable: hasChildren, useFoldColor: true };
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
	const iconMode = options.iconMode ?? 'unified';
	const lead = resolveDeckLeadIcon(
		deck,
		depth,
		hasChildren,
		collapsed,
		iconMode,
	);

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
			title: lead.foldable
				? collapsed
					? '展开牌组'
					: '折叠牌组'
				: '',
		},
	});
	setIcon(twisty, lead.icon);
	if (!hasChildren) {
		twisty.addClass('is-empty');
	} else {
		if (lead.useFoldColor) {
			twisty.addClass(collapsed ? 'is-collapsed' : 'is-expanded');
		} else {
			twisty.addClass('is-unified');
		}
		twisty.addEventListener('click', toggleCollapse);
	}

	// Title text only (no flex grow); remaining gap is blank → fold.
	const nameSlot = row.createSpan({ cls: 'dta-sync-name-slot' });
	const nameEl = nameSlot.createSpan({
		cls: 'dta-sync-name',
		text: formatDeckLabel(deck.name, depth, siblingIndex),
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

	row.createSpan({
		cls: 'dta-sync-count',
		text: String(deck.cardCount),
	});

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
				options,
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
	const isListCard = card.headingLevel === 0;
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
				'input, button, .dta-sync-action, .dta-sync-check',
			)
		) {
			return;
		}
		handlers.onCardOpen?.(card);
	});

	const icon = row.createSpan({ cls: 'dta-sync-card-icon' });
	setIcon(icon, isListCard ? 'list' : 'sticky-note');

	const nameSlot = row.createSpan({ cls: 'dta-sync-name-slot' });
	nameSlot.createSpan({
		cls: 'dta-sync-name',
		text: card.front,
	});

	if (card.blockId) {
		row.createSpan({
			cls: 'dta-sync-id',
			text: `^${card.blockId}`,
		});
	} else if (card.noteId !== undefined) {
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
