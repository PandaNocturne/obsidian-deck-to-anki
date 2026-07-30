import type { App } from 'obsidian';
import type { DeckToAnkiSettings } from '../settings';
import { parseFrontmatter } from '../domain/head/frontmatter';
import type {
	CardNode,
	DeletedAnkiCardNode,
	DeckNode,
	SyncCardStatus,
	SyncTreeChild,
} from '../domain/head/types';
import { AnkiConnectClient } from './AnkiConnectClient';
import {
	buildDeckBacklinkHtml,
	buildDeckSegmentUris,
	resolveSourceFile,
	toAnkiDeckName,
} from './backlink';
import { renderFieldWithMedia, toAnkiTags } from './renderFields';
import {
	DECK_TEMPLATE_IDS,
	FIELD_BACK,
	FIELD_BACKLINK,
	FIELD_FRONT,
	FIELD_TAGS,
	type DeckTemplateId,
} from './templates';

export interface AnkiComparablePayload {
	deckName: string;
	modelName: DeckTemplateId;
	fields: Record<string, string>;
	tags: string[];
}

export interface SyncStatusPrefetchResult {
	/** True when AnkiConnect responded. */
	ankiOnline: boolean;
	warning?: string;
	/** Deleted-only notes attached under matching decks. */
	deletedCount: number;
}

function resolveDeckTemplate(
	yamlValue: string | undefined,
	fallback: DeckTemplateId,
): DeckTemplateId {
	if (yamlValue && DECK_TEMPLATE_IDS.includes(yamlValue as DeckTemplateId)) {
		return yamlValue as DeckTemplateId;
	}
	return fallback;
}

function escapeAnkiQueryValue(value: string): string {
	return value.replace(/"/g, '\\"');
}

function normalizeFieldHtml(html: string): string {
	return html.replace(/\r\n/g, '\n').trim();
}

function stripHtmlToText(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, ' ')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, ' ')
		.trim();
}

function tagsEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	const sa = [...a].map((t) => t.toLowerCase()).sort();
	const sb = [...b].map((t) => t.toLowerCase()).sort();
	return sa.every((t, i) => t === sb[i]);
}

export function collectLocalCards(node: DeckNode | CardNode): CardNode[] {
	if (node.kind === 'card') {
		return [node];
	}
	const out: CardNode[] = [];
	for (const child of node.children) {
		if (child.kind === 'card') {
			out.push(child);
		} else if (child.kind === 'deck') {
			out.push(...collectLocalCards(child));
		}
	}
	return out;
}

function collectDeckPaths(node: DeckNode, into: Set<string>): void {
	const path = toAnkiDeckName(node.deckPath);
	if (path) {
		into.add(path);
	}
	for (const child of node.children) {
		if (child.kind === 'deck') {
			collectDeckPaths(child, into);
		} else if (child.kind === 'card') {
			const cardDeck = toAnkiDeckName(child.deckPath);
			if (cardDeck) {
				into.add(cardDeck);
			}
		}
	}
}

function findDeckByPath(root: DeckNode, deckPath: string): DeckNode | null {
	const target = toAnkiDeckName(deckPath);
	if (!target) {
		return null;
	}
	if (toAnkiDeckName(root.deckPath) === target) {
		return root;
	}
	for (const child of root.children) {
		if (child.kind === 'deck') {
			const hit = findDeckByPath(child, target);
			if (hit) {
				return hit;
			}
		}
	}
	return null;
}

/** Longest matching ancestor deck, or root. */
function findClosestDeck(root: DeckNode, deckPath: string): DeckNode {
	const target = toAnkiDeckName(deckPath);
	const parts = target.split('::').filter(Boolean);
	let best: DeckNode = root;
	let prefix = '';
	for (const part of parts) {
		prefix = prefix ? `${prefix}::${part}` : part;
		const hit = findDeckByPath(root, prefix);
		if (hit) {
			best = hit;
		}
	}
	return best;
}

/**
 * Build the Anki field payload the same way sync does (without writing media).
 */
export async function buildComparablePayload(
	app: App,
	settings: DeckToAnkiSettings,
	card: CardNode,
): Promise<AnkiComparablePayload> {
	const filePath = card.sourceFilePath;
	if (!filePath) {
		throw new Error('卡片缺少 sourceFilePath');
	}
	const file = resolveSourceFile(app, filePath);
	if (!file) {
		throw new Error(`找不到源笔记：${filePath}`);
	}

	const noteContent = await app.vault.cachedRead(file);
	const meta = parseFrontmatter(noteContent);
	const modelName = resolveDeckTemplate(
		meta.deckTemplate,
		settings.deckTemplate,
	);
	const deckName = toAnkiDeckName(card.deckPath);

	const [front, back] = await Promise.all([
		renderFieldWithMedia(app, card.front, filePath),
		renderFieldWithMedia(app, card.back, filePath),
	]);

	let deckBacklinkHtml = '';
	if (settings.deckBacklinkEnabled) {
		const link = await buildDeckSegmentUris({
			app,
			card,
			scheme: settings.backlinkScheme,
			uidProperty: settings.advUriUidProperty || 'uid',
			noteContent,
		});
		deckBacklinkHtml = buildDeckBacklinkHtml(link.segments);
	}

	const tags = settings.deckTagsEnabled
		? toAnkiTags(card.tags ?? [])
		: [];
	const tagsHtml =
		tags.length > 0
			? tags.map((tag) => `#${tag}`).join(' · ')
			: '';

	return {
		deckName,
		modelName,
		fields: {
			[FIELD_FRONT]: front.html,
			[FIELD_BACK]: back.html,
			[FIELD_BACKLINK]: deckBacklinkHtml,
			[FIELD_TAGS]: tagsHtml,
		},
		tags,
	};
}

function payloadsMatch(
	local: AnkiComparablePayload,
	anki: {
		fields: Record<string, string>;
		tags: string[];
		modelName: string;
		inExpectedDeck: boolean;
	},
): boolean {
	if (!anki.inExpectedDeck) {
		return false;
	}
	if (anki.modelName && anki.modelName !== local.modelName) {
		return false;
	}
	if (!tagsEqual(local.tags, anki.tags)) {
		return false;
	}
	const keys = [FIELD_FRONT, FIELD_BACK, FIELD_BACKLINK, FIELD_TAGS] as const;
	for (const key of keys) {
		if (
			normalizeFieldHtml(local.fields[key] ?? '') !==
			normalizeFieldHtml(anki.fields[key] ?? '')
		) {
			return false;
		}
	}
	return true;
}

function clearDeletedChildren(node: DeckNode): void {
	node.children = node.children.filter(
		(child) => child.kind !== 'deleted-anki',
	) as SyncTreeChild[];
	for (const child of node.children) {
		if (child.kind === 'deck') {
			clearDeletedChildren(child);
		}
	}
}

function recountLocalCards(node: DeckNode): number {
	let count = 0;
	for (const child of node.children) {
		if (child.kind === 'card' || child.kind === 'deleted-anki') {
			count += 1;
		} else {
			count += recountLocalCards(child);
		}
	}
	node.cardCount = count;
	return count;
}

/**
 * Prefetch Anki note state, stamp `syncStatus` on local cards, and attach
 * deleted-only phantom rows under matching decks.
 */
export async function prefetchSyncStatus(
	app: App,
	settings: DeckToAnkiSettings,
	root: DeckNode,
): Promise<SyncStatusPrefetchResult> {
	clearDeletedChildren(root);
	const localCards = collectLocalCards(root);

	const client = new AnkiConnectClient(
		() => settings.ankiConnectUrl || 'http://127.0.0.1:8765',
	);

	try {
		await client.ping();
	} catch (error) {
		for (const card of localCards) {
			card.syncStatus = 'unsynced';
		}
		recountLocalCards(root);
		const msg = error instanceof Error ? error.message : String(error);
		return {
			ankiOnline: false,
			warning: `Anki 未连接，状态未完整检测：${msg}`,
			deletedCount: 0,
		};
	}

	const localIds = new Set<number>();
	for (const card of localCards) {
		if (card.noteId !== undefined) {
			localIds.add(card.noteId);
		}
	}

	const noteIds = [...localIds];
	const ankiById = new Map<
		number,
		{
			fields: Record<string, string>;
			tags: string[];
			modelName: string;
		}
	>();

	const CHUNK = 50;
	for (let i = 0; i < noteIds.length; i += CHUNK) {
		const chunk = noteIds.slice(i, i + CHUNK);
		const infos = await client.notesInfo(chunk);
		for (const info of infos) {
			ankiById.set(info.noteId, {
				fields: info.fields,
				tags: info.tags,
				modelName: info.modelName,
			});
		}
	}

	const deckPaths = new Set<string>();
	collectDeckPaths(root, deckPaths);
	// Prefer deepest deck path when attributing orphan notes.
	const sortedDeckPaths = [...deckPaths].sort(
		(a, b) => b.split('::').length - a.split('::').length,
	);

	const ankiIdsInView = new Set<number>();
	const noteDeckHint = new Map<number, string>();

	for (const deckPath of sortedDeckPaths) {
		for (const model of DECK_TEMPLATE_IDS) {
			const query = `deck:"${escapeAnkiQueryValue(deckPath)}" note:"${escapeAnkiQueryValue(model)}"`;
			const ids = await client.findNotes(query);
			for (const id of ids) {
				ankiIdsInView.add(id);
				if (!noteDeckHint.has(id)) {
					noteDeckHint.set(id, deckPath);
				}
			}
		}
	}

	for (const card of localCards) {
		if (card.noteId === undefined) {
			card.syncStatus = 'unsynced';
			continue;
		}
		const remote = ankiById.get(card.noteId);
		if (!remote) {
			card.syncStatus = 'unsynced';
			continue;
		}

		try {
			const local = await buildComparablePayload(app, settings, card);
			const inExpectedDeck =
				(
					await client.findNotes(
						`nid:${card.noteId} deck:"${escapeAnkiQueryValue(local.deckName)}"`,
					)
				).length > 0;
			card.syncStatus = payloadsMatch(local, {
				...remote,
				inExpectedDeck,
			})
				? 'synced'
				: 'modified';
		} catch {
			card.syncStatus = 'modified';
		}
	}

	const orphanIds = [...ankiIdsInView].filter((id) => !localIds.has(id));
	let deletedCount = 0;

	if (orphanIds.length > 0) {
		const orphanInfos: Array<{
			noteId: number;
			fields: Record<string, string>;
		}> = [];
		for (let i = 0; i < orphanIds.length; i += CHUNK) {
			const chunk = orphanIds.slice(i, i + CHUNK);
			const infos = await client.notesInfo(chunk);
			for (const info of infos) {
				orphanInfos.push({
					noteId: info.noteId,
					fields: info.fields,
				});
			}
		}

		for (const info of orphanInfos) {
			const deckPath = noteDeckHint.get(info.noteId) ?? root.deckPath;
			const frontRaw =
				info.fields[FIELD_FRONT] ??
				info.fields.Front ??
				`Anki #${info.noteId}`;
			const title =
				stripHtmlToText(frontRaw).slice(0, 80) ||
				`Anki #${info.noteId}`;
			const phantom: DeletedAnkiCardNode = {
				kind: 'deleted-anki',
				id: `deleted:${info.noteId}`,
				noteId: info.noteId,
				front: title,
				deckPath,
				syncStatus: 'deleted',
			};
			const parent = findClosestDeck(root, deckPath);
			parent.children.push(phantom);
			deletedCount += 1;
		}
	}

	recountLocalCards(root);
	return { ankiOnline: true, deletedCount };
}

export function countSyncStatusInDeck(deck: DeckNode): Record<
	SyncCardStatus,
	number
> {
	const counts: Record<SyncCardStatus, number> = {
		synced: 0,
		modified: 0,
		unsynced: 0,
		deleted: 0,
	};
	const walk = (node: DeckNode) => {
		for (const child of node.children) {
			if (child.kind === 'card') {
				const status = child.syncStatus ?? 'unsynced';
				counts[status] += 1;
			} else if (child.kind === 'deleted-anki') {
				counts.deleted += 1;
			} else {
				walk(child);
			}
		}
	};
	walk(deck);
	return counts;
}

export function shouldSelectByStatus(
	status: SyncCardStatus | undefined,
): boolean {
	return status !== 'synced';
}
