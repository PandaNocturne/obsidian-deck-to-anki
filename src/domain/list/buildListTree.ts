import {
	pruneEmptyDecks,
	recountCards,
} from '../head/buildHeadTree';
import { trailFromPathStack } from '../head/deckBacklinkTrail';
import { findIdMarkerInLines, parseIdMarker } from '../head/idMarker';
import type { CardNode, DeckNode } from '../head/types';
import { collectCardTags } from '../tags';

const LIST_ITEM_REGEXP = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEADING_REGEXP = /^(#{1,6})\s+(.*?)\s*$/;
/** Obsidian block id at end of a line: ^abc-123 */
const BLOCK_ID_REGEXP = /\s*\^([a-zA-Z0-9-]+)\s*$/;

function stripBlockId(text: string): { text: string; blockId?: string } {
	const match = text.match(BLOCK_ID_REGEXP);
	if (!match?.[1] || match.index === undefined) {
		return { text: text.trim() };
	}
	return {
		text: text.slice(0, match.index).trim(),
		blockId: match[1],
	};
}

function expandIndent(prefix: string): number {
	let n = 0;
	for (const ch of prefix) {
		n += ch === '\t' ? 4 : 1;
	}
	return n;
}

function matchListItem(
	line: string,
): { indent: number; text: string } | null {
	const match = line.match(LIST_ITEM_REGEXP);
	if (!match || match[3] === undefined) {
		return null;
	}
	return {
		indent: expandIndent(match[1] ?? ''),
		text: match[3].trim(),
	};
}

function matchHeading(
	line: string,
): { level: number; text: string } | null {
	const match = line.match(HEADING_REGEXP);
	if (!match?.[1] || match[2] === undefined) {
		return null;
	}
	const text = match[2].replace(/\s+#+\s*$/, '').trim();
	if (!text) {
		return null;
	}
	return { level: match[1].length, text };
}

function leadingIndent(line: string): number {
	const match = line.match(/^(\s*)/);
	return expandIndent(match?.[1] ?? '');
}

function isFenceLine(line: string): RegExpMatchArray | null {
	return line.match(/^(`{3,}|~{3,})/);
}

function joinDeckPath(parts: string[]): string {
	return parts.filter((part) => part.length > 0).join('::');
}

/** Skip YAML frontmatter so list items inside it are ignored. */
function bodyStartLineIndex(lines: string[]): number {
	if ((lines[0] ?? '').trim() !== '---') {
		return 0;
	}
	for (let i = 1; i < lines.length; i++) {
		if ((lines[i] ?? '').trim() === '---') {
			return i + 1;
		}
	}
	return 0;
}

export interface BuildListTreeOptions {
	filePath: string;
	content: string;
	deckName: string;
	/** When false, keep empty heading decks. Default true. */
	pruneEmpty?: boolean;
	/**
	 * When true, the single H1 is represented by the root deck name
	 * and is not inserted as a nested deck node.
	 */
	flattenSoleH1?: boolean;
}

/**
 * List mode:
 * - headings (H1–H6) form deck groups
 * - each top-level list item under the current heading is a card front
 * - nested list items / indented continuations become the back
 */
export function buildListTree(options: BuildListTreeOptions): {
	root: DeckNode;
	warnings: string[];
} {
	const { filePath, content, deckName, pruneEmpty = true, flattenSoleH1 = false } =
		options;
	const warnings: string[] = [];
	const lines = content.split(/\r?\n/);

	const root: DeckNode = {
		kind: 'deck',
		id: `deck:root:${filePath}`,
		name: deckName,
		deckPath: deckName,
		headingLevel: 0,
		lineStart: -1,
		cardCount: 0,
		children: [],
		sourceFilePath: filePath,
		deckType: 'list',
	};

	const deckStack: DeckNode[] = [root];
	const pathStack: string[] = [deckName];

	let topIndent: number | null = null;
	let cardFront = '';
	let cardFrontLine = -1;
	let backStart = -1;
	let backLines: string[] = [];
	let cardSeq = 0;
	let inFence = false;
	let fenceChar = '';

	const currentParent = (): DeckNode =>
		deckStack[deckStack.length - 1] ?? root;

	const flushCard = (endLineExclusive: number): void => {
		if (cardFrontLine < 0) {
			return;
		}

		const frontRaw = cardFront.trim();
		if (!frontRaw) {
			cardFrontLine = -1;
			backLines = [];
			backStart = -1;
			return;
		}

		const { text: front, blockId } = stripBlockId(frontRaw);

		const regionStart = backStart >= 0 ? backStart : cardFrontLine + 1;
		const idMarker = findIdMarkerInLines(
			lines,
			regionStart,
			endLineExclusive,
		);

		const backText = backLines
			.filter((_, idx) => {
				const lineIndex = regionStart + idx;
				return !idMarker || lineIndex !== idMarker.lineIndex;
			})
			.join('\n')
			.replace(/^\s*\n/, '')
			.replace(/\n+\s*$/, '')
			.trim();

		const parent = currentParent();
		cardSeq += 1;
		const card: CardNode = {
			kind: 'card',
			id: `card:${filePath}:${cardFrontLine}:${cardSeq}`,
			front,
			back: backText,
			headingLevel: 0,
			lineStart: cardFrontLine,
			lineEnd: Math.max(cardFrontLine, endLineExclusive - 1),
			deckPath: parent.deckPath,
			deckClass: 'list',
			tags: collectCardTags([front, backText]),
			noteId: idMarker?.noteId,
			idMarker: idMarker ?? undefined,
			blockId,
			sourceFilePath: filePath,
			deckBacklinkTrail: trailFromPathStack(pathStack, filePath),
		};
		parent.children.push(card);

		cardFrontLine = -1;
		cardFront = '';
		backLines = [];
		backStart = -1;
		topIndent = null;
	};

	const openHeadingDeck = (level: number, text: string, lineIndex: number): void => {
		while (
			deckStack.length > 1 &&
			(deckStack[deckStack.length - 1]?.headingLevel ?? 0) >= level
		) {
			deckStack.pop();
			pathStack.pop();
		}

		const parent = currentParent();
		const deckPath = joinDeckPath([...pathStack, text]);
		const deck: DeckNode = {
			kind: 'deck',
			id: `deck:${filePath}:${lineIndex}`,
			name: text,
			deckPath,
			headingLevel: level,
			lineStart: lineIndex,
			cardCount: 0,
			children: [],
			sourceFilePath: filePath,
		};
		parent.children.push(deck);
		deckStack.push(deck);
		pathStack.push(text);
	};

	const start = bodyStartLineIndex(lines);

	for (let i = start; i < lines.length; i++) {
		const line = lines[i] ?? '';

		const fenceMatch = isFenceLine(line);
		if (fenceMatch?.[1]) {
			const marker = fenceMatch[1];
			const ch = marker[0] ?? '`';
			if (!inFence) {
				inFence = true;
				fenceChar = ch;
			} else if (ch === fenceChar) {
				inFence = false;
				fenceChar = '';
			}
			if (cardFrontLine >= 0) {
				if (backStart < 0) {
					backStart = i;
				}
				backLines.push(line);
			}
			continue;
		}

		if (inFence) {
			if (cardFrontLine >= 0) {
				if (backStart < 0) {
					backStart = i;
				}
				backLines.push(line);
			}
			continue;
		}

		const heading = matchHeading(line);
		if (heading) {
			flushCard(i);
			if (flattenSoleH1 && heading.level === 1) {
				continue;
			}
			openHeadingDeck(heading.level, heading.text, i);
			continue;
		}

		const list = matchListItem(line);
		if (list) {
			if (topIndent === null || list.indent < topIndent) {
				flushCard(i);
				topIndent = list.indent;
				cardFront = list.text;
				cardFrontLine = i;
				backLines = [];
				backStart = -1;
			} else if (list.indent === topIndent) {
				flushCard(i);
				topIndent = list.indent;
				cardFront = list.text;
				cardFrontLine = i;
				backLines = [];
				backStart = -1;
			} else {
				if (backStart < 0) {
					backStart = i;
				}
				backLines.push(line);
			}
			continue;
		}

		if (cardFrontLine < 0) {
			continue;
		}

		if (line.trim() === '') {
			if (backStart < 0) {
				backStart = i;
			}
			backLines.push(line);
			continue;
		}

		// Keep Anki ID markers with the current card even at column 0.
		if (parseIdMarker(line, i)) {
			if (backStart < 0) {
				backStart = i;
			}
			backLines.push(line);
			continue;
		}

		const indent = leadingIndent(line);
		if (topIndent !== null && indent > topIndent) {
			if (backStart < 0) {
				backStart = i;
			}
			backLines.push(line);
			continue;
		}

		flushCard(i);
	}

	flushCard(lines.length);

	recountCards(root);
	if (pruneEmpty) {
		pruneEmptyDecks(root);
		recountCards(root);
	}

	if (root.cardCount === 0) {
		warnings.push('未识别到一级列表项');
	}

	return { root, warnings };
}
