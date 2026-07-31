import type { App, TFile } from 'obsidian';
import { createIdMarkerRaw } from '../domain/head/idMarker';
import type { CardNode } from '../domain/head/types';
import { resolveSourceFile } from './backlink';

export interface PendingIdMarkerWrite {
	card: CardNode;
	noteId: number;
}

/**
 * Apply one `<!--ID: n-->` edit to an in-memory line array (no vault write).
 * `card.lineEnd` is exclusive. Call bottom-to-top when batching inserts.
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
 * Write or replace `<!--ID: n-->` for a single card (one vault modify).
 */
export async function writeCardIdMarker(
	app: App,
	file: TFile,
	card: CardNode,
	noteId: number,
): Promise<void> {
	const content = await app.vault.read(file);
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
		const lines = content.split(/\r?\n/);
		const sorted = [...items].sort(
			(a, b) => b.card.lineStart - a.card.lineStart,
		);
		for (const { card, noteId } of sorted) {
			applyCardIdMarkerToLines(lines, card, noteId);
		}
		await app.vault.modify(file, lines.join('\n'));
	}
}
