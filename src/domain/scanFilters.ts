import type { App, TFile } from 'obsidian';

/** Normalize a folder path for storage / comparison. `./` = vault root. */
export function normalizeFolderPath(raw: string): string | null {
	let path = raw.trim().replace(/\\/g, '/');
	if (!path) {
		return null;
	}
	path = path.replace(/^\/+|\/+$/g, '');
	if (!path || path === '.' || path === './') {
		return './';
	}
	return path;
}

/** Normalize a tag (no leading #). */
export function normalizeTagFilter(raw: string): string | null {
	let tag = raw.trim().replace(/^#+/, '');
	if (!tag) {
		return null;
	}
	// Obsidian tags: not pure digits; allow nested `/`.
	if (!/[^\d/]/.test(tag)) {
		return null;
	}
	if (!/^[\w\u0080-\uFFFF/-]+$/u.test(tag)) {
		return null;
	}
	return tag;
}

function isVaultRootFolder(folder: string): boolean {
	const p = folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	return !p || p === '.' || p === './';
}

/** True when the file path is under any of the folder prefixes. */
export function isUnderFolders(filePath: string, folders: string[]): boolean {
	if (folders.length === 0) {
		return true;
	}
	if (folders.some(isVaultRootFolder)) {
		return true;
	}
	const normalized = filePath.replace(/\\/g, '/');
	return folders.some((folder) => {
		const prefix = folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
		if (!prefix) {
			return true;
		}
		return normalized === prefix || normalized.startsWith(`${prefix}/`);
	});
}

/** True when the file path is under an ignored folder. */
export function isUnderIgnoredFolders(
	filePath: string,
	ignoreFolders: string[],
): boolean {
	if (ignoreFolders.length === 0) {
		return false;
	}
	return isUnderFolders(filePath, ignoreFolders);
}

/**
 * Nested tag match: filter `anki` matches `anki` and `anki/deck`.
 * Empty `includeTags` → no tag restriction.
 */
export function noteMatchesIncludeTags(
	noteTags: string[],
	includeTags: string[],
): boolean {
	if (includeTags.length === 0) {
		return true;
	}
	const normalized = noteTags.map((t) =>
		t.replace(/^#/, '').toLowerCase(),
	);
	return includeTags.some((filter) => {
		const f = filter.replace(/^#/, '').toLowerCase();
		if (!f) {
			return false;
		}
		return normalized.some((t) => t === f || t.startsWith(`${f}/`));
	});
}

/** Collect note tags from Obsidian metadata cache (inline + frontmatter). */
export function collectFileTags(app: App, file: TFile): string[] {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) {
		return [];
	}
	const out = new Set<string>();
	for (const t of cache.tags ?? []) {
		const tag = t.tag.replace(/^#/, '');
		if (tag) {
			out.add(tag);
		}
	}
	const addFm = (value: unknown) => {
		if (typeof value === 'string') {
			for (const part of value.split(/[\s,]+/)) {
				const tag = part.trim().replace(/^#/, '');
				if (tag) {
					out.add(tag);
				}
			}
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) {
				if (typeof item === 'string') {
					const tag = item.trim().replace(/^#/, '');
					if (tag) {
						out.add(tag);
					}
				}
			}
		}
	};
	addFm(cache.frontmatter?.tags);
	addFm(cache.frontmatter?.tag);
	return [...out];
}

/** Unique sorted folder paths in the vault (root as `./`). */
export function listVaultFolders(app: App): string[] {
	const folders = app.vault.getAllFolders(true);
	return folders
		.map((f) => (f.isRoot() ? './' : f.path.replace(/\\/g, '/')))
		.sort((a, b) => a.localeCompare(b));
}

/** Unique tags known to the vault (no leading #), sorted. */
export function listVaultTags(app: App): string[] {
	const found = new Set<string>();
	for (const file of app.vault.getMarkdownFiles()) {
		for (const tag of collectFileTags(app, file)) {
			found.add(tag);
		}
	}
	return [...found].sort((a, b) => a.localeCompare(b));
}
