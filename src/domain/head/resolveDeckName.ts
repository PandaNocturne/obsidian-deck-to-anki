import { formatDefaultDeckName } from './formatDefaultDeckName';

/**
 * If the note body contains exactly one H1, return its text.
 * Skips YAML frontmatter and fenced code blocks.
 */
export function findSoleLevel1Heading(content: string): string | undefined {
	const lines = content.split(/\r?\n/);
	let start = 0;
	if ((lines[0] ?? '').trim() === '---') {
		for (let i = 1; i < lines.length; i++) {
			if ((lines[i] ?? '').trim() === '---') {
				start = i + 1;
				break;
			}
		}
	}

	const titles: string[] = [];
	let inFence = false;
	let fenceChar = '';

	for (let i = start; i < lines.length; i++) {
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

		const match = line.match(/^#\s+(.*?)\s*$/);
		if (!match || match[1] === undefined) {
			continue;
		}
		const text = match[1].replace(/\s+#+\s*$/, '').trim();
		if (text) {
			titles.push(text);
		}
	}

	return titles.length === 1 ? titles[0] : undefined;
}

/**
 * Resolve display deck name: YAML deckName → sole H1 → formatted file name.
 */
export function resolveDeckName(
	content: string,
	filePathOrName: string,
	yamlDeckName?: string,
): string {
	const fromYaml = yamlDeckName?.trim();
	if (fromYaml) {
		return fromYaml;
	}
	const soleH1 = findSoleLevel1Heading(content);
	if (soleH1) {
		return soleH1;
	}
	return formatDefaultDeckName(filePathOrName);
}
