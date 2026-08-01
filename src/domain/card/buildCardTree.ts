import { recountCards } from '../head/buildHeadTree';
import { trailFromPathStack } from '../head/deckBacklinkTrail';
import { parseFrontmatter } from '../head/frontmatter';
import { findIdMarkerInLines } from '../head/idMarker';
import type {
	CardNode,
	DeckBacklinkSegment,
	DeckNode,
} from '../head/types';
import { collectCardTags } from '../tags';

const FRONTMATTER_REGEXP = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
/** Horizontal rule used as front/back separator (not YAML). */
const CARD_SEP_REGEXP = /^---\s*$/;
const FENCE_REGEXP = /^(`{3,}|~{3,})/;

export interface BuildCardTreeOptions {
	filePath: string;
	content: string;
	/** Display / deckPath label (file name or alias). */
	deckName: string;
	/** Parent deckPath when nested under file mode. */
	parentDeckPath?: string;
	/** Precomputed Anki backlink crumbs (file mode parent + this note). */
	deckBacklinkTrail?: DeckBacklinkSegment[];
}

/**
 * Strip leading YAML frontmatter; return body and the line index where body starts.
 */
export function stripYamlFrontmatter(content: string): {
	body: string;
	bodyStartLineIndex: number;
} {
	const match = content.match(FRONTMATTER_REGEXP);
	if (!match || match.index === undefined) {
		return { body: content, bodyStartLineIndex: 0 };
	}
	const fmLines = match[0].split(/\r?\n/);
	const bodyStartLineIndex =
		fmLines.length - (match[0].endsWith('\n') ? 1 : 0);
	return {
		body: content.slice(match.index + match[0].length),
		bodyStartLineIndex,
	};
}

/**
 * Split body on the first standalone `---` line (outside code fences).
 * Above → front; below → back.
 */
export function splitCardFrontBack(body: string): {
	front: string;
	back: string;
	sepLineInBody: number;
	hasSeparator: boolean;
} {
	const lines = body.split(/\r?\n/);
	let inFence = false;
	let fenceChar = '';

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const fenceMatch = line.match(FENCE_REGEXP);
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
			const front = lines.slice(0, i).join('\n').replace(/^\s+|\s+$/g, '');
			const back = lines
				.slice(i + 1)
				.join('\n')
				.replace(/^\s+|\s+$/g, '');
			return { front, back, sepLineInBody: i, hasSeparator: true };
		}
	}

	return {
		front: body.replace(/^\s+|\s+$/g, ''),
		back: '',
		sepLineInBody: -1,
		hasSeparator: false,
	};
}

/**
 * Parse a card-mode note into a single CardNode (no nested deck).
 * One file = one card; front / back split by --- after stripping YAML.
 */
export function buildCardNode(options: BuildCardTreeOptions): {
	card: CardNode | null;
	warnings: string[];
} {
	const { filePath, content, deckName, parentDeckPath, deckBacklinkTrail } =
		options;
	const warnings: string[] = [];
	const deckPath = parentDeckPath
		? `${parentDeckPath}::${deckName}`
		: deckName;

	const { body, bodyStartLineIndex } = stripYamlFrontmatter(content);
	if (!body.trim()) {
		warnings.push('去除 YAML 后正文为空');
		return { card: null, warnings };
	}

	const { front, back, sepLineInBody, hasSeparator } =
		splitCardFrontBack(body);
	if (!hasSeparator) {
		warnings.push('未找到正文分隔符 ---（正面 / 反面）');
	}
	if (!front.trim()) {
		warnings.push('卡片正面为空');
		return { card: null, warnings };
	}

	const allLines = content.split(/\r?\n/);
	const lineStart = bodyStartLineIndex;
	const sepAbs =
		sepLineInBody >= 0 ? bodyStartLineIndex + sepLineInBody : -1;
	const lineEnd = allLines.length - 1;

	const backStart =
		sepAbs >= 0
			? sepAbs + 1
			: bodyStartLineIndex + body.split(/\r?\n/).length;
	// Prefer YAML deckID; fall back to legacy <!--ID: n--> at file bottom.
	const yamlDeckId = parseFrontmatter(content).deckID;
	const idMarker = findIdMarkerInLines(
		allLines,
		Math.max(0, backStart),
		allLines.length,
	);

	let backText = back;
	if (idMarker && sepAbs >= 0) {
		const idLineRel = idMarker.lineIndex - (sepAbs + 1);
		if (idLineRel >= 0) {
			const backLines = back.split(/\r?\n/);
			backText = backLines
				.filter((_, idx) => idx !== idLineRel)
				.join('\n')
				.replace(/^\s+|\s+$/g, '');
		}
	}

	const noteId = yamlDeckId ?? idMarker?.noteId;
	const card: CardNode = {
		kind: 'card',
		id: `card:${filePath}:0:1`,
		front: front.trim(),
		back: backText,
		headingLevel: 0,
		lineStart,
		lineEnd,
		deckPath,
		deckClass: 'card',
		tags: collectCardTags([front, backText], content),
		noteId,
		// YAML-backed ids do not use an HTML marker line.
		idMarker: yamlDeckId !== undefined ? undefined : (idMarker ?? undefined),
		sourceFilePath: filePath,
		deckBacklinkTrail:
			deckBacklinkTrail ??
			trailFromPathStack(deckPath.split('::'), filePath),
	};
	return { card, warnings };
}

/**
 * Synthetic root used only so ParsedHeadFile / current-tab can host the card.
 * UI should skipRootRow for deckType card so the deck row is not shown.
 */
export function buildCardTree(options: BuildCardTreeOptions): {
	root: DeckNode;
	card: CardNode | null;
	warnings: string[];
} {
	const { filePath, deckName } = options;
	const { card, warnings } = buildCardNode(options);

	const root: DeckNode = {
		kind: 'deck',
		id: `deck:root:${filePath}`,
		name: deckName,
		deckPath: deckName,
		headingLevel: 0,
		lineStart: -1,
		cardCount: 0,
		children: card ? [card] : [],
		sourceFilePath: filePath,
		deckType: 'card',
	};
	recountCards(root);
	return { root, card, warnings };
}
