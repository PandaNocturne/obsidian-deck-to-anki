import { App, Component, MarkdownRenderer } from 'obsidian';
import { extractMathForAnki, injectAnkiMath } from './mathForAnki';
import {
	dedupeMediaAssets,
	preprocessMarkdownMedia,
	processRenderedHtmlMedia,
	type MediaAsset,
} from './processMedia';

/**
 * Render markdown to HTML using Obsidian's MarkdownRenderer.
 */
export async function renderMarkdownToHtml(
	app: App,
	markdown: string,
	sourcePath: string,
): Promise<string> {
	const text = markdown.trim();
	if (!text) {
		return '';
	}

	const component = new Component();
	component.load();
	try {
		const host = document.createElement('div');
		await MarkdownRenderer.render(
			app,
			text,
			host,
			sourcePath,
			component,
		);
		return host.innerHTML;
	} finally {
		component.unload();
	}
}

/**
 * Render a card field for Anki: rewrite local media to Anki filenames,
 * convert `$`/`$$` math to Anki MathJax delimiters, and collect assets.
 */
export async function renderFieldWithMedia(
	app: App,
	markdown: string,
	sourcePath: string,
): Promise<{ html: string; assets: MediaAsset[] }> {
	const text = markdown.trim();
	if (!text) {
		return { html: '', assets: [] };
	}

	const pre = await preprocessMarkdownMedia(app, text, sourcePath);
	// Extract math before Obsidian render so Anki gets \( \) / \[ \] (not Obsidian MathJax DOM).
	const prepared = extractMathForAnki(pre.markdown);
	const rawHtml = await renderMarkdownToHtml(
		app,
		prepared.markdown,
		sourcePath,
	);
	const withMath = injectAnkiMath(rawHtml, prepared.slots);
	const post = await processRenderedHtmlMedia(app, withMath, sourcePath);
	return {
		html: post.html,
		assets: dedupeMediaAssets([...pre.assets, ...post.assets]),
	};
}

/** Convert Obsidian tags (`a/b`) to Anki-friendly tags (`a::b`). */
export function toAnkiTags(tags: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const tag of tags) {
		const normalized = tag
			.trim()
			.replace(/^#/, '')
			.replace(/\//g, '::');
		if (!normalized) {
			continue;
		}
		const key = normalized.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(normalized);
	}
	return out;
}
