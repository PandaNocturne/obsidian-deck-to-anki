import { trailFromPathStack } from './deckBacklinkTrail';
import { findIdMarkerInLines } from './idMarker';
import type { CardNode, DeckBacklinkSegment, DeckNode } from './types';
import { collectCardTags } from '../tags';

const HEADING_REGEXP = /^(#{1,6})\s+(.*?)\s*$/;

interface RawHeading {
	level: number;
	text: string;
	lineIndex: number;
}

function stripTrailingHeadingMarks(text: string): string {
	return text.replace(/\s+#+\s*$/, '').trim();
}

function collectHeadings(lines: string[]): RawHeading[] {
	const headings: RawHeading[] = [];
	let inFence = false;
	let fenceChar = '';

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const fenceMatch = line.match(/^(`{3,}|~{3,})/);
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
			continue;
		}

		if (inFence) {
			continue;
		}

		const headingMatch = line.match(HEADING_REGEXP);
		if (!headingMatch?.[1] || headingMatch[2] === undefined) {
			continue;
		}

		headings.push({
			level: headingMatch[1].length,
			text: stripTrailingHeadingMarks(headingMatch[2]),
			lineIndex: i,
		});
	}

	return headings;
}

function findBlockEnd(
	headings: RawHeading[],
	index: number,
	lineCount: number,
): number {
	const current = headings[index];
	if (!current) {
		return lineCount;
	}

	for (let i = index + 1; i < headings.length; i++) {
		const next = headings[i];
		if (next && next.level <= current.level) {
			return next.lineIndex;
		}
	}
	return lineCount;
}

function extractBack(
	lines: string[],
	bodyStart: number,
	blockEnd: number,
	idLineIndex?: number,
): string {
	const end =
		idLineIndex !== undefined && idLineIndex >= bodyStart
			? idLineIndex
			: blockEnd;
	return lines
		.slice(bodyStart, end)
		.join('\n')
		.replace(/^\n+|\n+$/g, '');
}

const CARD_SEP_REGEXP = /^---\s*$/;

/** First standalone --- in [start, endExclusive), skipping fenced code. */
function findHrSeparatorLine(
	lines: string[],
	start: number,
	endExclusive: number,
): number {
	let inFence = false;
	let fenceChar = '';
	for (let i = start; i < endExclusive; i++) {
		const line = lines[i] ?? '';
		const fenceMatch = line.match(/^(`{3,}|~{3,})/);
		if (fenceMatch?.[1]) {
			const ch = fenceMatch[1][0] ?? '`';
			if (!inFence) {
				inFence = true;
				fenceChar = ch;
			} else if (ch === fenceChar) {
				inFence = false;
				fenceChar = '';
			}
			continue;
		}
		if (inFence) {
			continue;
		}
		if (CARD_SEP_REGEXP.test(line)) {
			return i;
		}
	}
	return -1;
}

function joinFrontParts(heading: string, body: string, includeHeading: boolean): string {
	const bodyTrim = body.replace(/^\s+|\s+$/g, '');
	if (includeHeading) {
		if (!bodyTrim) {
			return heading;
		}
		return `${heading}\n\n${bodyTrim}`;
	}
	return bodyTrim;
}

function joinDeckPath(parts: string[]): string {
	return parts.filter((part) => part.length > 0).join('::');
}

export function recountCards(node: DeckNode): number {
	let count = 0;
	for (const child of node.children) {
		if (child.kind === 'card' || child.kind === 'deleted-anki') {
			count += 1;
		} else if (child.kind === 'deck') {
			count += recountCards(child);
		}
	}
	node.cardCount = count;
	return count;
}

/** Remove deck groups that contain no cards in their subtree (keep root). */
export function pruneEmptyDecks(node: DeckNode): void {
	node.children = node.children.filter((child) => {
		if (child.kind === 'card' || child.kind === 'deleted-anki') {
			return true;
		}
		if (child.kind === 'deck') {
			pruneEmptyDecks(child);
			return child.cardCount > 0;
		}
		return false;
	});
}

export function repathDeckTree(
	node: DeckNode,
	parentPath: string,
	parentTrailPrefix: DeckBacklinkSegment[] = [],
): void {
	node.deckPath = joinDeckPath([parentPath, node.name]);
	for (const child of node.children) {
		if (child.kind === 'deck') {
			repathDeckTree(child, node.deckPath, parentTrailPrefix);
		} else if (child.kind === 'card') {
			child.deckPath = node.deckPath;
			if (parentTrailPrefix.length > 0) {
				child.deckBacklinkTrail = [
					...parentTrailPrefix,
					...(child.deckBacklinkTrail ?? []),
				];
			}
		}
	}
}

export function annotateSourceFile(node: DeckNode, sourceFilePath: string): void {
	node.sourceFilePath = sourceFilePath;
	for (const child of node.children) {
		if (child.kind === 'deck') {
			annotateSourceFile(child, sourceFilePath);
		} else if (child.kind === 'card') {
			child.sourceFilePath = sourceFilePath;
		}
	}
}

export interface BuildHeadTreeOptions {
	filePath: string;
	content: string;
	deckName: string;
	cardHeadingLevel: number;
	/** When false, keep empty nested decks (used by file-mode link groups). */
	pruneEmpty?: boolean;
	/**
	 * When true, the single H1 is represented by the root deck name
	 * and is not inserted as a nested deck node.
	 */
	flattenSoleH1?: boolean;
	/**
	 * When card body has ---, include heading text in the front.
	 * Default false.
	 */
	includeHeadingInFront?: boolean;
}

/**
 * Build a head-mode deck tree for one markdown file.
 */
export function buildHeadTree(options: BuildHeadTreeOptions): {
	root: DeckNode;
	warnings: string[];
} {
	const {
		filePath,
		content,
		deckName,
		cardHeadingLevel: cardLevel,
		pruneEmpty = true,
		flattenSoleH1 = false,
		includeHeadingInFront = false,
	} = options;
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
	};

	const headings = collectHeadings(lines);
	const deckStack: DeckNode[] = [root];
	const pathStack: string[] = [deckName];
	let cardSeq = 0;

	for (let hi = 0; hi < headings.length; hi++) {
		const heading = headings[hi];
		if (!heading) {
			continue;
		}

		if (heading.level > cardLevel) {
			continue;
		}

		const blockEnd = findBlockEnd(headings, hi, lines.length);

		if (heading.level === cardLevel) {
			const parent = deckStack[deckStack.length - 1] ?? root;
			const bodyStart = heading.lineIndex + 1;
			const idMarker = findIdMarkerInLines(
				lines,
				bodyStart,
				blockEnd,
			);
			const sepLine = findHrSeparatorLine(lines, bodyStart, blockEnd);

			let front: string;
			let back: string;

			if (sepLine >= 0) {
				// Smart ---: body above → front (title optional); below → back.
				// Title always lives in navTitle / ob-deck-head, not in front
				// unless includeHeadingInFront is on.
				const above = lines
					.slice(bodyStart, sepLine)
					.join('\n')
					.replace(/^\n+|\n+$/g, '');
				front = joinFrontParts(
					heading.text,
					above,
					includeHeadingInFront,
				);
				back = extractBack(
					lines,
					sepLine + 1,
					blockEnd,
					idMarker?.lineIndex,
				);
			} else {
				// No ---: title → head (navTitle); body under heading → back.
				// Do not put the heading into front.
				front = '';
				back = extractBack(
					lines,
					bodyStart,
					blockEnd,
					idMarker?.lineIndex,
				);
			}

			cardSeq += 1;
			const card: CardNode = {
				kind: 'card',
				id: `card:${filePath}:${heading.lineIndex}:${cardSeq}`,
				front,
				back,
				headingLevel: heading.level,
				lineStart: heading.lineIndex,
				lineEnd: blockEnd,
				deckPath: parent.deckPath,
				deckClass: 'head',
				navTitle: heading.text,
				tags: collectCardTags([heading.text, front, back]),
				noteId: idMarker?.noteId,
				idMarker: idMarker ?? undefined,
				sourceFilePath: filePath,
				deckBacklinkTrail: trailFromPathStack(pathStack, filePath),
			};
			parent.children.push(card);
			continue;
		}

		if (flattenSoleH1 && heading.level === 1) {
			continue;
		}

		while (
			deckStack.length > 1 &&
			(deckStack[deckStack.length - 1]?.headingLevel ?? 0) >=
			heading.level
		) {
			deckStack.pop();
			pathStack.pop();
		}

		const parent = deckStack[deckStack.length - 1] ?? root;
		const deckPath = joinDeckPath([...pathStack, heading.text]);
		const deck: DeckNode = {
			kind: 'deck',
			id: `deck:${filePath}:${heading.lineIndex}`,
			name: heading.text,
			deckPath,
			headingLevel: heading.level,
			lineStart: heading.lineIndex,
			cardCount: 0,
			children: [],
			sourceFilePath: filePath,
		};

		parent.children.push(deck);
		deckStack.push(deck);
		pathStack.push(heading.text);
	}

	recountCards(root);
	if (pruneEmpty) {
		pruneEmptyDecks(root);
		recountCards(root);
	}

	return { root, warnings };
}
