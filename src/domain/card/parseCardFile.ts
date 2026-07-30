import { parseFrontmatter } from '../head/frontmatter';
import { resolveDeckName } from '../head/resolveDeckName';
import type { ParseHeadFileOptions, ParsedHeadFile } from '../head/types';
import { buildCardTree } from './buildCardTree';

function basenameWithoutExt(filePath: string): string {
	const base = filePath.split(/[/\\]/).pop() ?? filePath;
	return base.replace(/\.md$/i, '');
}

/**
 * Parse the current note in card mode.
 * One file = one card (no nested deck). YAML stripped; --- splits front / back.
 * Root is synthetic for API; sync panel uses skipRootRow so only the card shows.
 */
export function parseCardFile(
	filePath: string,
	content: string,
	options: ParseHeadFileOptions,
): ParsedHeadFile {
	const meta = parseFrontmatter(content);
	const warnings = [...meta.warnings];
	const fileName = basenameWithoutExt(filePath);
	const deckName = resolveDeckName(content, filePath, meta.deckName);

	const { root, warnings: treeWarnings } = buildCardTree({
		filePath,
		content,
		deckName,
	});
	warnings.push(...treeWarnings);
	root.deckType = 'card';

	return {
		filePath,
		fileName,
		deckName,
		deckType: 'card',
		deckLevel: options.deckLevel,
		yamlDeckType: meta.deckType,
		yamlDeckName: meta.deckName,
		yamlDeckLevel: meta.deckLevel,
		deckStatus: meta.deckStatus,
		root,
		warnings,
	};
}
