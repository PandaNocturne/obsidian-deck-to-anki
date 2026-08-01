import { App, Component, MarkdownRenderer } from 'obsidian';
import { extractMathForAnki, injectAnkiMath } from './mathForAnki';
import {
	dedupeMediaAssets,
	preprocessMarkdownMedia,
	processRenderedHtmlMedia,
	type MediaAsset,
	type MediaProcessOptions,
} from './processMedia';
import {
	processWikiLinksInHtml,
	stripWikiLinksInMarkdown,
} from './wikiLinks';

/** Obsidian / plugin chrome injected into rendered code blocks — not for Anki. */
const OBSIDIAN_CODE_UI_SELECTOR = [
	'button.copy-code-button',
	'button.run-code-button',
	'.copy-code-button',
	'.run-code-button',
	'button.edit-block-button',
	'.edit-block-button',
].join(', ');

function stripObsidianUiChrome(host: HTMLElement): void {
	host.querySelectorAll(OBSIDIAN_CODE_UI_SELECTOR).forEach((el) => {
		el.remove();
	});
}

function escapeHtmlText(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** True when HTML has no visible text (Anki treats these notes as empty). */
function isVisuallyEmptyHtml(html: string): boolean {
	const text = html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/gi, ' ')
		.replace(/\u200b/g, '')
		.trim();
	return text.length === 0;
}

/**
 * Render markdown to HTML using Obsidian's MarkdownRenderer.
 * Strips editor chrome (copy/run buttons) that would otherwise appear in Anki.
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
		stripObsidianUiChrome(host);
		return host.innerHTML;
	} finally {
		component.unload();
	}
}

export interface RenderFieldOptions extends MediaProcessOptions {
	/**
	 * When true, wiki links become oburi (`obsidian://open`).
	 * When false (default), wiki links are plain text (no link).
	 */
	wikiLinkEnabled?: boolean;
}

/**
 * Render a card field for Anki: rewrite local media to Anki filenames,
 * convert `$`/`$$` math to Anki MathJax delimiters, and collect assets.
 */
export async function renderFieldWithMedia(
	app: App,
	markdown: string,
	sourcePath: string,
	mediaOptions?: RenderFieldOptions,
): Promise<{ html: string; assets: MediaAsset[] }> {
	const text = markdown.trim();
	if (!text) {
		return { html: '', assets: [] };
	}

	const wikiLinkEnabled = mediaOptions?.wikiLinkEnabled === true;
	const sourceMarkdown = wikiLinkEnabled
		? text
		: stripWikiLinksInMarkdown(text);

	const pre = await preprocessMarkdownMedia(
		app,
		sourceMarkdown,
		sourcePath,
		mediaOptions,
	);
	// Extract math before Obsidian render so Anki gets \( \) / \[ \] (not Obsidian MathJax DOM).
	const prepared = extractMathForAnki(pre.markdown);
	const rawHtml = await renderMarkdownToHtml(
		app,
		prepared.markdown,
		sourcePath,
	);
	let withMath = injectAnkiMath(rawHtml, prepared.slots);
	// Obsidian can yield empty HTML for broken math / odd headings; keep a
	// plain-text fallback so Anki never gets a fully empty note field.
	if (isVisuallyEmptyHtml(withMath) && text.trim()) {
		withMath = `<p>${escapeHtmlText(text)}</p>`;
	}
	withMath = processWikiLinksInHtml(withMath, {
		enabled: wikiLinkEnabled,
		vaultName: app.vault.getName(),
	});
	const post = await processRenderedHtmlMedia(
		app,
		withMath,
		sourcePath,
		mediaOptions,
	);
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
