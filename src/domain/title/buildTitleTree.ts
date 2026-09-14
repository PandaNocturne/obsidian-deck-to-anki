import { stripYamlFrontmatter } from '../card/buildCardTree';
import { recountCards } from '../head/buildHeadTree';
import { trailFromPathStack } from '../head/deckBacklinkTrail';
import { formatDefaultDeckName } from '../head/formatDefaultDeckName';
import { parseFrontmatter } from '../head/frontmatter';
import { findIdMarkerInLines } from '../head/idMarker';
import type {
	CardNode,
	DeckBacklinkSegment,
	DeckNode,
} from '../head/types';
import { collectCardTags } from '../tags';

export interface BuildTitleTreeOptions {
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
 * Parse a title-mode note into a single CardNode (no nested deck).
 * Front = formatted filename; back = full body after YAML (no --- split).
 */
export function buildTitleNode(options: BuildTitleTreeOptions): {
	card: CardNode | null;
	warnings: string[];
} {
	const { filePath, content, deckName, parentDeckPath, deckBacklinkTrail } =
		options;
	const warnings: string[] = [];
	const deckPath = parentDeckPath
		? `${parentDeckPath}::${deckName}`
		: deckName;

	const front = formatDefaultDeckName(filePath).trim();
	if (!front) {
		warnings.push('无法从文件名得到卡片正面');
		return { card: null, warnings };
	}

	const { body, bodyStartLineIndex } = stripYamlFrontmatter(content);
	const allLines = content.split(/\r?\n/);
	const lineStart = bodyStartLineIndex;
	const lineEnd = allLines.length - 1;

	const yamlDeckId = parseFrontmatter(content).deckID;
	const idMarker = findIdMarkerInLines(
		allLines,
		Math.max(0, bodyStartLineIndex),
		allLines.length,
	);

	let backText = body.replace(/^\s+|\s+$/g, '');
	if (idMarker) {
		const idLineRel = idMarker.lineIndex - bodyStartLineIndex;
		if (idLineRel >= 0) {
			const backLines = body.split(/\r?\n/);
			backText = backLines
				.filter((_, idx) => idx !== idLineRel)
				.join('\n')
				.replace(/^\s+|\s+$/g, '');
		}
	}

	if (!backText.trim()) {
		warnings.push('卡片反面为空');
	}

	const card: CardNode = {
		kind: 'card',
		id: `title:${filePath}:0:1`,
		front,
		back: backText,
		headingLevel: 0,
		lineStart,
		lineEnd,
		deckPath,
		deckClass: 'title',
		tags: collectCardTags([front, backText], content),
		noteId: yamlDeckId ?? idMarker?.noteId,
		hasYamlDeckId: yamlDeckId !== undefined,
		idMarker: idMarker ?? undefined,
		sourceFilePath: filePath,
		deckBacklinkTrail:
			deckBacklinkTrail ??
			trailFromPathStack(deckPath.split('::'), filePath),
	};
	return { card, warnings };
}

/**
 * Synthetic root used only so ParsedHeadFile / current-tab can host the card.
 * UI should skipRootRow for deckType title so the deck row is not shown.
 */
export function buildTitleTree(options: BuildTitleTreeOptions): {
	root: DeckNode;
	card: CardNode | null;
	warnings: string[];
} {
	const { filePath, deckName } = options;
	const { card, warnings } = buildTitleNode(options);

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
		deckType: 'title',
	};
	recountCards(root);
	return { root, card, warnings };
}
