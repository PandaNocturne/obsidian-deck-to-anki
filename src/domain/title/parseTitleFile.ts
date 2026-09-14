import { formatDefaultDeckName } from '../head/formatDefaultDeckName';
import { parseFrontmatter } from '../head/frontmatter';
import { resolveDeckName } from '../head/resolveDeckName';
import type { ParseHeadFileOptions, ParsedHeadFile } from '../head/types';
import { buildTitleTree } from './buildTitleTree';

function basenameWithoutExt(filePath: string): string {
	const base = filePath.split(/[/\\]/).pop() ?? filePath;
	return base.replace(/\.md$/i, '');
}

/**
 * Parse the current note in title mode.
 * One file = one card: filename → front, body (after YAML) → back.
 * Root is synthetic; sync panel uses skipRootRow so only the card shows.
 */
export function parseTitleFile(
	filePath: string,
	content: string,
	options: ParseHeadFileOptions,
): ParsedHeadFile {
	const meta = parseFrontmatter(content);
	const warnings = [...meta.warnings];
	const fileName = basenameWithoutExt(filePath);
	const deckName = resolveDeckName(content, filePath, meta.deckName);

	const { root, warnings: treeWarnings } = buildTitleTree({
		filePath,
		content,
		deckName,
	});
	warnings.push(...treeWarnings);
	root.deckType = 'title';

	return {
		filePath,
		fileName,
		deckName,
		deckType: 'title',
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

/** Card front text for title mode (basename, date prefixes stripped). */
export function titleModeFrontFromPath(filePath: string): string {
	return formatDefaultDeckName(filePath);
}
