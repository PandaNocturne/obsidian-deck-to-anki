import type { App, TFile } from 'obsidian';
import { collectWikiLinks } from './file/parseFileMode';
import { recountCards } from './head/buildHeadTree';
import { parseFrontmatter } from './head/frontmatter';
import type { CardNode, DeckNode, ParsedHeadFile } from './head/types';
import { parseNoteFile } from './parseNote';
import {
	collectFileTags,
	isUnderFolders,
	isUnderIgnoredFolders,
	noteMatchesIncludeTags,
} from './scanFilters';

export type VaultDeckScanMode = 'active' | 'archived';

export interface ScanDeckNotesOptions {
	mode: VaultDeckScanMode;
	/** When non-empty, only scan notes under these folder prefixes. */
	includeFolders: string[];
	/** Exclude notes under these folder prefixes. */
	ignoreFolders?: string[];
	/** When non-empty, only notes with matching tags (nested). */
	includeTags?: string[];
	fallbackDeckLevel: number;
	childCardHeadingLevel: number;
	includeHeadingInFront?: boolean;
}

function passesScanScope(
	app: App,
	file: TFile,
	includeFolders: string[],
	ignoreFolders: string[],
	includeTags: string[],
): boolean {
	if (!isUnderFolders(file.path, includeFolders)) {
		return false;
	}
	if (isUnderIgnoredFolders(file.path, ignoreFolders)) {
		return false;
	}
	if (
		!noteMatchesIncludeTags(collectFileTags(app, file), includeTags)
	) {
		return false;
	}
	return true;
}

/**
 * Paths linked from any `deckType: file` note — these nest under the parent
 * and must not appear again as top-level items in all/archived tabs.
 */
async function collectFileModeNestedPaths(
	app: App,
	includeFolders: string[],
	ignoreFolders: string[],
	includeTags: string[],
): Promise<Set<string>> {
	const nested = new Set<string>();
	const files = app.vault.getMarkdownFiles();

	for (const file of files) {
		if (
			!passesScanScope(
				app,
				file,
				includeFolders,
				ignoreFolders,
				includeTags,
			)
		) {
			continue;
		}
		const content = await app.vault.cachedRead(file);
		const meta = parseFrontmatter(content);
		if (meta.deckType !== 'file') {
			continue;
		}

		for (const ref of collectWikiLinks(content)) {
			const dest = app.metadataCache.getFirstLinkpathDest(
				ref.linkpath,
				file.path,
			);
			if (!dest || dest.extension !== 'md') {
				continue;
			}
			if (dest.path === file.path) {
				continue;
			}
			nested.add(dest.path);
		}
	}

	return nested;
}

/**
 * Find markdown notes that declare YAML deckType, filtered by archive status.
 * Excludes notes nested under a file-mode parent (deckFile index or wiki link).
 */
export async function findDeckTypedNotes(
	app: App,
	mode: VaultDeckScanMode,
	includeFolders: string[],
	ignoreFolders: string[] = [],
	includeTags: string[] = [],
): Promise<TFile[]> {
	const wantArchived = mode === 'archived';
	const nestedPaths = await collectFileModeNestedPaths(
		app,
		includeFolders,
		ignoreFolders,
		includeTags,
	);
	const files = app.vault.getMarkdownFiles();
	const matched: TFile[] = [];

	for (const file of files) {
		if (
			!passesScanScope(
				app,
				file,
				includeFolders,
				ignoreFolders,
				includeTags,
			)
		) {
			continue;
		}
		if (nestedPaths.has(file.path)) {
			continue;
		}
		const content = await app.vault.cachedRead(file);
		const meta = parseFrontmatter(content);
		if (!meta.deckType) {
			continue;
		}
		// Child notes under file mode carry deckFile → parent index.
		if (meta.deckFile) {
			continue;
		}
		if (meta.deckStatus !== wantArchived) {
			continue;
		}
		matched.push(file);
	}

	matched.sort((a, b) => a.path.localeCompare(b.path));
	return matched;
}

/**
 * Parse all deckType-tagged notes for the all/archived tabs.
 */
export async function parseVaultDeckForest(
	app: App,
	options: ScanDeckNotesOptions,
): Promise<{ root: DeckNode; items: ParsedHeadFile[]; warnings: string[] }> {
	const ignoreFolders = options.ignoreFolders ?? [];
	const includeTags = options.includeTags ?? [];
	const files = await findDeckTypedNotes(
		app,
		options.mode,
		options.includeFolders,
		ignoreFolders,
		includeTags,
	);
	const items: ParsedHeadFile[] = [];
	const warnings: string[] = [];
	const label = options.mode === 'archived' ? '归档卡片' : '所有卡片';

	for (const file of files) {
		const content = await app.vault.cachedRead(file);
		try {
			const parsed = await parseNoteFile(app, file, content, {
				fallbackDeckType: 'head',
				fallbackDeckLevel: options.fallbackDeckLevel,
				childCardHeadingLevel: options.childCardHeadingLevel,
				includeHeadingInFront: options.includeHeadingInFront === true,
				requireYamlDeckType: true,
			});
			if (parsed) {
				items.push(parsed);
				warnings.push(
					...parsed.warnings.map(
						(w: string) => `${parsed.deckName}: ${w}`,
					),
				);
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			warnings.push(`${file.path}: 解析失败 ${message}`);
		}
	}

	const root: DeckNode = {
		kind: 'deck',
		id: `deck:forest:${options.mode}`,
		name: label,
		deckPath: label,
		headingLevel: 0,
		lineStart: -1,
		cardCount: 0,
		children: [],
		sourceFilePath: undefined,
	};

	for (const item of items) {
		// Card notes are leaves (no nested deck) in forest views too.
		if (item.deckType === 'card') {
			const card = item.root.children.find(
				(child): child is CardNode => child.kind === 'card',
			);
			if (card) {
				root.children.push(card);
			}
			continue;
		}
		root.children.push(item.root);
	}
	recountCards(root);

	return { root, items, warnings };
}
