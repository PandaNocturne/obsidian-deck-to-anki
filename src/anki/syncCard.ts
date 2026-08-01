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
	FIELD_BACK,
	FIELD_FRONT,
	FIELD_HEAD,
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

function escapeHtmlText(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function fieldHasContent(value: string | undefined): boolean {
	return (value ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim()
		.length > 0;
}

/** Field names referenced in Anki card template HTML (`{{Field}}`, `{{#Field}}`, …). */
function fieldNamesInTemplateHtml(html: string): string[] {
	const names = new Set<string>();
	const re = /\{\{[/#^]?([^}:]+)(?::[^}]*)?\}\}/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(html)) !== null) {
		const name = (match[1] ?? '').trim();
		if (name && name !== 'FrontSide') {
			names.add(name);
		}
	}
	return [...names];
}

/**
 * Make sure addNote won't hit "cannot create note because it is empty".
 *
 * AnkiConnect checks the model's **first field** (`note.fields[0]`): if it is
 * blank, addNote fails even when other fields have content. Our first field is
 * usually `ob-deck-head`.
 *
 * Also:
 * - Mirror into legacy Front/Back when those fields still exist
 * - Fill Front-template fields that would otherwise render blank
 */
function ensureFieldsNonEmptyForAnki(
	fields: Record<string, string>,
	allowed: Set<string>,
	frontTemplateHtml: string,
	plainFallback: string,
	firstFieldName?: string,
): void {
	const front = fields[FIELD_FRONT] ?? '';
	const head = fields[FIELD_HEAD] ?? '';
	const back = fields[FIELD_BACK] ?? '';
	const best =
		(fieldHasContent(front) && front) ||
		(fieldHasContent(head) && head) ||
		(fieldHasContent(back) && back) ||
		(plainFallback.trim()
			? `<p>${escapeHtmlText(plainFallback.trim())}</p>`
			: '');

	if (!best) {
		return;
	}

	// Critical for AnkiConnect: first field must be non-empty.
	if (
		firstFieldName &&
		allowed.has(firstFieldName) &&
		!fieldHasContent(fields[firstFieldName])
	) {
		fields[firstFieldName] = best;
	}

	const referenced = fieldNamesInTemplateHtml(frontTemplateHtml);
	const usesHead = referenced.includes(FIELD_HEAD);
	const usesFront =
		referenced.includes(FIELD_FRONT) || referenced.includes('Front');

	// Avoid rendering the same HTML twice when we mirrored front → head.
	// Default template references both; assume that when template info is missing.
	if (
		fieldHasContent(fields[FIELD_HEAD]) &&
		fields[FIELD_HEAD] === fields[FIELD_FRONT] &&
		((usesHead && usesFront) || referenced.length === 0)
	) {
		fields[FIELD_FRONT] = '';
	}

	// Templates that only reference front (or legacy Front) still need content.
	if (!fieldHasContent(fields[FIELD_FRONT]) && best) {
		const frontOnly = usesFront && !usesHead;
		if (frontOnly || !fieldHasContent(fields[FIELD_HEAD])) {
			fields[FIELD_FRONT] = best;
		}
	}

	// Legacy Basic-style fields (still present when rename failed / mixed models).
	if (allowed.has('Front') && !fieldHasContent(fields.Front)) {
		fields.Front =
			fields[FIELD_FRONT] || fields[FIELD_HEAD] || best;
	}
	if (allowed.has('Back') && !fieldHasContent(fields.Back)) {
		fields.Back = fields[FIELD_BACK] || '';
	}

	if (referenced.length === 0) {
		return;
	}
	const anyReferencedFilled = referenced.some((name) =>
		fieldHasContent(fields[name]),
	);
	if (anyReferencedFilled) {
		return;
	}
	// Live Anki Front template still points at empty fields (e.g. only {{Front}}
	// while we filled ob-deck-front). Populate the first referenced field.
	const target =
		referenced.find((name) => allowed.has(name) || name in fields) ??
		referenced[0]!;
	fields[target] = best;
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
	const note = await client.noteInfo(noteId);
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
		/** Raw card front text when HTML render is empty. */
		plainFallback?: string;
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
	if (!(FIELD_FRONT in fields) && !allowed.has('Front')) {
		throw new Error(
			`笔记类型「${modelName}」缺少字段 ${FIELD_FRONT}（或 Front）。请打开插件设置点击「强制更新」，或确认 AnkiConnect 可用后重试同步。`,
		);
	}

	let liveFrontTemplates = '';
	try {
		const templates = await client.modelTemplates(modelName);
		liveFrontTemplates = Object.values(templates)
			.map((t) => t.Front)
			.join('\n');
	} catch {
		liveFrontTemplates = '';
	}

	const firstFieldName = modelFields[0];
	ensureFieldsNonEmptyForAnki(
		fields,
		allowed,
		liveFrontTemplates,
		input.plainFallback ?? '',
		firstFieldName,
	);

	if (
		!fieldHasContent(fields[FIELD_FRONT]) &&
		!fieldHasContent(fields.Front) &&
		!fieldHasContent(fields[FIELD_HEAD])
	) {
		throw new Error(
			'卡片正面渲染后为空，Anki 无法创建笔记。请检查正文，或到插件设置对该模板「强制更新」。',
		);
	}
	if (
		firstFieldName &&
		allowed.has(firstFieldName) &&
		!fieldHasContent(fields[firstFieldName])
	) {
		throw new Error(
			`笔记首字段「${firstFieldName}」为空，AnkiConnect 会拒绝创建。请检查标题/正文，或到插件设置对该模板「强制更新」。`,
		);
	}

	const applyUpdate = async (noteId: number): Promise<void> => {
		await client.updateNoteFields(noteId, fields);
		const note = await client.noteInfo(noteId);
		if (note?.cards?.length) {
			await client.changeDeck(note.cards, deckName);
		}
		await syncNoteTags(client, noteId, tags, deckTagsEnabled);
	};

	const findAndOverwriteDuplicate = async (): Promise<number | null> => {
		const front = fields[FIELD_FRONT] ?? '';
		// Prefer same deck; fall back to whole collection (note may have
		// survived outside the deleted/recreated deck).
		const queries = [
			`deck:"${escapeAnkiQueryValue(deckName)}" note:"${escapeAnkiQueryValue(modelName)}"`,
			`note:"${escapeAnkiQueryValue(modelName)}"`,
		];
		for (const query of queries) {
			const candidates = await client.findNotes(query);
			if (candidates.length === 0) {
				continue;
			}
			const details = await client.notesInfo(candidates);
			const match =
				details.find(
					(note) => (note.fields[FIELD_FRONT] ?? '') === front,
				) ??
				details.find((note) => (note.fields.Front ?? '') === front);
			if (!match) {
				continue;
			}
			await applyUpdate(match.noteId);
			return match.noteId;
		}
		return null;
	};

	// Local YAML / <!--ID--> may point at a note Anki no longer has
	// (e.g. user deleted the deck). Treat missing / card-less notes as create.
	if (input.noteId !== undefined) {
		const existing = await client.noteInfo(input.noteId);
		if (existing && existing.cards.length > 0) {
			try {
				await applyUpdate(input.noteId);
				return { noteId: input.noteId, created: false };
			} catch (error) {
				const msg =
					error instanceof Error ? error.message : String(error);
				const stale =
					/not\s*found|missing|不存在|找不到|deleted/i.test(msg) ||
					msg.trim() === '';
				if (!stale) {
					throw error;
				}
				// Fall through and recreate.
			}
		} else if (existing && existing.cards.length === 0) {
			// Note exists but has no cards (deck wiped) — drop and recreate.
			try {
				await client.deleteNotes([input.noteId]);
			} catch {
				/* ignore */
			}
		}
	}

	const tryAdd = async (allowDuplicate: boolean): Promise<number | null> => {
		try {
			return await client.addNote({
				deckName,
				modelName,
				fields,
				tags,
				allowDuplicate,
			});
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			const looksDuplicate = /duplicate|重复/i.test(msg);
			if (looksDuplicate) {
				return null;
			}
			const looksEmpty = /empty|为空/i.test(msg);
			const hint = looksEmpty
				? '（AnkiConnect 要求笔记首字段非空；或模板仍用旧 Front/Back。已尝试兼容写入；请到插件设置对该模板点「强制更新」后重试）'
				: '';
			throw new Error(`Anki addNote 失败：${msg}${hint}`);
		}
	};

	let createdId = await tryAdd(false);
	if (createdId != null) {
		return { noteId: createdId, created: true };
	}

	const overwritten = await findAndOverwriteDuplicate();
	if (overwritten != null) {
		return { noteId: overwritten, created: false };
	}

	// Last resort after deck deletion / scope quirks: allow duplicate then
	// we still prefer a real note id over failing the sync.
	createdId = await tryAdd(true);
	if (createdId != null) {
		return { noteId: createdId, created: true };
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

	const frontHtml = (payload.fields[FIELD_FRONT] ?? '').trim();
	const headHtml = (payload.fields[FIELD_HEAD] ?? '').trim();
	const backHtml = (payload.fields[FIELD_BACK] ?? '').trim();
	const plainFallback = (card.front || card.navTitle || '').trim();
	if (!frontHtml && !headHtml && !backHtml && !plainFallback) {
		throw new Error(
			'卡片正面/标题/背面渲染后均为空，Anki 无法创建笔记。请检查正文与公式（$…$）是否成对。',
		);
	}

	// If Anki's live Front template still uses legacy {{Front}} (or is blank),
	// push current plugin templates so addNote sees the fields we fill.
	try {
		const live = await client.modelTemplates(templateId);
		const frontSides = Object.values(live)
			.map((t) => t.Front)
			.join('\n');
		const referenced = fieldNamesInTemplateHtml(frontSides);
		const usesObDeck = referenced.some((n) => n.startsWith('ob-deck-'));
		const blankFront = !frontSides.trim();
		if (blankFront || (referenced.length > 0 && !usesObDeck)) {
			await ensureDeckTemplateModel(client, templateId, style, true);
			settings.ankiTemplateSyncedVersion =
				settings.deckTemplateStyleVersion ?? 0;
			await options?.persistSettings?.();
		}
	} catch {
		/* non-fatal; ensureFieldsNonEmptyForAnki still dual-writes Front/Back */
	}

	const upserted = await upsertAnkiNote(client, {
		noteId: card.noteId,
		deckName,
		modelName: templateId,
		fields: payload.fields,
		tags: payload.tags,
		deckTagsEnabled: settings.deckTagsEnabled,
		plainFallback,
	});

	// Card mode → always persist YAML `deckID` (and migrate legacy `<!--ID-->`).
	// Head/list → write `<!--ID-->` when missing or note id changed.
	const needsIdWrite =
		card.deckClass === 'card' ||
		upserted.created ||
		card.noteId !== upserted.noteId ||
		!card.idMarker;

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
