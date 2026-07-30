import type { App, TFile } from 'obsidian';
import {
	formatDeckFileLink,
	parseFrontmatter,
	removeDeckFileYaml,
} from '../head/frontmatter';
import { collectWikiLinks } from './parseFileMode';

/**
 * When a file-mode parent is cleared (deckType → none), remove `deckFile`
 * from notes that were children (wikilink targets and/or deckFile index).
 * Returns how many notes were updated.
 */
export async function clearDeckFileOnFileChildren(
	app: App,
	parentFile: TFile,
	parentContent: string,
): Promise<number> {
	const parentLink = formatDeckFileLink(parentFile.path);
	const targets = new Map<string, TFile>();

	for (const ref of collectWikiLinks(parentContent)) {
		const dest = app.metadataCache.getFirstLinkpathDest(
			ref.linkpath,
			parentFile.path,
		);
		if (dest && dest.extension === 'md') {
			targets.set(dest.path, dest);
		}
	}

	for (const file of app.vault.getMarkdownFiles()) {
		if (file.path === parentFile.path) {
			continue;
		}
		const content = await app.vault.cachedRead(file);
		const meta = parseFrontmatter(content);
		if (meta.deckFile === parentLink) {
			targets.set(file.path, file);
		}
	}

	let updated = 0;
	for (const file of targets.values()) {
		const content = await app.vault.read(file);
		const next = removeDeckFileYaml(content);
		if (next !== content) {
			await app.vault.modify(file, next);
			updated += 1;
		}
	}
	return updated;
}
