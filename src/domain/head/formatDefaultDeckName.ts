/**
 * Derive a default deck name from a note file name / basename.
 * - strips `.md`
 * - removes leading date prefixes (and following `_` / `-` / space)
 * - does not rewrite underscores in the middle of the name
 * - trims edges
 */
export function formatDefaultDeckName(filePathOrName: string): string {
	const base =
		filePathOrName.split(/[/\\]/).pop()?.replace(/\.md$/i, '') ??
		filePathOrName;

	let name = base.trim();

	// 2025-07-30 / 2025/07/30 / 2025.07.30 (+ optional time) + separator
	name = name.replace(
		/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T_]\d{1,2}[:.]\d{2}(?::\d{2})?)?[_\-\s]+/,
		'',
	);
	// 20250730 / 202507301230 (+ optional) + separator
	name = name.replace(/^\d{8}(?:\d{4,6})?[_\-\s]+/, '');
	// leftover leading underscores / separators only
	name = name.replace(/^[_\-\s]+/, '');
	name = name.replace(/[_\-\s]+$/, '').trim();

	return name || base.trim() || 'Untitled';
}
