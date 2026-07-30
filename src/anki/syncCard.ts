import type { App } from 'obsidian';
import type { DeckToAnkiSettings } from '../settings';
import { parseFrontmatter } from '../domain/head/frontmatter';
import type { CardNode, DeckNode } from '../domain/head/types';
import { AnkiConnectClient } from './AnkiConnectClient';
import {
	buildCardBacklinkUri,
	buildDeckBacklinkHtml,
	resolveSourceFile,
	toAnkiDeckName,
} from './backlink';
import { cleanupEmptyAnkiDecks } from './cleanupEmptyDecks';
import { ensureDeckTemplateModel } from './ensureModel';
import { dedupeMediaAssets } from './processMedia';
import { renderFieldWithMedia, toAnkiTags } from './renderFields';
import {
	DECK_TEMPLATE_IDS,
	FIELD_BACK,
	FIELD_BACKLINK,
	FIELD_FRONT,
	FIELD_TAGS,
	type DeckTemplateId,
} from './templates';
import { writeCardIdMarker } from './writeIdMarker';

export interface SyncCardResult {
	noteId: number;
	created: boolean;
	deckName: string;
	modelName: string;
	warning?: string;
	stylePushed?: boolean;
}

export interface SyncPersistOptions {
	/** Persist settings after Anki template styles are pushed. */
	persistSettings?: () => Promise<void>;
	forceModelUpdate?: boolean;
}

export function collectCardsFromNode(
	node: DeckNode | CardNode,
): CardNode[] {
	if (node.kind === 'card') {
		return [node];
	}
	const out: CardNode[] = [];
	for (const child of node.children) {
		out.push(...collectCardsFromNode(child));
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
	const { deckName, modelName, fields, tags, deckTagsEnabled } = input;

	const applyUpdate = async (noteId: number): Promise<void> => {
		await client.updateNoteFields(noteId, fields);
		const info = await client.notesInfo([noteId]);
		const note = info[0];
		if (note?.cards?.length) {
			await client.changeDeck(note.cards, deckName);
		}
		await syncNoteTags(client, noteId, tags, deckTagsEnabled);
	};

	if (input.noteId !== undefined) {
		const existing = await client.notesInfo([input.noteId]);
		if (existing.length > 0) {
			await applyUpdate(input.noteId);
			return { noteId: input.noteId, created: false };
		}
		// Stale <!--ID--> — recreate below.
	}

	const createdId = await client.addNote({
		deckName,
		modelName,
		fields,
		tags,
		allowDuplicate: false,
	});

	if (createdId != null) {
		return { noteId: createdId, created: true };
	}

	// Duplicate in deck: find matching front field and overwrite.
	const query = `deck:"${escapeAnkiQueryValue(deckName)}" note:"${escapeAnkiQueryValue(modelName)}"`;
	const candidates = await client.findNotes(query);
	if (candidates.length > 0) {
		const details = await client.notesInfo(candidates);
		const front = fields[FIELD_FRONT] ?? '';
		const match =
			details.find((note) => (note.fields[FIELD_FRONT] ?? '') === front) ??
			details.find((note) => (note.fields.Front ?? '') === front) ??
			details[0];
		if (match) {
			await applyUpdate(match.noteId);
			return { noteId: match.noteId, created: false };
		}
	}

	throw new Error('addNote 返回 null（可能重复），且未能定位已有笔记以覆盖');
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

	for (const id of DECK_TEMPLATE_IDS) {
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
	const templateId = resolveDeckTemplate(
		meta.deckTemplate,
		settings.deckTemplate,
	);
	const style =
		settings.deckTemplateStyles[templateId] ??
		settings.deckTemplateStyles['ob-deck-basic'];

	let stylePushed = false;
	if (!options?.skipStylePush) {
		stylePushed = await pushDeckTemplateStylesIfNeeded(
			client,
			settings,
			options,
		);
	}

	// Still ensure the active model exists (create-only if styles already synced).
	await ensureDeckTemplateModel(client, templateId, style, false);

	const deckName = toAnkiDeckName(card.deckPath);
	if (!deckName) {
		throw new Error('牌组路径为空，无法同步');
	}
	await client.createDeck(deckName);

	const [front, back] = await Promise.all([
		renderFieldWithMedia(app, card.front, filePath),
		renderFieldWithMedia(app, card.back, filePath),
	]);
	const media = dedupeMediaAssets([...front.assets, ...back.assets]);
	if (media.length > 0) {
		await client.storeMediaFiles(media);
	}

	let deckBacklinkHtml = '';
	let warning: string | undefined;
	if (settings.deckBacklinkEnabled) {
		const link = buildCardBacklinkUri({
			app,
			card,
			scheme: settings.backlinkScheme,
			uidProperty: settings.advUriUidProperty || 'uid',
			noteContent,
		});
		warning = link.warning;
		deckBacklinkHtml = buildDeckBacklinkHtml(card.deckPath, link.uri);
	}

	const tags = settings.deckTagsEnabled
		? toAnkiTags(card.tags ?? [])
		: [];
	const tagsHtml =
		tags.length > 0
			? tags.map((tag) => `#${tag}`).join(' · ')
			: '';

	const fields: Record<string, string> = {
		[FIELD_FRONT]: front.html,
		[FIELD_BACK]: back.html,
		[FIELD_BACKLINK]: deckBacklinkHtml,
		[FIELD_TAGS]: tagsHtml,
	};

	const upserted = await upsertAnkiNote(client, {
		noteId: card.noteId,
		deckName,
		modelName: templateId,
		fields,
		tags,
		deckTagsEnabled: settings.deckTagsEnabled,
	});

	// Always refresh <!--ID--> so subsequent syncs hit update, not add.
	if (
		upserted.created ||
		card.noteId !== upserted.noteId ||
		!card.idMarker
	) {
		await writeCardIdMarker(app, file, card, upserted.noteId);
	}

	return {
		noteId: upserted.noteId,
		created: upserted.created,
		deckName,
		modelName: templateId,
		warning,
		stylePushed,
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
	// Write ID markers from bottom to top so line indexes stay valid.
	cards.sort((a, b) => {
		const pathCmp = (a.sourceFilePath ?? '').localeCompare(
			b.sourceFilePath ?? '',
		);
		if (pathCmp !== 0) {
			return pathCmp;
		}
		return b.lineStart - a.lineStart;
	});

	let ok = 0;
	let fail = 0;
	const warnings: string[] = [];
	if (stylePushed) {
		warnings.push('已将新卡片样式推送到 Anki（请重新打开预览查看）');
	}

	for (const card of cards) {
		try {
			const result = await syncCardToAnki(app, settings, card, {
				...options,
				skipStylePush: true,
			});
			ok += 1;
			if (result.warning) {
				warnings.push(result.warning);
			}
		} catch (error) {
			fail += 1;
			const msg = error instanceof Error ? error.message : String(error);
			warnings.push(`「${card.front.slice(0, 24)}」: ${msg}`);
		}
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
	for (const id of DECK_TEMPLATE_IDS) {
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
