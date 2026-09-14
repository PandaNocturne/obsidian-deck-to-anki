export type DeckType = 'head' | 'card' | 'file' | 'list' | 'title';

/** How a card was parsed (drives tree icon). Not the same as note-level file mode. */
export type DeckClass = 'head' | 'list' | 'card' | 'title';

/**
 * One-file modes: Anki id in YAML `deckID`, empty ob-deck-head,
 * sync panel skips synthetic root.
 */
export function isFileScopedCardMode(
	value: DeckType | DeckClass | undefined | null,
): boolean {
	return value === 'card' || value === 'title';
}

export type SyncPanelNodeKind = 'deck' | 'card' | 'deleted-anki';

/** Relative to Anki: green / yellow / blue / red in the sync panel. */
export type SyncCardStatus =
	| 'synced'
	| 'modified'
	| 'unsynced'
	| 'deleted';

/** Panel badge / checkbox colors (includes local-only states). */
export type SyncDisplayStatus = SyncCardStatus | 'pending' | 'empty';

export interface IdMarkerInfo {
	noteId: number;
	raw: string;
	lineIndex: number;
}

/**
 * One crumb in the Anki deck-tree backlink (一级 > 牌组2 > 子牌组).
 * Each segment gets its own Obsidian URI.
 */
export interface DeckBacklinkSegment {
	name: string;
	sourceFilePath: string;
	/**
	 * When true, open `file#name` (heading deck).
	 * When false, open the note file (root / note-level deck).
	 */
	headingTarget: boolean;
}

export interface CardNode {
	kind: 'card';
	id: string;
	front: string;
	back: string;
	headingLevel: number;
	lineStart: number;
	lineEnd: number;
	deckPath: string;
	/** Parse class for icon: head / list / card / title. */
	deckClass: DeckClass;
	/**
	 * Heading text for navigation (head mode). When front omits the title
	 * due to --- split, openLink still targets this heading.
	 */
	navTitle?: string;
	noteId?: number;
	idMarker?: IdMarkerInfo;
	/**
	 * Card mode: true when `noteId` was read from YAML `deckID`
	 * (not from a legacy `<!--ID-->` marker).
	 */
	hasYamlDeckId?: boolean;
	/** Obsidian block id (`^xxx`) for list cards; required to jump. */
	blockId?: string;
	/** Obsidian tags from card content (and YAML for card-mode notes), without `#`. */
	tags?: string[];
	/** Source note path (file mode child notes). */
	sourceFilePath?: string;
	/** Per-deck crumbs for Anki backlink; falls back to deckPath + sourceFilePath. */
	deckBacklinkTrail?: DeckBacklinkSegment[];
	/** Filled by sync-panel Anki status prefetch. */
	syncStatus?: SyncCardStatus;
	/** 1-based index among sibling cards under the same parent deck. */
	siblingIndex?: number;
	/** Ancestor deck sibling indexes (excludes root), e.g. [1, 2]. */
	deckIndexPath?: number[];
}

/**
 * Phantom row: note exists in Anki but not in the local vault tree.
 * Syncing a selected deleted row removes it from Anki.
 */
export interface DeletedAnkiCardNode {
	kind: 'deleted-anki';
	id: string;
	noteId: number;
	/** Display title (from Anki front field, HTML stripped). */
	front: string;
	deckPath: string;
	syncStatus: 'deleted';
	/** 1-based index among sibling leaves under the same parent. */
	siblingIndex?: number;
}

export type SyncTreeChild = DeckNode | CardNode | DeletedAnkiCardNode;

export interface DeckNode {
	kind: 'deck';
	id: string;
	name: string;
	deckPath: string;
	headingLevel: number;
	/** -1 for file root (no heading line). */
	lineStart: number;
	cardCount: number;
	children: SyncTreeChild[];
	sourceFilePath?: string;
	/**
	 * Note-level deck type (root, or file-mode child note).
	 * When set, the sync tree shows a type badge and settings control.
	 */
	deckType?: DeckType;
	/** 1-based index among sibling decks under the same parent. */
	siblingIndex?: number;
	/** This deck's index path from root children, e.g. [1, 2]. */
	deckIndexPath?: number[];
}

export interface ParsedHeadFile {
	filePath: string;
	fileName: string;
	/** Root deck display name (deckName YAML or formatted file name). */
	deckName: string;
	/** Active parse mode used for this result. */
	deckType: DeckType;
	/** Card heading level used for this parse. */
	deckLevel: number;
	/** Values declared in YAML, if any. */
	yamlDeckType?: DeckType;
	yamlDeckName?: string;
	yamlDeckLevel?: number;
	/** YAML deckTemplate (Anki note type), if any. */
	yamlDeckTemplate?: string;
	/** YAML deckNumbering override, if declared. */
	yamlDeckNumbering?: boolean;
	/** YAML deckStatus: true = archived, false = learning. */
	deckStatus: boolean;
	root: DeckNode;
	warnings: string[];
}

export interface ParseHeadFileOptions {
	/** Forced parse mode from the sync panel (default head). */
	deckType: DeckType;
	deckLevel: number;
	/** Head ---: include heading text in card front. Default false. */
	includeHeadingInFront?: boolean;
}
