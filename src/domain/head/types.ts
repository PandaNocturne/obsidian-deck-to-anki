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
	deckType: DeckType;
	archived: boolean;
	root: DeckNode;
	warnings: string[];
}

export interface ParseHeadFileOptions {
	defaultDeckType: DeckType;
	cardHeadingLevel: number;
}
