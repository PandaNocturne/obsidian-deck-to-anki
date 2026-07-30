import type { AnkiConnectClient } from './AnkiConnectClient';

/** Leaf decks: no other deck name is a child under `name::`. */
export function collectLeafDeckNames(deckNames: string[]): string[] {
	return deckNames.filter(
		(deckName) =>
			!deckNames.some(
				(candidate) =>
					candidate !== deckName &&
					candidate.startsWith(`${deckName}::`),
			),
	);
}

/**
 * Delete empty leaf decks in Anki (skip Default).
 * Repeats a few rounds so parents that become leaves after child removal
 * are also cleaned.
 */
export async function cleanupEmptyAnkiDecks(
	client: AnkiConnectClient,
): Promise<{ deleted: string[] }> {
	const deleted: string[] = [];
	const protectedNames = new Set(['Default', '默认']);

	for (let round = 0; round < 8; round++) {
		const names = await client.listDeckNames();
		const leaves = collectLeafDeckNames(names).filter(
			(name) => !protectedNames.has(name),
		);
		if (leaves.length === 0) {
			break;
		}

		const stats = await client.getDeckStats(leaves);
		const empty = stats
			.filter((stat) => stat.noteCount === 0)
			.map((stat) => stat.deckName)
			.sort(
				(a, b) =>
					b.split('::').length - a.split('::').length ||
					b.length - a.length,
			);

		if (empty.length === 0) {
			break;
		}

		await client.deleteDecks(empty);
		deleted.push(...empty);
	}

	return { deleted: [...new Set(deleted)] };
}
