import type { App, TFile } from 'obsidian';
import {
	annotateSourceFile,
	buildHeadTree,
	recountCards,
	repathDeckTree,
} from '../head/buildHeadTree';
import {
	formatDefaultDeckName,
	stripParentDeckNamePrefix,
} from '../head/formatDefaultDeckName';
import {
	ensureDeckFileLink,
	formatDeckFileLink,
	parseFrontmatter,
	upsertDeckYaml,
} from '../head/frontmatter';
import {
	findSoleLevel1Heading,
	resolveDeckName,
} from '../head/resolveDeckName';
import type {
	DeckNode,
	DeckType,
	ParseHeadFileOptions,
	ParsedHeadFile,
} from '../head/types';
import { buildListTree } from '../list/buildListTree';

const WIKILINK_REGEXP = /(!)?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

export interface WikiLinkRef {
	linkpath: string;
	alias?: string;
	lineIndex: number;
	embedded: boolean;
}

function basenameWithoutExt(filePath: string): string {
	const base = filePath.split(/[/\\]/).pop() ?? filePath;
	return base.replace(/\.md$/i, '');
}

/**
 * Collect wiki / embed links in document order, skipping fenced code.
 */
export function collectWikiLinks(content: string): WikiLinkRef[] {
	const lines = content.split(/\r?\n/);
	const refs: WikiLinkRef[] = [];
	let inFence = false;
	let fenceChar = '';

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const fenceMatch = line.match(/^(`{3,}|~{3,})/);
		if (fenceMatch?.[1]) {
			const marker = fenceMatch[1];
			const ch = marker[0] ?? '`';
			if (!inFence) {
				inFence = true;
				fenceChar = ch;
			} else if (ch === fenceChar) {
				inFence = false;
				fenceChar = '';
			}
			continue;
		}

		if (inFence) {
			continue;
		}

		WIKILINK_REGEXP.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = WIKILINK_REGEXP.exec(line)) !== null) {
			const linkpath = (match[2] ?? '').trim();
			if (!linkpath) {
				continue;
			}
			const alias = match[3]?.trim();
			refs.push({
				linkpath,
				alias: alias || undefined,
				lineIndex: i,
				embedded: Boolean(match[1]),
			});
		}
	}

	return refs;
}

export interface ParseFileModeContext {
	app: App;
	sourceFile: TFile;
	content: string;
	options: ParseHeadFileOptions;
	/** Fallback heading level for child head notes without deckLevel. */
	childCardHeadingLevel: number;
	/**
	 * Session overrides for child notes (path → forced deckType).
	 * Does not write YAML; skips auto-write when present.
	 */
	childTypeOverrides?: Map<string, Exclude<DeckType, 'file'>>;
}

interface ResolvedChildMode {
	/** Effective parse mode (never file). */
	deckType: Exclude<DeckType, 'file'>;
	content: string;
	autoSetHead: boolean;
	forcedFromFile: boolean;
}

/**
 * Resolve child note deckType:
 * - missing → auto-write YAML deckType: head
 * - file → not allowed for nesting; parse as head (YAML type unchanged)
 * - head / card / list → use as-is
 * Always ensure deckFile: [[parent]] indexes the file-mode parent.
 */
async function resolveChildDeckMode(
	app: App,
	file: TFile,
	content: string,
	fallbackLevel: number,
	parentFile: TFile,
): Promise<ResolvedChildMode> {
	const meta = parseFrontmatter(content);
	let next = content;
	let autoSetHead = false;
	let forcedFromFile = false;
	let deckType: Exclude<DeckType, 'file'> = 'head';

	if (!meta.deckType) {
		next = upsertDeckYaml(next, {
			deckType: 'head',
			deckName: meta.deckName,
			deckLevel: meta.deckLevel ?? fallbackLevel,
			deckStatus: meta.deckStatus,
			deckFile: formatDeckFileLink(parentFile.path),
		});
		autoSetHead = true;
		deckType = 'head';
	} else if (meta.deckType === 'file') {
		forcedFromFile = true;
		deckType = 'head';
		next = ensureDeckFileLink(next, parentFile.path);
	} else {
		deckType = meta.deckType;
		next = ensureDeckFileLink(next, parentFile.path);
	}

	if (next !== content) {
		await app.vault.modify(file, next);
	}

	return {
		deckType,
		content: next,
		autoSetHead,
		forcedFromFile,
	};
}

/**
 * File mode: root = current note; each linked markdown note = one subgroup.
 * Child notes use their own deckType (default/auto head); nested file is not allowed.
 */
export async function parseFileMode(
	ctx: ParseFileModeContext,
): Promise<ParsedHeadFile> {
	const {
		app,
		sourceFile,
		content,
		options,
		childCardHeadingLevel,
		childTypeOverrides,
	} = ctx;
	const meta = parseFrontmatter(content);
	const warnings = [...meta.warnings];
	const filePath = sourceFile.path;
	const fileName = basenameWithoutExt(filePath);
	const deckName = resolveDeckName(content, filePath, meta.deckName);

	const root: DeckNode = {
		kind: 'deck',
		id: `deck:root:${filePath}`,
		name: deckName,
		deckPath: deckName,
		headingLevel: 0,
		lineStart: -1,
		cardCount: 0,
		children: [],
		sourceFilePath: filePath,
		deckType: 'file',
	};

	const refs = collectWikiLinks(content);
	const seen = new Set<string>();

	for (const ref of refs) {
		const dest = app.metadataCache.getFirstLinkpathDest(
			ref.linkpath,
			filePath,
		);
		if (!dest || dest.extension !== 'md') {
			warnings.push(`未解析链接: ${ref.linkpath}`);
			continue;
		}
		if (dest.path === filePath) {
			continue;
		}
		if (seen.has(dest.path)) {
			continue;
		}
		seen.add(dest.path);

		let childContent = await app.vault.cachedRead(dest);
		const typeOverride = childTypeOverrides?.get(dest.path);
		let resolved: ResolvedChildMode;
		if (typeOverride) {
			const withParent = ensureDeckFileLink(childContent, sourceFile.path);
			if (withParent !== childContent) {
				await app.vault.modify(dest, withParent);
				childContent = withParent;
			}
			resolved = {
				deckType: typeOverride,
				content: childContent,
				autoSetHead: false,
				forcedFromFile: false,
			};
		} else {
			resolved = await resolveChildDeckMode(
				app,
				dest,
				childContent,
				childCardHeadingLevel,
				sourceFile,
			);
			childContent = resolved.content;
		}

		const childMeta = parseFrontmatter(childContent);
		const soleH1 = findSoleLevel1Heading(childContent);
		const childBase =
			ref.alias?.trim() ||
			childMeta.deckName?.trim() ||
			soleH1 ||
			formatDefaultDeckName(dest.path);
		const childName = stripParentDeckNamePrefix(childBase, deckName);
		const flattenSoleH1 = Boolean(soleH1);

		if (resolved.autoSetHead) {
			warnings.push(`${childName}: 已自动写入 deckType: head / deckFile`);
		}
		if (resolved.forcedFromFile) {
			warnings.push(
				`${childName}: 子笔记不支持 file 嵌套，已按 head 解析`,
			);
		}

		if (resolved.deckType === 'card') {
			warnings.push(`${childName}: card 解析尚未实现，已跳过卡片`);
			const emptyChild: DeckNode = {
				kind: 'deck',
				id: `deck:file:${filePath}:${dest.path}:${ref.lineIndex}`,
				name: childName,
				deckPath: `${root.deckPath}::${childName}`,
				headingLevel: 0,
				lineStart: ref.lineIndex,
				cardCount: 0,
				children: [],
				sourceFilePath: dest.path,
				deckType: resolved.deckType,
			};
			root.children.push(emptyChild);
			continue;
		}

		const parsedChild =
			resolved.deckType === 'list'
				? buildListTree({
						filePath: dest.path,
						content: childContent,
						deckName: childName,
						flattenSoleH1,
					})
				: buildHeadTree({
						filePath: dest.path,
						content: childContent,
						deckName: childName,
						cardHeadingLevel:
							childMeta.deckLevel ?? childCardHeadingLevel,
						pruneEmpty: true,
						flattenSoleH1,
					});

		warnings.push(
			...parsedChild.warnings.map((w) => `${childName}: ${w}`),
		);

		const childRoot = parsedChild.root;
		childRoot.id = `deck:file:${filePath}:${dest.path}:${ref.lineIndex}`;
		childRoot.lineStart = ref.lineIndex;
		childRoot.deckType = resolved.deckType;
		annotateSourceFile(childRoot, dest.path);
		repathDeckTree(childRoot, root.deckPath);
		root.children.push(childRoot);
	}

	recountCards(root);

	if (root.children.length === 0) {
		warnings.push('未找到可解析的关联笔记链接');
	}

	return {
		filePath,
		fileName,
		deckName,
		deckType: 'file',
		deckLevel: options.deckLevel,
		yamlDeckType: meta.deckType,
		yamlDeckName: meta.deckName,
		yamlDeckLevel: meta.deckLevel,
		deckStatus: meta.deckStatus,
		root,
		warnings,
	};
}
