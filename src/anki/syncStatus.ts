import type { App } from 'obsidian';
import type { DeckToAnkiSettings } from '../settings';
import type {
	CardNode,
	DeletedAnkiCardNode,
	DeckNode,
	SyncCardStatus,
	SyncTreeChild,
} from '../domain/head/types';
import { AnkiConnectClient } from './AnkiConnectClient';
import {
	toAnkiDeckName,
	toAnkiDeckNameForCard,
	toAnkiDeckNameForDeck,
} from './backlink';
import { buildAnkiNoteFieldPayload } from './buildAnkiFields';
import type { MediaCompressCache } from './mediaCompressCache';
import {
	allDeckTemplateIdsOrdered,
	FIELD_BACK,
	FIELD_BACKLINK,
	FIELD_FRONT,
	FIELD_HEAD,
	FIELD_TAGS,
	FIELD_TREE,
	type DeckTemplateId,
} from './templates';
import { assignSiblingIndexes } from '../domain/head/siblingIndex';

function deckNumberingFromSettings(settings: DeckToAnkiSettings): boolean {
	return settings.deckNumberingEnabled !== false;
}

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

/** Progress callback for status check UI (panel bar / notice). */
export interface SyncStatusProgress {
	current: number;
	total: number;
	label: string;
}

export type SyncStatusProgressHandler = (
	progress: SyncStatusProgress,
) => void | Promise<void>;

async function reportProgress(
	onProgress: SyncStatusProgressHandler | undefined,
	current: number,
	total: number,
	label: string,
): Promise<void> {
	if (!onProgress) {
		return;
	}
	await onProgress({
		current: Math.min(current, total),
		total: Math.max(total, 1),
		label,
	});
}

function escapeAnkiQueryValue(value: string): string {
	return value.replace(/"/g, '\\"');
}

/** Basename of an Anki/local media src; strips query/hash and path. */
function canonicalizeMediaSrc(src: string): string {
	let s = src.trim().split(/[?#]/, 1)[0] ?? '';
	s = s.replace(/\\/g, '/');
	const slash = s.lastIndexOf('/');
	if (slash >= 0) {
		s = s.slice(slash + 1);
	}
	try {
		s = decodeURIComponent(s);
	} catch {
		// keep raw
	}
	return s;
}

/**
 * Normalize field HTML for sync compare.
 * Image cards often differ only in Obsidian embed chrome / img attrs / void tags.
 */
function normalizeFieldHtml(html: string): string {
	const trimmed = html.replace(/\r\n/g, '\n').trim();
	if (!trimmed) {
		return '';
	}
	if (typeof document === 'undefined') {
		return trimmed.normalize('NFC');
	}

	const host = document.createElement('div');
	host.innerHTML = trimmed;

	host
		.querySelectorAll(
			'.image-resize-corner, button.edit-block-button, .edit-block-button, button.copy-code-button, .copy-code-button',
		)
		.forEach((el) => el.remove());

	for (const embed of Array.from(
		host.querySelectorAll(
			'.internal-embed, .media-embed, .image-embed, .image-wrapper',
		),
	)) {
		const img = embed.querySelector('img');
		if (!img) {
			continue;
		}
		const clean = document.createElement('img');
		clean.setAttribute(
			'src',
			canonicalizeMediaSrc(img.getAttribute('src') ?? ''),
		);
		const alt = img.getAttribute('alt');
		if (alt) {
			clean.setAttribute('alt', alt);
		}
		embed.replaceWith(clean);
	}

	for (const img of Array.from(host.querySelectorAll('img'))) {
		const src = canonicalizeMediaSrc(img.getAttribute('src') ?? '');
		const alt = img.getAttribute('alt') ?? '';
		const clean = document.createElement('img');
		clean.setAttribute('src', src);
		if (alt) {
			clean.setAttribute('alt', alt);
		}
		img.replaceWith(clean);
	}

	let out = host.innerHTML.replace(/\r\n/g, '\n').trim();
	// Anki may emit void tags / inter-tag whitespace differently.
	out = out.replace(/\s+\/?>/g, '>').replace(/>\s+</g, '><');
	return out.normalize('NFC');
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

function collectDeckPaths(
	node: DeckNode,
	into: Set<string>,
	deckNumbering: boolean,
): void {
	const numbered = toAnkiDeckNameForDeck(node, deckNumbering);
	if (numbered) {
		into.add(numbered);
	}
	// Also scan plain names so notes still in old (unnumbered) decks are found.
	if (deckNumbering) {
		const plain = toAnkiDeckName(node.deckPath);
		if (plain) {
			into.add(plain);
		}
	}
	for (const child of node.children) {
		if (child.kind === 'deck') {
			collectDeckPaths(child, into, deckNumbering);
		} else if (child.kind === 'card') {
			const cardDeck = toAnkiDeckNameForCard(child, deckNumbering);
			if (cardDeck) {
				into.add(cardDeck);
			}
			if (deckNumbering) {
				const plain = toAnkiDeckName(child.deckPath);
				if (plain) {
					into.add(plain);
				}
			}
		}
	}
}

function findDeckByPath(
	root: DeckNode,
	deckPath: string,
	deckNumbering: boolean,
): DeckNode | null {
	const target = toAnkiDeckName(deckPath);
	if (!target) {
		return null;
	}
	if (toAnkiDeckNameForDeck(root, deckNumbering) === target) {
		return root;
	}
	for (const child of root.children) {
		if (child.kind === 'deck') {
			const hit = findDeckByPath(child, target, deckNumbering);
			if (hit) {
				return hit;
			}
		}
	}
	return null;
}

/** Longest matching ancestor deck, or root. */
function findClosestDeck(
	root: DeckNode,
	deckPath: string,
	deckNumbering: boolean,
): DeckNode {
	const target = toAnkiDeckName(deckPath);
	const parts = target.split('::').filter(Boolean);
	let best: DeckNode = root;
	let prefix = '';
	for (const part of parts) {
		prefix = prefix ? `${prefix}::${part}` : part;
		const hit = findDeckByPath(root, prefix, deckNumbering);
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
	mediaCache?: MediaCompressCache | null,
): Promise<AnkiComparablePayload> {
	const payload = await buildAnkiNoteFieldPayload(app, settings, card, {
		mediaCache,
	});
	return {
		deckName: payload.deckName,
		modelName: payload.modelName,
		fields: payload.fields,
		tags: payload.tags,
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
	const keys = [
		FIELD_HEAD,
		FIELD_FRONT,
		FIELD_BACK,
		FIELD_TAGS,
		FIELD_BACKLINK,
		FIELD_TREE,
	] as const;
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

/** Remove deleted phantoms whose Anki deck was part of this scan. */
function clearDeletedInDeckPaths(
	node: DeckNode,
	scannedDecks: Set<string>,
): void {
	const targets = [...scannedDecks].map((p) => toAnkiDeckName(p));
	const matches = (deckPath: string): boolean => {
		const p = toAnkiDeckName(deckPath);
		return targets.some(
			(t) => p === t || p.startsWith(`${t}::`) || t.startsWith(`${p}::`),
		);
	};
	node.children = node.children.filter((child) => {
		if (child.kind === 'deleted-anki') {
			return !matches(child.deckPath);
		}
		return true;
	}) as SyncTreeChild[];
	for (const child of node.children) {
		if (child.kind === 'deck') {
			clearDeletedInDeckPaths(child, scannedDecks);
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

async function scanAnkiNotesInDecks(
	client: AnkiConnectClient,
	deckPaths: string[],
	modelNames: string[],
	onProgress?: SyncStatusProgressHandler,
	progress?: { offset: number; total: number },
): Promise<{
	ankiIds: Set<number>;
	noteDeckHint: Map<number, string>;
}> {
	const models =
		modelNames.length > 0 ? modelNames : allDeckTemplateIdsOrdered({});
	const sorted = [...deckPaths]
		.map((p) => toAnkiDeckName(p))
		.filter(Boolean)
		.sort((a, b) => b.split('::').length - a.split('::').length);

	const ankiIds = new Set<number>();
	const noteDeckHint = new Map<number, string>();
	const scanSteps = Math.max(1, sorted.length * models.length);
	let scanDone = 0;
	const offset = progress?.offset ?? 0;
	const total = progress?.total ?? scanSteps;

	for (const deckPath of sorted) {
		for (const model of models) {
			const query = `deck:"${escapeAnkiQueryValue(deckPath)}" note:"${escapeAnkiQueryValue(model)}"`;
			const ids = await client.findNotes(query);
			for (const id of ids) {
				ankiIds.add(id);
				if (!noteDeckHint.has(id)) {
					noteDeckHint.set(id, deckPath);
				}
			}
			scanDone += 1;
			await reportProgress(
				onProgress,
				offset + scanDone,
				total,
				`扫描牌组 ${scanDone}/${scanSteps}`,
			);
		}
	}
	return { ankiIds, noteDeckHint };
}

async function attachDeletedPhantoms(
	client: AnkiConnectClient,
	root: DeckNode,
	orphanIds: number[],
	noteDeckHint: Map<number, string>,
	onProgress?: SyncStatusProgressHandler,
	progress?: { offset: number; total: number; deckNumbering?: boolean },
): Promise<number> {
	if (orphanIds.length === 0) {
		return 0;
	}
	const deckNumbering = progress?.deckNumbering !== false;
	const CHUNK = 50;
	const orphanChunks = Math.max(1, Math.ceil(orphanIds.length / CHUNK));
	const offset = progress?.offset ?? 0;
	const total = progress?.total ?? offset + orphanChunks;
	const orphanInfos: Array<{
		noteId: number;
		fields: Record<string, string>;
	}> = [];
	let orphanChunk = 0;
	for (let i = 0; i < orphanIds.length; i += CHUNK) {
		const chunk = orphanIds.slice(i, i + CHUNK);
		const infos = await client.notesInfo(chunk);
		for (const info of infos) {
			orphanInfos.push({
				noteId: info.noteId,
				fields: info.fields,
			});
		}
		orphanChunk += 1;
		await reportProgress(
			onProgress,
			offset + orphanChunk,
			total,
			`检查仅 Anki 存在 ${orphanChunk}/${orphanChunks}`,
		);
	}

	let deletedCount = 0;
	for (const info of orphanInfos) {
		const deckPath = noteDeckHint.get(info.noteId) ?? root.deckPath;
		const frontRaw =
			info.fields[FIELD_HEAD] ||
			info.fields[FIELD_FRONT] ||
			info.fields.Front ||
			`Anki #${info.noteId}`;
		const title =
			stripHtmlToText(frontRaw).slice(0, 80) || `Anki #${info.noteId}`;
		const phantom: DeletedAnkiCardNode = {
			kind: 'deleted-anki',
			id: `deleted:${info.noteId}`,
			noteId: info.noteId,
			front: title,
			deckPath,
			syncStatus: 'deleted',
		};
		const parent = findClosestDeck(root, deckPath, deckNumbering);
		parent.children.push(phantom);
		deletedCount += 1;
	}
	return deletedCount;
}

function cardTitleHint(card: CardNode): string {
	const nav = (card.navTitle ?? '').trim();
	if (nav) {
		return nav;
	}
	const first = (card.front ?? '').split(/\r?\n/)[0] ?? '';
	return first.replace(/^#+\s*/, '').trim().slice(0, 80);
}

/** Stable keys for matching a card across re-parse / ID-marker writes. */
export function cardIdentityKeys(card: CardNode): string[] {
	const keys: string[] = [];
	if (card.noteId !== undefined) {
		keys.push(`nid:${card.noteId}`);
	}
	const path = card.sourceFilePath ?? '';
	const title = cardTitleHint(card);
	if (path && title) {
		keys.push(`title:${path}::${title}`);
	}
	if (path) {
		keys.push(`line:${path}::${card.lineStart}`);
	}
	keys.push(`id:${card.id}`);
	return keys;
}

export function deletedIdentityKey(node: DeletedAnkiCardNode): string {
	return `nid:${node.noteId}`;
}

export interface SyncStatusTreeSnapshot {
	/** Each local card: identity keys → last known status. */
	cards: Array<{ keys: string[]; status: SyncCardStatus }>;
	deleted: DeletedAnkiCardNode[];
	/** Identity keys of selected leaves (cards + deleted phantoms). */
	selectedKeys: string[];
}

function collectDeletedPhantoms(root: DeckNode): DeletedAnkiCardNode[] {
	const out: DeletedAnkiCardNode[] = [];
	const walk = (node: DeckNode) => {
		for (const child of node.children) {
			if (child.kind === 'deleted-anki') {
				out.push({ ...child });
			} else if (child.kind === 'deck') {
				walk(child);
			}
		}
	};
	walk(root);
	return out;
}

/** Capture status colors / deleted rows / selection before tree reload. */
export function snapshotSyncStatusTree(
	root: DeckNode,
	isSelected: (id: string) => boolean,
): SyncStatusTreeSnapshot {
	const cards: SyncStatusTreeSnapshot['cards'] = [];
	const selectedKeys: string[] = [];

	for (const card of collectLocalCards(root)) {
		if (card.syncStatus) {
			cards.push({
				keys: cardIdentityKeys(card),
				status: card.syncStatus,
			});
		}
		if (isSelected(card.id)) {
			selectedKeys.push(...cardIdentityKeys(card));
		}
	}

	const deleted = collectDeletedPhantoms(root);
	for (const phantom of deleted) {
		if (isSelected(phantom.id)) {
			selectedKeys.push(deletedIdentityKey(phantom));
		}
	}

	return { cards, deleted, selectedKeys };
}

function lookupStatus(
	keys: string[],
	byKey: Map<string, SyncCardStatus>,
): SyncCardStatus | undefined {
	for (const key of keys) {
		const hit = byKey.get(key);
		if (hit) {
			return hit;
		}
	}
	return undefined;
}

/** Re-apply prior check results onto a freshly parsed tree. */
export function restoreSyncStatusTree(
	root: DeckNode,
	snapshot: SyncStatusTreeSnapshot,
	options?: { removedDeletedNoteIds?: number[]; deckNumbering?: boolean },
): void {
	clearDeletedChildren(root);
	const deckNumbering = options?.deckNumbering !== false;

	const byKey = new Map<string, SyncCardStatus>();
	for (const entry of snapshot.cards) {
		for (const key of entry.keys) {
			byKey.set(key, entry.status);
		}
	}

	for (const card of collectLocalCards(root)) {
		const status = lookupStatus(cardIdentityKeys(card), byKey);
		if (status && status !== 'deleted') {
			card.syncStatus = status;
		}
	}

	const removed = new Set(options?.removedDeletedNoteIds ?? []);
	const localIds = new Set<number>();
	for (const card of collectLocalCards(root)) {
		if (card.noteId !== undefined) {
			localIds.add(card.noteId);
		}
	}

	for (const phantom of snapshot.deleted) {
		if (removed.has(phantom.noteId) || localIds.has(phantom.noteId)) {
			continue;
		}
		const parent = findClosestDeck(root, phantom.deckPath, deckNumbering);
		parent.children.push({
			...phantom,
			id: `deleted:${phantom.noteId}`,
			syncStatus: 'deleted',
		});
	}

	recountLocalCards(root);
	assignSiblingIndexes(root);
}

export function findCardsByIdentityKeys(
	root: DeckNode,
	keys: Iterable<string>,
): CardNode[] {
	const want = new Set(keys);
	if (want.size === 0) {
		return [];
	}
	const out: CardNode[] = [];
	const seen = new Set<string>();
	for (const card of collectLocalCards(root)) {
		if (seen.has(card.id)) {
			continue;
		}
		if (cardIdentityKeys(card).some((k) => want.has(k))) {
			out.push(card);
			seen.add(card.id);
		}
	}
	return out;
}

type AnkiNoteCache = Map<
	number,
	{
		fields: Record<string, string>;
		tags: string[];
		modelName: string;
	}
>;

async function stampCardStatuses(
	app: App,
	settings: DeckToAnkiSettings,
	client: AnkiConnectClient,
	cards: CardNode[],
	ankiById: AnkiNoteCache,
	options?: {
		onProgress?: SyncStatusProgressHandler;
		/** Base offset into overall progress. */
		progressOffset?: number;
		progressTotal?: number;
		progressLabel?: (done: number, cardTotal: number) => string;
		mediaCache?: MediaCompressCache | null;
	},
): Promise<void> {
	const offset = options?.progressOffset ?? 0;
	const total = options?.progressTotal ?? cards.length;
	const labelFn =
		options?.progressLabel ??
		((done, cardTotal) => `比对卡片 ${done}/${cardTotal}`);

	for (let i = 0; i < cards.length; i++) {
		const card = cards[i]!;
		if (card.noteId === undefined) {
			card.syncStatus = 'unsynced';
		} else {
			const remote = ankiById.get(card.noteId);
			if (!remote) {
				card.syncStatus = 'unsynced';
			} else {
				try {
					const local = await buildComparablePayload(
						app,
						settings,
						card,
						options?.mediaCache,
					);
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
		}

		await reportProgress(
			options?.onProgress,
			offset + i + 1,
			total,
			labelFn(i + 1, cards.length),
		);
	}
}

async function loadAnkiNotesById(
	client: AnkiConnectClient,
	noteIds: number[],
	options?: {
		onProgress?: SyncStatusProgressHandler;
		progressOffset?: number;
		progressTotal?: number;
	},
): Promise<AnkiNoteCache> {
	const ankiById: AnkiNoteCache = new Map();
	const CHUNK = 50;
	const offset = options?.progressOffset ?? 0;
	const total = options?.progressTotal ?? Math.max(1, Math.ceil(noteIds.length / CHUNK));
	let chunkIndex = 0;
	const chunkCount = Math.max(1, Math.ceil(noteIds.length / CHUNK) || 1);

	if (noteIds.length === 0) {
		await reportProgress(
			options?.onProgress,
			offset + 1,
			total,
			'拉取 Anki 笔记…',
		);
		return ankiById;
	}

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
		chunkIndex += 1;
		await reportProgress(
			options?.onProgress,
			offset + chunkIndex,
			total,
			`拉取 Anki 笔记 ${chunkIndex}/${chunkCount}`,
		);
	}
	return ankiById;
}

/**
 * Re-check the given cards against Anki.
 * When `root` is provided, also scan those cards' Anki decks for notes that
 * no longer exist locally (deleted phantoms).
 */
export async function prefetchSyncStatusForCards(
	app: App,
	settings: DeckToAnkiSettings,
	cards: CardNode[],
	onProgress?: SyncStatusProgressHandler,
	options?: { root?: DeckNode; mediaCache?: MediaCompressCache | null },
): Promise<SyncStatusPrefetchResult> {
	if (cards.length === 0) {
		return { ankiOnline: true, deletedCount: 0 };
	}

	const client = new AnkiConnectClient(
		() => settings.ankiConnectUrl || 'http://127.0.0.1:8765',
	);
	const root = options?.root;

	const deckNumbering = deckNumberingFromSettings(settings);
	const deckPaths = [
		...new Set(
			cards
				.flatMap((c) => {
					const numbered = toAnkiDeckNameForCard(c, deckNumbering);
					if (!deckNumbering) {
						return numbered ? [numbered] : [];
					}
					const plain = toAnkiDeckName(c.deckPath);
					return [numbered, plain].filter((p) => p.length > 0);
				}),
		),
	];
	const modelNames = allDeckTemplateIdsOrdered(settings);
	const scanSteps = root
		? Math.max(1, deckPaths.length * modelNames.length)
		: 0;
	const fetchSteps = Math.max(
		1,
		Math.ceil(cards.filter((c) => c.noteId !== undefined).length / 50),
	);
	let total = 1 + fetchSteps + cards.length + scanSteps + 1;
	let step = 0;

	await reportProgress(onProgress, ++step, total, '连接 Anki…');

	try {
		await client.ping();
	} catch (error) {
		for (const card of cards) {
			card.syncStatus = 'unsynced';
		}
		const msg = error instanceof Error ? error.message : String(error);
		return {
			ankiOnline: false,
			warning: `Anki 未连接，增量状态未更新：${msg}`,
			deletedCount: 0,
		};
	}

	const noteIds = [
		...new Set(
			cards
				.map((c) => c.noteId)
				.filter((id): id is number => id !== undefined),
		),
	];
	const ankiById = await loadAnkiNotesById(client, noteIds, {
		onProgress,
		progressOffset: step,
		progressTotal: total,
	});
	step += fetchSteps;

	await stampCardStatuses(app, settings, client, cards, ankiById, {
		onProgress,
		progressOffset: step,
		progressTotal: total,
		mediaCache: options?.mediaCache,
	});
	step += cards.length;

	let deletedCount = 0;
	if (root && deckPaths.length > 0) {
		clearDeletedInDeckPaths(root, new Set(deckPaths));
		const { ankiIds, noteDeckHint } = await scanAnkiNotesInDecks(
			client,
			deckPaths,
			modelNames,
			onProgress,
			{ offset: step, total },
		);
		step += scanSteps;

		const localIds = new Set<number>();
		for (const card of collectLocalCards(root)) {
			if (card.noteId !== undefined) {
				localIds.add(card.noteId);
			}
		}
		const orphanIds = [...ankiIds].filter((id) => !localIds.has(id));
		const orphanChunks = Math.max(1, Math.ceil(orphanIds.length / 50) || 1);
		total = step + orphanChunks;
		deletedCount = await attachDeletedPhantoms(
			client,
			root,
			orphanIds,
			noteDeckHint,
			onProgress,
			{
				offset: step,
				total,
				deckNumbering: deckNumberingFromSettings(settings),
			},
		);
		recountLocalCards(root);
		assignSiblingIndexes(root);
	}

	await reportProgress(onProgress, total, total, '检测完成');
	return { ankiOnline: true, deletedCount };
}

/**
 * Prefetch Anki note state, stamp `syncStatus` on local cards, and attach
 * deleted-only phantom rows under matching decks.
 */
export async function prefetchSyncStatus(
	app: App,
	settings: DeckToAnkiSettings,
	root: DeckNode,
	onProgress?: SyncStatusProgressHandler,
	options?: { mediaCache?: MediaCompressCache | null },
): Promise<SyncStatusPrefetchResult> {
	clearDeletedChildren(root);
	const localCards = collectLocalCards(root);

	const client = new AnkiConnectClient(
		() => settings.ankiConnectUrl || 'http://127.0.0.1:8765',
	);

	const localIds = new Set<number>();
	for (const card of localCards) {
		if (card.noteId !== undefined) {
			localIds.add(card.noteId);
		}
	}

	const deckPaths = new Set<string>();
	collectDeckPaths(root, deckPaths, deckNumberingFromSettings(settings));
	const sortedDeckPaths = [...deckPaths].sort(
		(a, b) => b.split('::').length - a.split('::').length,
	);
	const modelNames = allDeckTemplateIdsOrdered(settings);
	const scanSteps = sortedDeckPaths.length * modelNames.length;
	const fetchSteps = Math.max(1, Math.ceil(localIds.size / 50) || 1);
	// Orphan fetch unknown yet; reserve a soft tail of 1 then expand.
	let total = 1 + fetchSteps + scanSteps + localCards.length + 1;
	let step = 0;

	await reportProgress(onProgress, ++step, total, '连接 Anki…');

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

	const ankiById = await loadAnkiNotesById(client, [...localIds], {
		onProgress,
		progressOffset: step,
		progressTotal: total,
	});
	step += fetchSteps;

	const { ankiIds: ankiIdsInView, noteDeckHint } = await scanAnkiNotesInDecks(
		client,
		sortedDeckPaths,
		modelNames,
		onProgress,
		{ offset: step, total },
	);
	step += scanSteps;

	await stampCardStatuses(app, settings, client, localCards, ankiById, {
		onProgress,
		progressOffset: step,
		progressTotal: total,
		mediaCache: options?.mediaCache,
	});
	step += localCards.length;

	const orphanIds = [...ankiIdsInView].filter((id) => !localIds.has(id));
	const orphanChunks = Math.max(1, Math.ceil(orphanIds.length / 50) || 1);
	total = step + orphanChunks;

	const deletedCount = await attachDeletedPhantoms(
		client,
		root,
		orphanIds,
		noteDeckHint,
		onProgress,
		{
			offset: step,
			total,
			deckNumbering: deckNumberingFromSettings(settings),
		},
	);
	if (orphanIds.length === 0) {
		await reportProgress(onProgress, total, total, '整理结果…');
	}

	recountLocalCards(root);
	assignSiblingIndexes(root);
	await reportProgress(onProgress, total, total, '检测完成');
	return { ankiOnline: true, deletedCount };
}

export function countSyncStatusInDeck(deck: DeckNode): Record<
	SyncCardStatus | 'pending',
	number
> {
	const counts: Record<SyncCardStatus | 'pending', number> = {
		synced: 0,
		modified: 0,
		unsynced: 0,
		deleted: 0,
		pending: 0,
	};
	const walk = (node: DeckNode) => {
		for (const child of node.children) {
			if (child.kind === 'card') {
				if (child.syncStatus === undefined) {
					counts.pending += 1;
				} else {
					counts[child.syncStatus] += 1;
				}
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
	// Synced (green) cards stay selectable; Update skips them at sync time.
	void status;
	return true;
}

/** Update 节能：已同步卡片跳过；Force 不跳过。 */
export function shouldSkipOnUpdate(
	status: SyncCardStatus | undefined,
): boolean {
	return status === 'synced';
}
