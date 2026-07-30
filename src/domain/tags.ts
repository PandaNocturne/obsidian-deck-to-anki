/**
 * Extract Obsidian-style inline tags (`#tag`, `#nested/tag`) from markdown text.
 * Skips fenced code blocks. Returns unique tags without leading `#`.
 */
const FENCE_REGEXP = /^(`{3,}|~{3,})/;
/** Tag body: not pure digits; allows letters, numbers, _, -, /, unicode. */
const INLINE_TAG_REGEXP =
	/(?:^|[\s([{（【「『])#([^\s#]+)/gu;
const FRONTMATTER_REGEXP = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function stripFencedCode(text: string): string {
	const lines = text.split(/\r?\n/);
	const out: string[] = [];
	let inFence = false;
	let fenceChar = '';
	for (const line of lines) {
		const fenceMatch = line.match(FENCE_REGEXP);
		if (fenceMatch?.[1]) {
			const ch = fenceMatch[1][0] ?? '`';
			if (!inFence) {
				inFence = true;
				fenceChar = ch;
			} else if (ch === fenceChar) {
				inFence = false;
				fenceChar = '';
			}
			continue;
		}
		if (!inFence) {
			out.push(line);
		}
	}
	return out.join('\n');
}

function isValidObsidianTag(tag: string): boolean {
	if (!tag) {
		return false;
	}
	// Must contain at least one non-digit (Obsidian rule).
	if (!/[^\d/]/.test(tag)) {
		return false;
	}
	// Allowed: word chars, hyphen, slash, common unicode letters.
	return /^[\w\u0080-\uFFFF/-]+$/u.test(tag);
}

/** Unique inline `#tags` from note body text (no leading #). */
export function extractInlineTags(text: string): string[] {
	const cleaned = stripFencedCode(text);
	const found = new Set<string>();
	INLINE_TAG_REGEXP.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = INLINE_TAG_REGEXP.exec(cleaned)) !== null) {
		const raw = (match[1] ?? '').replace(/[.,;:!?)\]】」』]+$/u, '');
		if (isValidObsidianTag(raw)) {
			found.add(raw);
		}
	}
	return [...found];
}

/**
 * Parse YAML `tags` / `tag` list from frontmatter (no leading #).
 */
export function extractFrontmatterTags(content: string): string[] {
	const fm = content.match(FRONTMATTER_REGEXP)?.[1];
	if (!fm) {
		return [];
	}
	const found: string[] = [];
	const lines = fm.split(/\r?\n/);
	let inTagsList = false;

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}

		if (inTagsList) {
			const item = trimmed.match(/^-\s*(.+)$/);
			if (item?.[1]) {
				const t = item[1].trim().replace(/^['"]|['"]$/g, '').replace(/^#/, '');
				if (t) {
					found.push(t);
				}
				continue;
			}
			// End of list when next key appears.
			if (/^[^-\s][^:]*:/.test(trimmed)) {
				inTagsList = false;
			} else {
				continue;
			}
		}

		const keyMatch = trimmed.match(/^(tags?)\s*:\s*(.*)$/i);
		if (!keyMatch) {
			continue;
		}
		const rest = (keyMatch[2] ?? '').trim();
		if (!rest) {
			inTagsList = true;
			continue;
		}
		// Inline: tags: [a, b] or tags: a, b
		const inline = rest
			.replace(/^\[|\]$/g, '')
			.split(/[\s,]+/)
			.map((s) => s.trim().replace(/^['"]|['"]$/g, '').replace(/^#/, ''))
			.filter(Boolean);
		found.push(...inline);
	}

	return [...new Set(found.filter(isValidObsidianTag))];
}

/** Merge inline + optional YAML tags; unique, stable order. */
export function collectCardTags(
	parts: string[],
	frontmatterContent?: string,
): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	const add = (tag: string) => {
		const key = tag.toLowerCase();
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		out.push(tag);
	};
	for (const part of parts) {
		for (const t of extractInlineTags(part)) {
			add(t);
		}
	}
	if (frontmatterContent) {
		for (const t of extractFrontmatterTags(frontmatterContent)) {
			add(t);
		}
	}
	return out;
}
