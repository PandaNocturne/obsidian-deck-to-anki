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
import { ensureDeckTemplateModel } from './ensureModel';
import { dedupeMediaAssets } from './processMedia';
import { renderFieldWithMedia, toAnkiTags } from './renderFields';
import {
	DECK_TEMPLATE_IDS,
	type DeckTemplateId,
} from './templates';
import { writeCardIdMarker } from './writeIdMarker';

export interface SyncCardResult {
	noteId: number;
	created: boolean;
	deckName: string;
	modelName: string;
	warning?: string;
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

/**
 * Ensure note type exists (create-only unless force), then add/update one card.
 * Model comes from note YAML `deckTemplate`, else plugin default.
 */
export async function syncCardToAnki(
	app: App,
	settings: DeckToAnkiSettings,
	card: CardNode,
	options?: { forceModelUpdate?: boolean },
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

	await ensureDeckTemplateModel(
		client,
		templateId,
		style,
		options?.forceModelUpdate ?? false,
	);

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

	const fields: Record<string, string> = {
		Front: front.html,
		Back: back.html,
		DeckBacklink: deckBacklinkHtml,
	};

	const tags = settings.deckTagsEnabled
		? toAnkiTags(card.tags ?? [])
		: [];

	if (card.noteId !== undefined) {
		await client.updateNoteFields(card.noteId, fields);
		const info = await client.notesInfo([card.noteId]);
		const note = info[0];
		if (note) {
			await client.changeDeck(note.cards, deckName);
			if (settings.deckTagsEnabled) {
				const existing = note.tags ?? [];
				const toRemove = existing.filter((t) => !tags.includes(t));
				const toAdd = tags.filter((t) => !existing.includes(t));
				await client.removeTags([card.noteId], toRemove);
				await client.addTags([card.noteId], toAdd);
			}
		}
		return {
			noteId: card.noteId,
			created: false,
			deckName,
			modelName: templateId,
			warning,
		};
	}

	const noteId = await client.addNote({
		deckName,
		modelName: templateId,
		fields,
		tags,
	});
	await writeCardIdMarker(app, file, card, noteId);

	return {
		noteId,
		created: true,
		deckName,
		modelName: templateId,
		warning,
	};
}

export async function syncNodesToAnki(
	app: App,
	settings: DeckToAnkiSettings,
	node: DeckNode | CardNode,
): Promise<{ ok: number; fail: number; warnings: string[] }> {
	const cards = collectCardsFromNode(node);
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

	for (const card of cards) {
		try {
			const result = await syncCardToAnki(app, settings, card);
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

	return { ok, fail, warnings };
}

export async function forceUpdateDeckTemplate(
	settings: DeckToAnkiSettings,
): Promise<'created' | 'updated' | 'exists'> {
	const client = createClient(settings);
	const templateId = settings.deckTemplate;
	const style = settings.deckTemplateStyles[templateId];
	return ensureDeckTemplateModel(client, templateId, style, true);
}
