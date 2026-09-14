import type { App, TFile } from 'obsidian';
import {
	createIdMarkerRaw,
	ID_MARKER_REGEXP,
	parseIdMarker,
} from '../domain/head/idMarker';
import { upsertDeckIdYaml } from '../domain/head/frontmatter';
import type { CardNode } from '../domain/head/types';
import { isFileScopedCardMode } from '../domain/head/types';
import { resolveSourceFile } from './backlink';

export interface PendingIdMarkerWrite {
	card: CardNode;
	noteId: number;
}

const FRONTMATTER_REGEXP = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
/** Trailing Obsidian block id on a list front line. */
const TRAILING_BLOCK_ID_REGEXP = /\s*\^[a-zA-Z0-9-]+\s*$/;

/**
 * Remove legacy `<!--ID: n-->` lines from the note body (after YAML).
 * Used when migrating card-mode ids into YAML `deckID`.
 * No-op when no markers exist (avoids rewriting the whole body / line endings).
 */
function stripLegacyIdMarkersFromBody(content: string): string {
	const match = content.match(FRONTMATTER_REGEXP);
	const bodyStart =
		match && match.index !== undefined
			? match.index + match[0].length
			: 0;
	const prefix = content.slice(0, bodyStart);
	const body = content.slice(bodyStart);
	const lines = body.split(/\r?\n/);
	if (!lines.some((line) => ID_MARKER_REGEXP.test(line))) {
		return content;
	}
	const cleaned = lines
		.filter((line) => !ID_MARKER_REGEXP.test(line))
		.join('\n')
		.replace(/^\n+/, '');
	return `${prefix}${cleaned}`;
}

function applyCardModeDeckId(
	content: string,
	noteId: number,
	deckType: 'card' | 'title' = 'card',
): string {
	return stripLegacyIdMarkersFromBody(
		upsertDeckIdYaml(content, noteId, deckType),
	);
}

/**
 * Apply one `<!--ID: n-->` edit to an in-memory line array (no vault write).
 * `card.lineEnd` is exclusive. Call bottom-to-top when batching inserts.
 * Used for head-mode cards only.
 */
export function applyCardIdMarkerToLines(
	lines: string[],
	card: CardNode,
	noteId: number,
): void {
	const marker = createIdMarkerRaw(noteId);

	if (card.idMarker) {
		const idx = card.idMarker.lineIndex;
		if (lines[idx] !== undefined) {
			lines[idx] = marker;
			return;
		}
	}

	const start = Math.max(0, card.lineStart);
	const endExclusive = Math.min(
		lines.length,
		Math.max(start + 1, card.lineEnd),
	);

	let insertAt = endExclusive;
	while (insertAt > start && !(lines[insertAt - 1] ?? '').trim()) {
		insertAt -= 1;
	}

	// Keep one blank line between body and <!--ID: ...-->.
	if (insertAt < lines.length && !(lines[insertAt] ?? '').trim()) {
		lines.splice(insertAt + 1, 0, marker);
	} else {
		lines.splice(insertAt, 0, '', marker);
	}
}

/**
 * List mode: put Anki note id as Obsidian block id on the top-level list line
 * (`- front ^123`) and remove legacy `<!--ID: n-->` in that card’s range.
 * `card.lineEnd` is treated as inclusive (list parser convention).
 */
export function applyListBlockIdToLines(
	lines: string[],
	card: CardNode,
	noteId: number,
): void {
	const idx = Math.max(0, card.lineStart);
	const line = lines[idx];
	if (line === undefined) {
		return;
	}

	const withoutId = line.replace(TRAILING_BLOCK_ID_REGEXP, '').replace(/\s+$/g, '');
	lines[idx] = `${withoutId} ^${noteId}`;

	// Strip legacy HTML markers inside this card (bottom → top).
	const endInclusive = Math.min(
		lines.length - 1,
		Math.max(idx, card.lineEnd),
	);
	for (let i = endInclusive; i > idx; i--) {
		const raw = lines[i];
		if (raw === undefined || !parseIdMarker(raw, i)) {
			continue;
		}
		lines.splice(i, 1);
		// Drop the blank spacer line commonly left above <!--ID-->.
		if (i - 1 > idx && !(lines[i - 1] ?? '').trim()) {
			lines.splice(i - 1, 1);
		}
	}
}

/**
 * Persist Anki note id for a card:
 * - card/title mode → YAML `deckID` (and strip legacy bottom `<!--ID-->`)
 * - list mode → `^noteId` on the first-level list item
 * - head mode → `<!--ID: n-->` near the card block
 */
export async function writeCardIdMarker(
	app: App,
	file: TFile,
	card: CardNode,
	noteId: number,
): Promise<void> {
	const content = await app.vault.read(file);
	if (isFileScopedCardMode(card.deckClass)) {
		const deckType = card.deckClass === 'title' ? 'title' : 'card';
		const next = applyCardModeDeckId(content, noteId, deckType);
		if (next !== content) {
			await app.vault.modify(file, next);
		}
		return;
	}
	const lines = content.split(/\r?\n/);
	if (card.deckClass === 'list') {
		applyListBlockIdToLines(lines, card, noteId);
	} else {
		applyCardIdMarkerToLines(lines, card, noteId);
	}
	await app.vault.modify(file, lines.join('\n'));
}

/**
 * After Anki sync finishes: write all pending ID markers, one modify per file.
 * Within each file, apply from bottom to top so line indexes stay valid.
 */
export async function writePendingIdMarkers(
	app: App,
	pending: PendingIdMarkerWrite[],
): Promise<void> {
	if (pending.length === 0) {
		return;
	}

	const byFile = new Map<string, PendingIdMarkerWrite[]>();
	for (const item of pending) {
		const path = item.card.sourceFilePath;
		if (!path) {
			continue;
		}
		const list = byFile.get(path) ?? [];
		list.push(item);
		byFile.set(path, list);
	}

	for (const [filePath, items] of byFile) {
		const file = resolveSourceFile(app, filePath);
		if (!file) {
			continue;
		}
		const content = await app.vault.read(file);
		const cardMode = items.filter((i) =>
			isFileScopedCardMode(i.card.deckClass),
		);
		const listMode = items.filter((i) => i.card.deckClass === 'list');
		const headMode = items.filter(
			(i) =>
				!isFileScopedCardMode(i.card.deckClass) &&
				i.card.deckClass !== 'list',
		);

		let next = content;
		// Card/title mode: one file = one card → YAML deckID.
		for (const { card, noteId } of cardMode) {
			const deckType = card.deckClass === 'title' ? 'title' : 'card';
			next = applyCardModeDeckId(next, noteId, deckType);
		}

		if (listMode.length > 0 || headMode.length > 0) {
			const lines = next.split(/\r?\n/);
			const sorted = [...listMode, ...headMode].sort(
				(a, b) => b.card.lineStart - a.card.lineStart,
			);
			for (const { card, noteId } of sorted) {
				if (card.deckClass === 'list') {
					applyListBlockIdToLines(lines, card, noteId);
				} else {
					applyCardIdMarkerToLines(lines, card, noteId);
				}
			}
			next = lines.join('\n');
		}

		if (next !== content) {
			await app.vault.modify(file, next);
		}
	}
}
