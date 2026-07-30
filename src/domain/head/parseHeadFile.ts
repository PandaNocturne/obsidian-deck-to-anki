import { buildHeadTree } from './buildHeadTree';
import { parseFrontmatter } from './frontmatter';
import {
	findSoleLevel1Heading,
	resolveDeckName,
} from './resolveDeckName';
import type { ParseHeadFileOptions, ParsedHeadFile } from './types';

function basenameWithoutExt(filePath: string): string {
	const base = filePath.split(/[/\\]/).pop() ?? filePath;
	return base.replace(/\.md$/i, '');
}

/**
 * Parse the current note in head mode.
 */
export function parseHeadFile(
	filePath: string,
	content: string,
	options: ParseHeadFileOptions,
): ParsedHeadFile {
	const meta = parseFrontmatter(content);
	const warnings = [...meta.warnings];
	const fileName = basenameWithoutExt(filePath);
	const deckName = resolveDeckName(content, filePath, meta.deckName);
	const flattenSoleH1 = Boolean(findSoleLevel1Heading(content));

	if (options.deckType !== 'head') {
		warnings.push(`${options.deckType} 请使用对应解析入口`);
		const empty = buildHeadTree({
			filePath,
			content: '',
			deckName,
			cardHeadingLevel: options.deckLevel,
		});
		empty.root.deckType = options.deckType;
		return {
			filePath,
			fileName,
			deckName,
			deckType: options.deckType,
			deckLevel: options.deckLevel,
			yamlDeckType: meta.deckType,
			yamlDeckName: meta.deckName,
			yamlDeckLevel: meta.deckLevel,
			deckStatus: meta.deckStatus,
			root: empty.root,
			warnings,
		};
	}

	const { root, warnings: treeWarnings } = buildHeadTree({
		filePath,
		content,
		deckName,
		cardHeadingLevel: options.deckLevel,
		flattenSoleH1,
		includeHeadingInFront: options.includeHeadingInFront === true,
	});
	warnings.push(...treeWarnings);
	root.deckType = 'head';

	return {
		filePath,
		fileName,
		deckName,
		deckType: 'head',
		deckLevel: options.deckLevel,
		yamlDeckType: meta.deckType,
		yamlDeckName: meta.deckName,
		yamlDeckLevel: meta.deckLevel,
		deckStatus: meta.deckStatus,
		root,
		warnings,
	};
}
