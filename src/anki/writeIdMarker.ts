import type { App, TFile } from 'obsidian';
import { createIdMarkerRaw } from '../domain/head/idMarker';
import type { CardNode } from '../domain/head/types';

/**
 * Write or replace `<!--ID: n-->` for a card block.
 * `card.lineEnd` is treated as exclusive end index.
 */
export async function writeCardIdMarker(
	app: App,
	file: TFile,
	card: CardNode,
	noteId: number,
): Promise<void> {
	const content = await app.vault.read(file);
	const lines = content.split(/\r?\n/);
	const marker = createIdMarkerRaw(noteId);

	if (card.idMarker) {
		const idx = card.idMarker.lineIndex;
		if (lines[idx] !== undefined) {
			lines[idx] = marker;
			await app.vault.modify(file, lines.join('\n'));
			return;
		}
	}

	const start = Math.max(0, card.lineStart);
	const endExclusive = Math.min(
		lines.length,
		Math.max(start + 1, card.lineEnd),
	);

	// Prefer inserting just before exclusive end (after card body).
	let insertAt = endExclusive;
	// Skip trailing blank lines inside the card range.
	while (insertAt > start && !(lines[insertAt - 1] ?? '').trim()) {
		insertAt -= 1;
	}

	lines.splice(insertAt, 0, marker);
	await app.vault.modify(file, lines.join('\n'));
}
