export type DeckType = 'head' | 'basic' | 'file';

export type SyncPanelNodeKind = 'deck' | 'card';

export interface IdMarkerInfo {
	noteId: number;
	raw: string;
	lineIndex: number;
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
	noteId?: number;
	idMarker?: IdMarkerInfo;
}

export interface DeckNode {
	kind: 'deck';
	id: string;
	name: string;
	deckPath: string;
	headingLevel: number;
	/** -1 for file root (no heading line). */
	lineStart: number;
	cardCount: number;
	children: Array<DeckNode | CardNode>;
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
	/** YAML deckStatus: true = archived, false = learning. */
	deckStatus: boolean;
	root: DeckNode;
	warnings: string[];
}

export interface ParseHeadFileOptions {
	/** Forced parse mode from the sync panel (default head). */
	deckType: DeckType;
	deckLevel: number;
}
