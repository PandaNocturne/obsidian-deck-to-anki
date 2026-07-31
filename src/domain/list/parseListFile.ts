import { parseFrontmatter } from '../head/frontmatter';
import {
	findSoleLevel1Heading,
	resolveDeckName,
} from '../head/resolveDeckName';
import type { ParseHeadFileOptions, ParsedHeadFile } from '../head/types';
import { buildListTree } from './buildListTree';

function basenameWithoutExt(filePath: string): string {
	const base = filePath.split(/[/\\]/).pop() ?? filePath;
	return base.replace(/\.md$/i, '');
}

/**
 * Parse the current note in list mode.
 * Top-level list items â†?card fronts; nested lists â†?backs.
 * Headings group decks; a sole H1 becomes the root deckName.
 */
export function parseListFile(
	filePath: string,
	content: string,
	options: ParseHeadFileOptions,
): ParsedHeadFile {
	const meta = parseFrontmatter(content);
	const warnings = [...meta.warnings];
	const fileName = basenameWithoutExt(filePath);
	const deckName = resolveDeckName(content, filePath, meta.deckName);
	const flattenSoleH1 = Boolean(findSoleLevel1Heading(content));

	const { root, warnings: treeWarnings } = buildListTree({
		filePath,
		content,
		deckName,
		flattenSoleH1,
	});
	warnings.push(...treeWarnings);
	root.deckType = 'list';

	return {
		filePath,
		fileName,
		deckName,
		deckType: 'list',
		deckLevel: options.deckLevel,
		yamlDeckType: meta.deckType,
		yamlDeckName: meta.deckName,
		yamlDeckLevel: meta.deckLevel,
		yamlDeckTemplate: meta.deckTemplate,
		yamlDeckNumbering: meta.deckNumbering,
		deckStatus: meta.deckStatus,
		root,
		warnings,
	};
}
