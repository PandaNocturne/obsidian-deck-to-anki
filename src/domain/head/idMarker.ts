import type { IdMarkerInfo } from './types';

export const ID_MARKER_REGEXP = /^\s*<!--\s*ID:\s*([1-9]\d*)\s*-->\s*$/;

export function parseIdMarker(line: string, lineIndex: number): IdMarkerInfo | null {
	const match = line.match(ID_MARKER_REGEXP);
	if (!match?.[1]) {
		return null;
	}

	return {
		noteId: Number(match[1]),
		raw: match[0].trim(),
		lineIndex,
	};
}

export function findIdMarkerInLines(
	lines: string[],
	startLine: number,
	endLineExclusive: number,
): IdMarkerInfo | null {
	for (let i = endLineExclusive - 1; i >= startLine; i--) {
		const line = lines[i];
		if (line === undefined) {
			continue;
		}
		const marker = parseIdMarker(line, i);
		if (marker) {
			return marker;
		}
	}
	return null;
}

export function createIdMarkerRaw(noteId: number): string {
	return `<!--ID: ${noteId}-->`;
}
