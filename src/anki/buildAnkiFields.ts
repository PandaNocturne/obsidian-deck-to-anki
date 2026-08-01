import type { App } from 'obsidian';
import type { DeckToAnkiSettings } from '../settings';
import { parseFrontmatter } from '../domain/head/frontmatter';
import type { CardNode } from '../domain/head/types';
import {
	numberBacklinkSegmentNames,
} from '../domain/head/siblingIndex';
import {
	buildCardBacklinkHtml,
	buildCardBacklinkUri,
	buildDeckBacklinkHtml,
	buildDeckSegmentUris,
	resolveCardBacklinkLinkText,
	resolveSourceFile,
	toAnkiDeckNameForCard,
	type BacklinkScheme,
} from './backlink';
import type { MediaCompressCache } from './mediaCompressCache';
import { resolveNumberingOptions } from './numbering';
import {
	dedupeMediaAssets,
	type MediaAsset,
	type MediaProcessOptions,
} from './processMedia';
import { renderFieldWithMedia, toAnkiTags } from './renderFields';
import {
	allDeckTemplateIdsOrdered,
	FIELD_BACK,
	FIELD_BACKLINK,
	FIELD_FRONT,
	FIELD_HEAD,
	FIELD_ID,
	FIELD_TAGS,
	FIELD_TREE,
	provisionalDeckIdField,
	type DeckTemplateId,
} from './templates';

function mediaOptions(
	settings: DeckToAnkiSettings,
	cache?: MediaCompressCache | null,
): MediaProcessOptions | undefined {
	if (settings.mediaCompressEnabled === false) {
		return undefined;
	}
	const q = settings.mediaCompressQuality ?? 75;
	const opts: MediaProcessOptions = {
		compressQuality: Math.min(100, Math.max(1, Math.round(q))),
	};
	if (cache) {
		opts.compressCache = cache;
	}
	return opts;
}

export interface AnkiNoteFieldPayload {
	deckName: string;
	modelName: DeckTemplateId;
	fields: Record<string, string>;
	tags: string[];
	assets: MediaAsset[];
	warning?: string;
}

function resolveDeckTemplate(
	yaml: string | undefined,
	settings: DeckToAnkiSettings,
): DeckTemplateId {
	const known = allDeckTemplateIdsOrdered(settings);
	if (yaml && known.includes(yaml)) {
		return yaml;
	}
	if (known.includes(settings.deckTemplate)) {
		return settings.deckTemplate;
	}
	return 'ob-deck-basic';
}

/**
 * Split parse title vs front body for Anki.
 * Head = navTitle; front is body under the heading (never includes the title line).
 *
 * Card mode (no navTitle): all content → `ob-deck-front`, head stays empty.
 * Title-only head cards: content → `ob-deck-front`.
 * Head + body: title → head, body → front.
 *
 * AnkiConnect first field is always `ob-deck-id` (not head/front).
 */
export function splitCardHeadAndFront(card: CardNode): {
	headMarkdown: string;
	frontMarkdown: string;
} {
	const head = (card.navTitle ?? '').trim();
	let front = card.front.trim();

	// Card / list without a heading title: front only.
	if (!head || card.deckClass === 'card') {
		return { headMarkdown: '', frontMarkdown: front || head };
	}

	if (front === head) {
		return { headMarkdown: '', frontMarkdown: head };
	}

	const lines = front.split(/\r?\n/);
	if ((lines[0] ?? '').trim() === head) {
		front = lines.slice(1).join('\n').replace(/^\s+/, '');
	}

	if (!front.trim()) {
		return { headMarkdown: '', frontMarkdown: head };
	}

	return { headMarkdown: head, frontMarkdown: front };
}

/**
 * Build Anki fields the same way for sync and status compare.
 * Vault source files are never modified here.
 */
export async function buildAnkiNoteFieldPayload(
	app: App,
	settings: DeckToAnkiSettings,
	card: CardNode,
	options?: {
		mediaCache?: MediaCompressCache | null;
		/** Prefer vault.read over cachedRead when syncing. */
		freshNoteContent?: boolean;
	},
): Promise<AnkiNoteFieldPayload> {
	const filePath = card.sourceFilePath;
	if (!filePath) {
		throw new Error('卡片缺少 sourceFilePath');
	}
	const file = resolveSourceFile(app, filePath);
	if (!file) {
		throw new Error(`找不到源笔记：${filePath}`);
	}

	let noteContent = options?.freshNoteContent
		? await app.vault.read(file)
		: await app.vault.cachedRead(file);
	const meta = parseFrontmatter(noteContent);
	const modelName = resolveDeckTemplate(meta.deckTemplate, settings);
	const numbering = resolveNumberingOptions(meta, settings);
	const deckName = toAnkiDeckNameForCard(card, numbering.deckNumbering);
	const uidProperty = settings.advUriUidProperty || 'uid';

	const { headMarkdown, frontMarkdown } = splitCardHeadAndFront(card);
	const baseMediaOpts = mediaOptions(settings, options?.mediaCache);
	const mediaOpts: MediaProcessOptions = {
		...(baseMediaOpts ?? {}),
		assetMemo: new Map(),
	};
	const emptyField = (): Promise<{ html: string; assets: MediaAsset[] }> =>
		Promise.resolve({ html: '', assets: [] });
	const [head, front, back] = await Promise.all([
		headMarkdown
			? renderFieldWithMedia(app, headMarkdown, filePath, mediaOpts)
			: emptyField(),
		frontMarkdown
			? renderFieldWithMedia(app, frontMarkdown, filePath, mediaOpts)
			: emptyField(),
		renderFieldWithMedia(app, card.back, filePath, mediaOpts),
	]);

	const headField = head.html;
	const frontField = front.html;

	let warning: string | undefined;
	let treeHtml = '';
	if (settings.deckTreeEnabled !== false) {
		const treeScheme: BacklinkScheme =
			settings.deckTreeLinkEnabled === false
				? 'none'
				: settings.backlinkScheme;
		const link = await buildDeckSegmentUris({
			app,
			card,
			scheme: treeScheme,
			uidProperty,
			noteContent,
		});
		warning = link.warning;
		if (link.noteContent) {
			noteContent = link.noteContent;
		}
		const numbered = numberBacklinkSegmentNames(
			link.segments.map((s) => s.name),
			card.deckIndexPath,
			numbering.deckNumbering,
		);
		treeHtml = buildDeckBacklinkHtml(
			link.segments.map((seg, i) => ({
				...seg,
				name: numbered[i] ?? seg.name,
			})),
		);
	}

	let cardBacklinkHtml = '';
	if (settings.deckCardBacklinkEnabled !== false) {
		const cardLink = await buildCardBacklinkUri({
			app,
			card,
			scheme: settings.backlinkScheme,
			uidProperty,
			noteContent,
		});
		if (!warning && cardLink.warning) {
			warning = cardLink.warning;
		}
		if (cardLink.noteContent) {
			noteContent = cardLink.noteContent;
		}
		cardBacklinkHtml = buildCardBacklinkHtml(
			cardLink.uri,
			resolveCardBacklinkLinkText(
				card,
				settings.backlinkLinkTextMode ?? 'auto',
				settings.backlinkLinkText ?? 'backlink',
			),
		);
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
			[FIELD_ID]: provisionalDeckIdField(card),
			[FIELD_HEAD]: headField,
			[FIELD_FRONT]: frontField,
			[FIELD_BACK]: back.html,
			[FIELD_TAGS]: tagsHtml,
			[FIELD_TREE]: treeHtml,
			[FIELD_BACKLINK]: cardBacklinkHtml,
		},
		tags,
		assets: dedupeMediaAssets([
			...head.assets,
			...front.assets,
			...back.assets,
		]),
		warning,
	};
}
