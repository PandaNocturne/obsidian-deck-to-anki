import type { App, TFile } from 'obsidian';
import { createIdMarkerRaw, ID_MARKER_REGEXP } from '../domain/head/idMarker';
import { upsertDeckIdYaml } from '../domain/head/frontmatter';
import type { CardNode } from '../domain/head/types';
import { resolveSourceFile } from './backlink';

export interface PendingIdMarkerWrite {
	card: CardNode;
	noteId: number;
}

const FRONTMATTER_REGEXP = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

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

function applyCardModeDeckId(content: string, noteId: number): string {
	return stripLegacyIdMarkersFromBody(upsertDeckIdYaml(content, noteId));
}

/**
 * Apply one `<!--ID: n-->` edit to an in-memory line array (no vault write).
 * `card.lineEnd` is exclusive. Call bottom-to-top when batching inserts.
 * Not used for card-mode files (those use YAML `deckID`).
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
 * Persist Anki note id for a card:
 * - card mode → YAML `deckID` (and strip legacy bottom `<!--ID-->`)
 * - head/list → `<!--ID: n-->` near the card block
 */
export async function writeCardIdMarker(
	app: App,
	file: TFile,
	card: CardNode,
	noteId: number,
): Promise<void> {
	const content = await app.vault.read(file);
	if (card.deckClass === 'card') {
		const next = applyCardModeDeckId(content, noteId);
		if (next !== content) {
			await app.vault.modify(file, next);
		}
		return;
	}
	const lines = content.split(/\r?\n/);
	applyCardIdMarkerToLines(lines, card, noteId);
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
		const cardMode = items.filter((i) => i.card.deckClass === 'card');
		const markerMode = items.filter((i) => i.card.deckClass !== 'card');

		let next = content;
		// Card-mode: one file = one card → YAML deckID.
		for (const { noteId } of cardMode) {
			next = applyCardModeDeckId(next, noteId);
		}

		if (markerMode.length > 0) {
			const lines = next.split(/\r?\n/);
			const sorted = [...markerMode].sort(
				(a, b) => b.card.lineStart - a.card.lineStart,
			);
			for (const { card, noteId } of sorted) {
				applyCardIdMarkerToLines(lines, card, noteId);
			}
			next = lines.join('\n');
		}

		if (next !== content) {
			await app.vault.modify(file, next);
		}
	}
}
