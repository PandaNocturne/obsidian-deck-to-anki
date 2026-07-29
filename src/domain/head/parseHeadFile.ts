import { findIdMarkerInLines } from './idMarker';
import { formatDefaultDeckName } from './formatDefaultDeckName';
import { parseFrontmatter } from './frontmatter';
import type {
	CardNode,
	DeckNode,
	ParseHeadFileOptions,
	ParsedHeadFile,
} from './types';

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

function joinDeckPath(parts: string[]): string {
	return parts.filter((part) => part.length > 0).join('::');
}

function recountCards(node: DeckNode): number {
	let count = 0;
	for (const child of node.children) {
		if (child.kind === 'card') {
			count += 1;
		} else {
			count += recountCards(child);
		}
	}
	node.cardCount = count;
	return count;
}

/** Remove deck groups that contain no cards in their subtree (keep root). */
function pruneEmptyDecks(node: DeckNode): void {
	node.children = node.children.filter((child) => {
		if (child.kind === 'card') {
			return true;
		}
		pruneEmptyDecks(child);
		return child.cardCount > 0;
	});
}

function basenameWithoutExt(filePath: string): string {
	const base = filePath.split(/[/\\]/).pop() ?? filePath;
	return base.replace(/\.md$/i, '');
}

/**
 * Parse the current note as a deck tree.
 * Parse mode/level come from options (resolved from YAML + defaults by caller).
 */
export function parseHeadFile(
	filePath: string,
	content: string,
	options: ParseHeadFileOptions,
): ParsedHeadFile {
	const meta = parseFrontmatter(content);
	const warnings = [...meta.warnings];
	const deckType = options.deckType;
	const fileName = basenameWithoutExt(filePath);
	const deckName = meta.deckName?.trim() || formatDefaultDeckName(filePath);
	const lines = content.split(/\r?\n/);
	const cardLevel = options.deckLevel;

	const root: DeckNode = {
		kind: 'deck',
		id: `deck:root:${filePath}`,
		name: deckName,
		deckPath: deckName,
		headingLevel: 0,
		lineStart: -1,
		cardCount: 0,
		children: [],
	};

	const baseResult = {
		filePath,
		fileName,
		deckName,
		deckType,
		deckLevel: cardLevel,
		yamlDeckType: meta.deckType,
		yamlDeckName: meta.deckName,
		yamlDeckLevel: meta.deckLevel,
		deckStatus: meta.deckStatus,
		root,
		warnings,
	};

	if (deckType !== 'head') {
		warnings.push(`${deckType} 解析尚未实现`);
		return baseResult;
	}

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
			const idMarker = findIdMarkerInLines(
				lines,
				heading.lineIndex + 1,
				blockEnd,
			);
			const back = extractBack(
				lines,
				heading.lineIndex + 1,
				blockEnd,
				idMarker?.lineIndex,
			);

			cardSeq += 1;
			const card: CardNode = {
				kind: 'card',
				id: `card:${filePath}:${heading.lineIndex}:${cardSeq}`,
				front: heading.text,
				back,
				headingLevel: heading.level,
				lineStart: heading.lineIndex,
				lineEnd: blockEnd,
				deckPath: parent.deckPath,
				noteId: idMarker?.noteId,
				idMarker: idMarker ?? undefined,
			};
			parent.children.push(card);
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
		};

		parent.children.push(deck);
		deckStack.push(deck);
		pathStack.push(heading.text);
	}

	recountCards(root);
	pruneEmptyDecks(root);
	recountCards(root);

	return baseResult;
}
