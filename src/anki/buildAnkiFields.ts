import type { App } from 'obsidian';
import type { DeckToAnkiSettings } from '../settings';
import { parseFrontmatter } from '../domain/head/frontmatter';
import type { CardNode } from '../domain/head/types';
import {
	formatCardNumberPrefix,
	numberBacklinkSegmentNames,
} from '../domain/head/siblingIndex';
import {
	buildCardBacklinkHtml,
	buildCardBacklinkUri,
	buildDeckBacklinkHtml,
	buildDeckSegmentUris,
	cardBacklinkLabel,
	resolveSourceFile,
	toAnkiDeckName,
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
	DECK_TEMPLATE_IDS,
	FIELD_BACK,
	FIELD_BACKLINK,
	FIELD_FRONT,
	FIELD_HEAD,
	FIELD_TAGS,
	FIELD_TREE,
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
	fallback: DeckTemplateId,
): DeckTemplateId {
	if (yaml && DECK_TEMPLATE_IDS.includes(yaml as DeckTemplateId)) {
		return yaml as DeckTemplateId;
	}
	return fallback;
}

/**
 * Split parse title vs front body for Anki.
 * Head = navTitle; front never includes the heading text.
 */
export function splitCardHeadAndFront(card: CardNode): {
	headMarkdown: string;
	frontMarkdown: string;
} {
	const head = (card.navTitle ?? '').trim();
	let front = card.front.trim();
	if (head) {
		if (front === head) {
			front = '';
		} else {
			const lines = front.split(/\r?\n/);
			if ((lines[0] ?? '').trim() === head) {
				front = lines.slice(1).join('\n').replace(/^\s+/, '');
			}
		}
	}
	return { headMarkdown: head, frontMarkdown: front };
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
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

	const noteContent = options?.freshNoteContent
		? await app.vault.read(file)
		: await app.vault.cachedRead(file);
	const meta = parseFrontmatter(noteContent);
	const modelName = resolveDeckTemplate(
		meta.deckTemplate,
		settings.deckTemplate,
	);
	const deckName = toAnkiDeckName(card.deckPath);

	const { headMarkdown, frontMarkdown } = splitCardHeadAndFront(card);
	const mediaOpts = mediaOptions(settings, options?.mediaCache);
	const [front, back] = await Promise.all([
		frontMarkdown
			? renderFieldWithMedia(app, frontMarkdown, filePath, mediaOpts)
			: Promise.resolve({ html: '', assets: [] as MediaAsset[] }),
		renderFieldWithMedia(app, card.back, filePath, mediaOpts),
	]);

	const numbering = resolveNumberingOptions(meta, settings);
	const numberPrefix = formatCardNumberPrefix(card, numbering);

	const headText = headMarkdown ? escapeHtml(headMarkdown) : '';
	const headField = headText
		? `${numberPrefix}${headText}`
		: numberPrefix && !front.html
			? numberPrefix.trim()
			: '';
	const frontField =
		!headText && numberPrefix ? `${numberPrefix}${front.html}` : front.html;

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
			uidProperty: settings.advUriUidProperty || 'uid',
			noteContent,
		});
		warning = link.warning;
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
		const cardLink = buildCardBacklinkUri({
			app,
			card,
			scheme: settings.backlinkScheme,
			uidProperty: settings.advUriUidProperty || 'uid',
			noteContent,
		});
		if (!warning && cardLink.warning) {
			warning = cardLink.warning;
		}
		cardBacklinkHtml = buildCardBacklinkHtml(
			cardLink.uri,
			cardBacklinkLabel(card),
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
			[FIELD_HEAD]: headField,
			[FIELD_FRONT]: frontField,
			[FIELD_BACK]: back.html,
			[FIELD_TAGS]: tagsHtml,
			[FIELD_BACKLINK]: cardBacklinkHtml,
			[FIELD_TREE]: treeHtml,
		},
		tags,
		assets: dedupeMediaAssets([...front.assets, ...back.assets]),
		warning,
	};
}
