import type { App, TFile } from 'obsidian';
import type { CardNode, DeckClass } from '../domain/head/types';

export type BacklinkScheme = 'oburi' | 'aduri';

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

	if (card.deckClass === 'list' && card.blockId) {
		return `obsidian://open?${buildQuery({
			vault: vaultName,
			file: `${normalized}#^${card.blockId}`,
		})}`;
	}

	if (card.deckClass === 'card') {
		return `obsidian://open?${buildQuery({
			vault: vaultName,
			file: normalized,
		})}`;
	}

	const heading = (card.navTitle ?? card.front).trim();
	return `obsidian://open?${buildQuery({
		vault: vaultName,
		file: heading ? `${normalized}#${heading}` : normalized,
	})}`;
}

/**
 * Advanced URI short scheme: `obsidian://adv-uri`.
 * (Alias of advanced-uri; matches user / docs examples.)
 */
function buildAdUri(
	vaultName: string,
	uid: string,
	card: CardNode,
): string {
	const params: Record<string, string> = {
		vault: vaultName,
		uid,
	};

	if (card.deckClass === 'list' && card.blockId) {
		params.block = card.blockId;
	} else if (card.deckClass !== 'card') {
		const heading = (card.navTitle ?? card.front).trim();
		if (heading) {
			params.heading = heading;
		}
	}

	return `obsidian://adv-uri?${buildQuery(params)}`;
}

export function buildCardBacklinkUri(options: BuildBacklinkOptions): {
	uri: string;
	schemeUsed: BacklinkScheme;
	warning?: string;
} {
	const { app, card, scheme, uidProperty, noteContent } = options;
	const vaultName = app.vault.getName();
	const filePath = card.sourceFilePath ?? '';

	if (scheme === 'aduri') {
		const uid = readFrontmatterProperty(noteContent, uidProperty);
		if (uid) {
			return {
				uri: buildAdUri(vaultName, uid, card),
				schemeUsed: 'aduri',
			};
		}
		return {
			uri: buildObUri(vaultName, filePath, card),
			schemeUsed: 'oburi',
			warning: `未找到属性 ${uidProperty}，已回退到 oburi`,
		};
	}

	return {
		uri: buildObUri(vaultName, filePath, card),
		schemeUsed: 'oburi',
	};
}

/**
 * DeckBacklink field HTML: deck tree as a plain anchor.
 * Avoid MarkdownRenderer — it turns `&` into `&amp;` which breaks
 * custom-protocol clicks inside Anki.
 */
export function buildDeckBacklinkHtml(deckPath: string, uri: string): string {
	const label = escapeHtml(formatDeckTree(deckPath) || 'deck');
	// Keep raw `&` in href for Anki WebView custom-protocol compatibility.
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
