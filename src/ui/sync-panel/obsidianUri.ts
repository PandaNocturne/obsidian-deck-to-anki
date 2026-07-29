/**
 * Build a core Obsidian URI that opens a vault file at a heading.
 * Format: obsidian://open?vault=...&file=path/to/note.md#Heading
 */
export function buildObsidianHeadingUri(
	vaultName: string,
	filePath: string,
	heading: string,
): string {
	const normalized = filePath.replace(/\\/g, '/');
	const headingText = heading.trim();
	const target = headingText
		? `${normalized}#${headingText}`
		: normalized;
	const params = new URLSearchParams();
	params.set('vault', vaultName);
	params.set('file', target);
	return `obsidian://open?${params.toString()}`;
}

export function openObsidianUri(uri: string): void {
	window.open(uri);
}
