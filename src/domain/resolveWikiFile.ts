import type { App, TFile } from 'obsidian';
import { normalizeDeckFileLink } from './head/frontmatter';

function basenameWithoutMd(pathOrName: string): string {
	const base = pathOrName.split(/[/\\]/).pop() ?? pathOrName;
	return base.replace(/\.md$/i, '');
}

/**
 * Resolve a wiki basename / `[[Name]]` to a vault markdown file
 * by matching `path.basename(f.path)` without `.md`.
 */
export function resolveWikiBasenameToFile(
	app: App,
	wikiOrBasename: string,
): TFile | null {
	const stripped = wikiOrBasename
		.trim()
		.replace(/^\[\[/, '')
		.replace(/\]\]$/, '')
		.split('|')[0]
		?.trim();
	if (!stripped) {
		return null;
	}
	const baseName = basenameWithoutMd(stripped);
	const files = app.vault.getMarkdownFiles();
	const matched = files.filter(
		(f) => basenameWithoutMd(f.path) === baseName,
	);
	return matched[0] ?? null;
}

/** Resolve `deckFile: "[[parent]]"` to the parent note file. */
export function resolveDeckFileParent(
	app: App,
	deckFile: string,
): TFile | null {
	const normalized = normalizeDeckFileLink(deckFile) ?? deckFile;
	return resolveWikiBasenameToFile(app, normalized);
}
