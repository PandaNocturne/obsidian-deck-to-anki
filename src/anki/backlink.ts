import type { App, TFile } from 'obsidian';
import { resolveCardBacklinkTrail } from '../domain/head/deckBacklinkTrail';
import type {
	CardNode,
	DeckBacklinkSegment,
	DeckClass,
} from '../domain/head/types';

export type BacklinkScheme = 'none' | 'oburi' | 'aduri';

export interface BuildBacklinkOptions {
	app: App;
	card: CardNode;
	scheme: BacklinkScheme;
	/** Frontmatter property name for Advanced URI uid. Default `uid`. */
	uidProperty: string;
	/** Raw note content (for reading uid). */
	noteContent: string;
}

/** `Deck::Sub` → `Deck > Sub` for display in DeckBacklink. */
export function formatDeckTree(deckPath: string): string {
	return deckPath
		.split('::')
		.map((part) => part.trim())
		.filter(Boolean)
		.join(' > ');
}

/** Anki deck name uses `::` (same as our deckPath). */
export function toAnkiDeckName(deckPath: string): string {
	return deckPath
		.split('::')
		.map((part) => part.trim())
		.filter(Boolean)
		.join('::');
}

/**
 * Build query with encodeURIComponent so spaces become %20 (not +).
 * Custom protocol handlers (Obsidian/Anki) often mishandle +.
 */
function buildQuery(params: Record<string, string>): string {
	return Object.entries(params)
		.filter(([, value]) => value.length > 0)
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
		)
		.join('&');
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function readFrontmatterProperty(
	content: string,
	property: string,
): string | null {
	const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
	if (!fm) {
		return null;
	}
	const key = property.trim();
	if (!key) {
		return null;
	}
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = fm.match(
		new RegExp(`^${escaped}\\s*:\\s*(.+)$`, 'im'),
	);
	if (!match?.[1]) {
		return null;
	}
	return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function buildObUri(
	vaultName: string,
	filePath: string,
	card: CardNode,
): string {
	const normalized = filePath.replace(/\\/g, '/');
	const target = cardJumpTarget(card);

	if (target.block) {
		return `obsidian://open?${buildQuery({
			vault: vaultName,
			file: `${normalized}#^${target.block}`,
		})}`;
	}

	if (target.heading) {
		return `obsidian://open?${buildQuery({
			vault: vaultName,
			file: `${normalized}#${target.heading}`,
		})}`;
	}

	return `obsidian://open?${buildQuery({
		vault: vaultName,
		file: normalized,
	})}`;
}

/** Open a note, optionally at a heading (deck crumb). */
export function buildDeckSegmentObUri(
	vaultName: string,
	filePath: string,
	heading?: string,
): string {
	const normalized = filePath.replace(/\\/g, '/');
	const file = heading?.trim()
		? `${normalized}#${heading.trim()}`
		: normalized;
	return `obsidian://open?${buildQuery({
		vault: vaultName,
		file,
	})}`;
}

/**
 * Advanced URI: open by uid, optionally at heading or block.
 * Card backlink uses heading/block; deck-tree crumbs stay file-level when
 * heading anchors are unreliable inside Anki.
 */
function buildAdUri(
	vaultName: string,
	uid: string,
	target?: { heading?: string; block?: string },
): string {
	const params: Record<string, string> = {
		vault: vaultName,
		uid,
	};
	if (target?.block) {
		params.block = target.block;
	} else if (target?.heading) {
		params.heading = target.heading;
	}
	return `obsidian://adv-uri?${buildQuery(params)}`;
}

/** Resolve jump target for the current card: block (list) or heading (head). */
export function cardJumpTarget(card: CardNode): {
	heading?: string;
	block?: string;
} {
	if (card.deckClass === 'list' && card.blockId) {
		return { block: card.blockId };
	}
	if (card.deckClass === 'card') {
		return {};
	}
	const heading = (card.navTitle ?? '').trim();
	return heading ? { heading } : {};
}

/** Display label for ob-deck-backlink. */
export function cardBacklinkLabel(card: CardNode): string {
	const target = cardJumpTarget(card);
	if (target.block) {
		return `^${target.block}`;
	}
	if (target.heading) {
		return target.heading;
	}
	return '打开笔记';
}

export function buildCardBacklinkUri(options: BuildBacklinkOptions): {
	uri: string;
	schemeUsed: BacklinkScheme;
	warning?: string;
} {
	const { app, card, scheme, uidProperty, noteContent } = options;
	const vaultName = app.vault.getName();
	const filePath = card.sourceFilePath ?? '';
	const jump = cardJumpTarget(card);

	if (scheme === 'aduri') {
		const uid = readFrontmatterProperty(noteContent, uidProperty);
		if (uid) {
			return {
				uri: buildAdUri(vaultName, uid, jump),
				schemeUsed: 'aduri',
			};
		}
		return {
			uri: buildObUri(vaultName, filePath, card),
			schemeUsed: 'oburi',
			warning: `未找到属性 ${uidProperty}，已回退到 oburi`,
		};
	}

	if (scheme === 'none') {
		return {
			uri: '',
			schemeUsed: 'none',
		};
	}

	return {
		uri: buildObUri(vaultName, filePath, card),
		schemeUsed: 'oburi',
	};
}

async function resolveUidForFile(
	app: App,
	filePath: string,
	uidProperty: string,
	cachedContent?: string,
): Promise<string | null> {
	if (cachedContent !== undefined) {
		return readFrontmatterProperty(cachedContent, uidProperty);
	}
	const file = resolveSourceFile(app, filePath);
	if (!file) {
		return null;
	}
	const content = await app.vault.cachedRead(file);
	return readFrontmatterProperty(content, uidProperty);
}

/**
 * Build one crumb per deck segment.
 * - none: tree labels only (no href)
 * - oburi / aduri: each crumb gets an Obsidian URI
 */
export async function buildDeckSegmentUris(options: {
	app: App;
	card: CardNode;
	scheme: BacklinkScheme;
	uidProperty: string;
	/** Content of the card's own note (uid cache). */
	noteContent: string;
}): Promise<{
	segments: Array<{ name: string; uri?: string }>;
	warning?: string;
}> {
	const { app, card, scheme, uidProperty, noteContent } = options;
	const trail = resolveCardBacklinkTrail(card);
	const names = trail
		.map((crumb) => crumb.name.trim())
		.filter(Boolean);

	if (scheme === 'none') {
		return {
			segments: names.map((name) => ({ name })),
		};
	}

	const vaultName = app.vault.getName();
	const cardFile = card.sourceFilePath ?? '';
	let warning: string | undefined;
	const segments: Array<{ name: string; uri?: string }> = [];

	for (const crumb of trail) {
		const name = crumb.name.trim();
		if (!name) {
			continue;
		}
		const filePath = crumb.sourceFilePath || cardFile;
		let uri: string;

		if (!crumb.headingTarget && scheme === 'aduri') {
			const cached =
				filePath === cardFile ? noteContent : undefined;
			const uid = await resolveUidForFile(
				app,
				filePath,
				uidProperty,
				cached,
			);
			if (uid) {
				uri = buildAdUri(vaultName, uid);
			} else {
				uri = buildDeckSegmentObUri(vaultName, filePath);
				if (!warning && filePath === cardFile) {
					warning = `未找到属性 ${uidProperty}，已回退到 oburi`;
				}
			}
		} else {
			// Heading decks: always oburi (adv-uri heading anchors break in Anki).
			uri = buildDeckSegmentObUri(
				vaultName,
				filePath,
				crumb.headingTarget ? name : undefined,
			);
		}

		segments.push({ name, uri });
	}

	return { segments, warning };
}

export function buildCardBacklinkHtml(
	uri: string,
	label = '打开笔记',
): string {
	if (!uri.trim()) {
		return '';
	}
	return `<a class="dta-card-backlink" href="${uri}">${escapeHtml(label)}</a>`;
}

/**
 * Deck tree field HTML: crumbs.
 * With uri → clickable `<a>`; without (scheme none) → plain `<span>`.
 * Avoid MarkdownRenderer — it turns `&` into `&amp;` which breaks
 * custom-protocol clicks inside Anki.
 */
export function buildDeckBacklinkHtml(
	segments: Array<{ name: string; uri?: string }>,
): string {
	if (segments.length === 0) {
		return '';
	}
	return segments
		.map((seg) => {
			const label = escapeHtml(seg.name);
			if (seg.uri) {
				return `<a class="dta-deck-backlink" href="${seg.uri}">${label}</a>`;
			}
			return `<span class="dta-deck-crumb">${label}</span>`;
		})
		.join(' <span class="dta-deck-sep">&gt;</span> ');
}

/** @deprecated Prefer buildDeckBacklinkHtml(segments). */
export function buildDeckBacklinkHtmlFromPath(
	deckPath: string,
	uri: string,
): string {
	const label = escapeHtml(formatDeckTree(deckPath) || 'deck');
	return `<a class="dta-deck-backlink" href="${uri}">${label}</a>`;
}

export function resolveSourceFile(
	app: App,
	filePath: string,
): TFile | null {
	const file = app.vault.getAbstractFileByPath(filePath);
	return file && 'extension' in file ? (file as TFile) : null;
}

export function deckClassJumpHint(deckClass: DeckClass): string {
	switch (deckClass) {
		case 'list':
			return 'block';
		case 'card':
			return 'file';
		default:
			return 'heading';
	}
}

/** Re-export for callers that only need the trail type. */
export type { DeckBacklinkSegment };
