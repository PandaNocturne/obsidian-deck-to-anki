import type { App, TFile } from 'obsidian';
import { parseCardFile } from './card/parseCardFile';
import { parseFileMode } from './file/parseFileMode';
import { parseFrontmatter } from './head/frontmatter';
import { parseHeadFile } from './head/parseHeadFile';
import type { DeckType, ParsedHeadFile } from './head/types';
import { parseListFile } from './list/parseListFile';

export interface ParseNoteOptions {
	/** Forced type (session override). Otherwise YAML / fallback. */
	deckType?: DeckType;
	deckLevel?: number;
	/** Fallback when YAML has no deckType (current-note tab only). */
	fallbackDeckType: DeckType;
	fallbackDeckLevel: number;
	childCardHeadingLevel: number;
	childTypeOverrides?: Map<string, Exclude<DeckType, 'file'>>;
	/**
	 * When true, require YAML deckType (used by all/archived scan).
	 * Returns null if missing.
	 */
	requireYamlDeckType?: boolean;
}

/**
 * Parse one markdown note into a deck tree.
 */
export async function parseNoteFile(
	app: App,
	file: TFile,
	content: string,
	options: ParseNoteOptions,
): Promise<ParsedHeadFile | null> {
	const meta = parseFrontmatter(content);
	if (options.requireYamlDeckType && !meta.deckType) {
		return null;
	}

	const deckType =
		options.deckType ?? meta.deckType ?? options.fallbackDeckType;
	const deckLevel =
		options.deckLevel ?? meta.deckLevel ?? options.fallbackDeckLevel;

	if (deckType === 'file') {
		return parseFileMode({
			app,
			sourceFile: file,
			content,
			options: { deckType: 'file', deckLevel },
			childCardHeadingLevel: options.childCardHeadingLevel,
			childTypeOverrides: options.childTypeOverrides,
		});
	}

	if (deckType === 'list') {
		return parseListFile(file.path, content, {
			deckType: 'list',
			deckLevel,
		});
	}

	if (deckType === 'card') {
		return parseCardFile(file.path, content, {
			deckType: 'card',
			deckLevel,
		});
	}

	return parseHeadFile(file.path, content, {
		deckType: 'head',
		deckLevel,
	});
}
