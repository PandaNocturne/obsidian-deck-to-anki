import type { App } from 'obsidian';
import type { DeckToAnkiSettings } from '../settings';
import { parseFrontmatter } from '../domain/head/frontmatter';
import type { CardNode, DeckNode } from '../domain/head/types';
import { AnkiConnectClient } from './AnkiConnectClient';
import { resolveSourceFile } from './backlink';
import { buildAnkiNoteFieldPayload } from './buildAnkiFields';
import { cleanupEmptyAnkiDecks } from './cleanupEmptyDecks';
import { ensureDeckTemplateModel } from './ensureModel';
import type { MediaCompressCache } from './mediaCompressCache';
import {
	allDeckTemplateIdsOrdered,
	defaultStyleFor,
	FIELD_FRONT,
	type DeckTemplateId,
} from './templates';
import {
	writeCardIdMarker,
	writePendingIdMarkers,
	type PendingIdMarkerWrite,
} from './writeIdMarker';

export interface SyncCardResult {
	noteId: number;
	created: boolean;
	deckName: string;
	modelName: string;
	warning?: string;
	stylePushed?: boolean;
	/** When set, caller should batch-write this ID marker after sync. */
	pendingIdWrite?: PendingIdMarkerWrite;
}

export interface SyncPersistOptions {
	/** Persist settings after Anki template styles are pushed. */
	persistSettings?: () => Promise<void>;
	forceModelUpdate?: boolean;
	/** Shared compress cache for stable Anki media names. */
	mediaCache?: MediaCompressCache;
	/**
	 * Defer `<!--ID-->` vault writes; return `pendingIdWrite` instead.
	 * Batch callers write once after all Anki uploads finish.
	 */
	deferIdWrite?: boolean;
}

export function collectCardsFromNode(
	node: DeckNode | CardNode,
): CardNode[] {
	if (node.kind === 'card') {
		return [node];
	}
	const out: CardNode[] = [];
	for (const child of node.children) {
		if (child.kind === 'card') {
			out.push(child);
		} else if (child.kind === 'deck') {
			out.push(...collectCardsFromNode(child));
		}
	}
	return out;
}

function createClient(settings: DeckToAnkiSettings): AnkiConnectClient {
	return new AnkiConnectClient(
		() => settings.ankiConnectUrl || 'http://127.0.0.1:8765',
	);
}

function resolveDeckTemplate(
	yamlValue: string | undefined,
	settings: DeckToAnkiSettings,
): DeckTemplateId {
	const known = allDeckTemplateIdsOrdered(settings);
	if (yamlValue && known.includes(yamlValue)) {
		return yamlValue;
	}
	if (known.includes(settings.deckTemplate)) {
		return settings.deckTemplate;
	}
	return 'ob-deck-basic';
}

function escapeAnkiQueryValue(value: string): string {
	return value.replace(/"/g, '\\"');
}

async function syncNoteTags(
	client: AnkiConnectClient,
	noteId: number,
	desired: string[],
	enabled: boolean,
): Promise<void> {
	if (!enabled) {
		return;
	}
	const info = await client.notesInfo([noteId]);
	const note = info[0];
	if (!note) {
		return;
	}
	const existing = note.tags ?? [];
	const toRemove = existing.filter((t) => !desired.includes(t));
	const toAdd = desired.filter((t) => !existing.includes(t));
	await client.removeTags([noteId], toRemove);
	await client.addTags([noteId], toAdd);
}

/**
 * Update existing note fields/deck/tags, or create when missing.
 * If addNote hits a duplicate, locate the existing note and overwrite it.
 */
async function upsertAnkiNote(
	client: AnkiConnectClient,
	input: {
		noteId?: number;
		deckName: string;
		modelName: string;
		fields: Record<string, string>;
		tags: string[];
		deckTagsEnabled: boolean;
	},
): Promise<{ noteId: number; created: boolean }> {
	const { deckName, modelName, tags, deckTagsEnabled } = input;

	const modelFields = await client.modelFieldNames(modelName);
	const allowed = new Set(modelFields);
	const fields: Record<string, string> = {};
	for (const [key, value] of Object.entries(input.fields)) {
		if (allowed.has(key)) {
			fields[key] = value;
		}
	}
	if (!(FIELD_FRONT in fields)) {
		throw new Error(
			`笔记类型「${modelName}」缺少字段 ${FIELD_FRONT}。请打开插件设置点击「强制更新」，或确认 AnkiConnect 可用后重试同步。`,
		);
	}

	const applyUpdate = async (noteId: number): Promise<void> => {
		await client.updateNoteFields(noteId, fields);
		const info = await client.notesInfo([noteId]);
		const note = info[0];
		if (note?.cards?.length) {
			await client.changeDeck(note.cards, deckName);
		}
		await syncNoteTags(client, noteId, tags, deckTagsEnabled);
	};

	const findAndOverwriteDuplicate = async (): Promise<number | null> => {
		const query = `deck:"${escapeAnkiQueryValue(deckName)}" note:"${escapeAnkiQueryValue(modelName)}"`;
		const candidates = await client.findNotes(query);
		if (candidates.length === 0) {
			return null;
		}
		const details = await client.notesInfo(candidates);
		const front = fields[FIELD_FRONT] ?? '';
		const match =
			details.find((note) => (note.fields[FIELD_FRONT] ?? '') === front) ??
			details.find((note) => (note.fields.Front ?? '') === front) ??
			details[0];
		if (!match) {
			return null;
		}
		await applyUpdate(match.noteId);
		return match.noteId;
	};

	if (input.noteId !== undefined) {
		const existing = await client.notesInfo([input.noteId]);
		if (existing.length > 0) {
			await applyUpdate(input.noteId);
			return { noteId: input.noteId, created: false };
		}
		// Stale <!--ID--> — recreate below.
	}

	let createdId: number | null = null;
	try {
		createdId = await client.addNote({
			deckName,
			modelName,
			fields,
			tags,
			allowDuplicate: false,
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		const looksDuplicate = /duplicate|重复/i.test(msg);
		if (!looksDuplicate) {
			throw new Error(`Anki addNote 失败：${msg}`);
		}
	}

	if (createdId != null) {
		return { noteId: createdId, created: true };
	}

	const overwritten = await findAndOverwriteDuplicate();
	if (overwritten != null) {
		return { noteId: overwritten, created: false };
	}

	throw new Error(
		'addNote 失败（可能内容重复），且未能定位已有笔记以覆盖。可在 Anki 中删除重复笔记后重试。',
	);
}

/**
 * Push Front/Back/CSS for all built-in note types when local style version
 * is ahead of what Anki last received (or when forced).
 */
export async function pushDeckTemplateStylesIfNeeded(
	client: AnkiConnectClient,
	settings: DeckToAnkiSettings,
	options?: SyncPersistOptions,
): Promise<boolean> {
	const localVersion = settings.deckTemplateStyleVersion ?? 0;
	const syncedVersion = settings.ankiTemplateSyncedVersion ?? 0;
	const force =
		options?.forceModelUpdate === true || syncedVersion < localVersion;
	if (!force) {
		return false;
	}

	for (const id of allDeckTemplateIdsOrdered(settings)) {
		const style = settings.deckTemplateStyles[id];
		if (!style) {
			continue;
		}
		await ensureDeckTemplateModel(client, id, style, true);
	}

	settings.ankiTemplateSyncedVersion = localVersion;
	await options?.persistSettings?.();
	return true;
}

/**
 * Ensure note type exists (create-only unless force), then add/update one card.
 * Model comes from note YAML `deckTemplate`, else plugin default.
 */
export async function syncCardToAnki(
	app: App,
	settings: DeckToAnkiSettings,
	card: CardNode,
	options?: SyncPersistOptions & { skipStylePush?: boolean },
): Promise<SyncCardResult> {
	const client = createClient(settings);

	const filePath = card.sourceFilePath;
	if (!filePath) {
		throw new Error('卡片缺少 sourceFilePath，无法同步');
	}
	const file = resolveSourceFile(app, filePath);
	if (!file) {
		throw new Error(`找不到源笔记：${filePath}`);
	}

	const noteContent = await app.vault.read(file);
	const meta = parseFrontmatter(noteContent);
	const templateId = resolveDeckTemplate(meta.deckTemplate, settings);
	const style =
		settings.deckTemplateStyles[templateId] ??
		defaultStyleFor(templateId);

	let stylePushed = false;
	if (!options?.skipStylePush) {
		stylePushed = await pushDeckTemplateStylesIfNeeded(
			client,
			settings,
			options,
		);
	}

	// Existing models must gain the new field names before any note sync.
	await ensureDeckTemplateModel(client, templateId, style, false);

	const payload = await buildAnkiNoteFieldPayload(app, settings, card, {
		mediaCache: options?.mediaCache,
		freshNoteContent: true,
	});
	const deckName = payload.deckName;
	if (!deckName) {
		throw new Error('牌组路径为空，无法同步');
	}
	await client.createDeck(deckName);

	if (payload.assets.length > 0) {
		await client.storeMediaFiles(payload.assets);
		// Persist compress→filename mapping so the next status check matches.
		await options?.mediaCache?.saveNow();
	}

	const upserted = await upsertAnkiNote(client, {
		noteId: card.noteId,
		deckName,
		modelName: templateId,
		fields: payload.fields,
		tags: payload.tags,
		deckTagsEnabled: settings.deckTagsEnabled,
	});

	// Card mode stores id in YAML `deckID`; head/list use `<!--ID-->` markers.
	const needsIdWrite =
		upserted.created ||
		card.noteId !== upserted.noteId ||
		(card.deckClass === 'card'
			? card.noteId === undefined
			: !card.idMarker);

	let pendingIdWrite: PendingIdMarkerWrite | undefined;
	if (needsIdWrite) {
		if (options?.deferIdWrite) {
			pendingIdWrite = { card, noteId: upserted.noteId };
		} else {
			await writeCardIdMarker(app, file, card, upserted.noteId);
		}
	}

	return {
		noteId: upserted.noteId,
		created: upserted.created,
		deckName,
		modelName: templateId,
		warning: payload.warning,
		stylePushed,
		pendingIdWrite,
	};
}

export async function syncNodesToAnki(
	app: App,
	settings: DeckToAnkiSettings,
	node: DeckNode | CardNode,
	options?: SyncPersistOptions,
): Promise<{
	ok: number;
	fail: number;
	warnings: string[];
	emptyDecksDeleted: number;
	stylePushed: boolean;
}> {
	return syncCardListToAnki(
		app,
		settings,
		collectCardsFromNode(node),
		options,
	);
}

export async function syncCardListToAnki(
	app: App,
	settings: DeckToAnkiSettings,
	cardsInput: CardNode[],
	options?: SyncPersistOptions,
): Promise<{
	ok: number;
	fail: number;
	warnings: string[];
	emptyDecksDeleted: number;
	stylePushed: boolean;
}> {
	const client = createClient(settings);
	let stylePushed = false;
	try {
		stylePushed = await pushDeckTemplateStylesIfNeeded(
			client,
			settings,
			options,
		);
		if (stylePushed) {
			// continue
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		return {
			ok: 0,
			fail: cardsInput.length,
			warnings: [`推送卡片样式到 Anki 失败：${msg}`],
			emptyDecksDeleted: 0,
			stylePushed: false,
		};
	}

	const cards = [...cardsInput];
	// Group by file for stable processing; ID markers are written once at the end.
	cards.sort((a, b) =>
		(a.sourceFilePath ?? '').localeCompare(b.sourceFilePath ?? ''),
	);

	let ok = 0;
	let fail = 0;
	const warnings: string[] = [];
	const pendingIdWrites: PendingIdMarkerWrite[] = [];
	if (stylePushed) {
		warnings.push('已将新卡片样式推送到 Anki（请重新打开预览查看）');
	}

	for (const card of cards) {
		try {
			const result = await syncCardToAnki(app, settings, card, {
				...options,
				skipStylePush: true,
				deferIdWrite: true,
			});
			ok += 1;
			if (result.pendingIdWrite) {
				pendingIdWrites.push(result.pendingIdWrite);
			}
			if (result.warning) {
				warnings.push(result.warning);
			}
		} catch (error) {
			fail += 1;
			const msg = error instanceof Error ? error.message : String(error);
			warnings.push(`「${card.front.slice(0, 24)}」: ${msg}`);
		}
	}

	try {
		await writePendingIdMarkers(app, pendingIdWrites);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		warnings.push(`写入 ID 标记失败：${msg}`);
	}

	let emptyDecksDeleted = 0;
	try {
		const cleaned = await cleanupEmptyAnkiDecks(client);
		emptyDecksDeleted = cleaned.deleted.length;
		if (emptyDecksDeleted > 0) {
			warnings.push(`已清理 ${emptyDecksDeleted} 个空牌组`);
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		warnings.push(`清理空牌组失败：${msg}`);
	}

	return { ok, fail, warnings, emptyDecksDeleted, stylePushed };
}

export async function forceUpdateDeckTemplate(
	settings: DeckToAnkiSettings,
	persistSettings?: () => Promise<void>,
): Promise<'created' | 'updated' | 'exists'> {
	const client = createClient(settings);
	let last: 'created' | 'updated' | 'exists' = 'exists';
	for (const id of allDeckTemplateIdsOrdered(settings)) {
		const style = settings.deckTemplateStyles[id];
		if (!style) {
			continue;
		}
		last = await ensureDeckTemplateModel(client, id, style, true);
	}
	settings.ankiTemplateSyncedVersion =
		settings.deckTemplateStyleVersion ?? 0;
	await persistSettings?.();
	return last;
}

/** Push Front/Back/CSS for a single note type to Anki. */
export async function forceUpdateOneDeckTemplate(
	settings: DeckToAnkiSettings,
	templateId: DeckTemplateId,
	persistSettings?: () => Promise<void>,
): Promise<'created' | 'updated' | 'exists'> {
	const client = createClient(settings);
	const style =
		settings.deckTemplateStyles[templateId] ??
		defaultStyleFor(templateId);
	const result = await ensureDeckTemplateModel(
		client,
		templateId,
		style,
		true,
	);
	await persistSettings?.();
	return result;
}
