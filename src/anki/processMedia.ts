import { App, TFile } from 'obsidian';
import {
	compressImageForAnki,
	isCompressibleImageExt,
} from './compressImage';

export interface MediaAsset {
	kind: 'image' | 'audio';
	/** Filename stored in Anki media folder. */
	fileName: string;
	/** Absolute filesystem path when available (desktop). */
	absolutePath?: string;
	/** Base64 payload fallback for storeMediaFile. */
	dataBase64?: string;
	vaultPath: string;
}

/** Options for Anki media prep (upload payload only; vault files untouched). */
export interface MediaProcessOptions {
	/** JPEG quality 1–100 when compressing raster images for Anki. */
	compressQuality?: number;
}

const IMAGE_EXTENSIONS = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'bmp',
	'svg',
	'webp',
	'tiff',
	'tif',
]);

const AUDIO_EXTENSIONS = new Set([
	'wav',
	'mp3',
	'm4a',
	'flac',
	'ogg',
	'oga',
	'opus',
	'wma',
	'aac',
	'webm',
]);

const WIKI_EMBED_REGEXP = /!\[\[([^\]\n]+)\]\]/g;
const MD_IMAGE_REGEXP = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function hashString(input: string): string {
	let hash = 2166136261;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function stripSubpath(linkPath: string): string {
	return linkPath.split('#', 1)[0] ?? linkPath;
}

function parseLinkTarget(rawTarget: string): {
	linkPath: string;
	alias?: string;
} {
	const [linkPath, alias] = rawTarget.split('|', 2).map((s) => s.trim());
	return {
		linkPath: linkPath ?? '',
		alias: alias || undefined,
	};
}

function mediaKindForExtension(
	extension: string,
): 'image' | 'audio' | null {
	const ext = extension.toLowerCase();
	if (IMAGE_EXTENSIONS.has(ext)) {
		return 'image';
	}
	if (AUDIO_EXTENSIONS.has(ext)) {
		return 'audio';
	}
	return null;
}

function getFullPath(app: App, vaultPath: string): string | null {
	const adapter = app.vault.adapter as {
		getFullPath?: (normalizedPath: string) => string;
		basePath?: string;
	};
	if (typeof adapter.getFullPath === 'function') {
		return adapter.getFullPath(vaultPath);
	}
	if (typeof adapter.basePath === 'string' && adapter.basePath) {
		const sep = adapter.basePath.includes('\\') ? '\\' : '/';
		return `${adapter.basePath.replace(/[/\\]$/, '')}${sep}${vaultPath.replace(/^\//, '').replace(/\//g, sep)}`;
	}
	return null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const chunk = 0x8000;
	let binary = '';
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

function ankiFileNameFor(file: TFile, overrideExt?: string): string {
	// Flatten to a single media name; hash avoids basename collisions.
	let safeName = file.name.replace(/[\\/:*?"<>|]/g, '_');
	if (overrideExt) {
		const base = safeName.replace(/\.[^.]+$/, '') || safeName;
		safeName = `${base}.${overrideExt}`;
	}
	return `${hashString(file.path)}-${safeName}`;
}

async function buildAsset(
	app: App,
	file: TFile,
	kind: 'image' | 'audio',
	options?: MediaProcessOptions,
): Promise<MediaAsset> {
	const quality = options?.compressQuality;
	const shouldCompress =
		kind === 'image' &&
		typeof quality === 'number' &&
		quality > 0 &&
		isCompressibleImageExt(file.extension);

	if (shouldCompress) {
		const data = await app.vault.readBinary(file);
		const compressed = await compressImageForAnki(
			data,
			file.extension,
			quality,
		);
		if (compressed) {
			return {
				kind,
				fileName: ankiFileNameFor(file, compressed.ext),
				dataBase64: compressed.dataBase64,
				vaultPath: file.path,
			};
		}
	}

	const fileName = ankiFileNameFor(file);
	const absolutePath = getFullPath(app, file.path) ?? undefined;
	if (absolutePath) {
		return {
			kind,
			fileName,
			absolutePath,
			vaultPath: file.path,
		};
	}
	const data = await app.vault.readBinary(file);
	return {
		kind,
		fileName,
		dataBase64: arrayBufferToBase64(data),
		vaultPath: file.path,
	};
}

function resolveVaultFile(
	app: App,
	rawLink: string,
	sourcePath: string,
): TFile | null {
	const cleaned = stripSubpath(rawLink.trim().replace(/^<|>$/g, ''));
	if (!cleaned || /^https?:\/\//i.test(cleaned) || cleaned.startsWith('data:')) {
		return null;
	}
	const dest = app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath);
	return dest instanceof TFile ? dest : null;
}

function mediaSnippet(
	kind: 'image' | 'audio',
	fileName: string,
	altText: string,
): string {
	if (kind === 'audio') {
		return `[sound:${fileName}]`;
	}
	return `<img src="${escapeHtml(fileName)}" alt="${escapeHtml(altText)}">`;
}

/**
 * Replace wiki embeds and local markdown images with Anki-ready snippets,
 * collecting media to upload.
 */
export async function preprocessMarkdownMedia(
	app: App,
	markdown: string,
	sourcePath: string,
	options?: MediaProcessOptions,
): Promise<{ markdown: string; assets: MediaAsset[] }> {
	const assets: MediaAsset[] = [];

	const remember = async (
		file: TFile,
		kind: 'image' | 'audio',
	): Promise<MediaAsset> => {
		const existing = assets.find((a) => a.vaultPath === file.path);
		if (existing) {
			return existing;
		}
		const asset = await buildAsset(app, file, kind, options);
		assets.push(asset);
		return asset;
	};

	let text = markdown;

	// ![[file.png|alias]] / ![[file.mp3]] — replace from end to keep indexes valid.
	const wikiMatches = [...text.matchAll(WIKI_EMBED_REGEXP)];
	for (let i = wikiMatches.length - 1; i >= 0; i--) {
		const match = wikiMatches[i];
		if (!match || match.index === undefined) {
			continue;
		}
		const raw = match[1] ?? '';
		const { linkPath, alias } = parseLinkTarget(raw);
		const file = resolveVaultFile(app, linkPath, sourcePath);
		if (!file) {
			continue;
		}
		const kind = mediaKindForExtension(file.extension);
		if (!kind) {
			continue;
		}
		const asset = await remember(file, kind);
		const snippet = mediaSnippet(
			kind,
			asset.fileName,
			alias || file.basename,
		);
		text =
			text.slice(0, match.index) +
			snippet +
			text.slice(match.index + match[0].length);
	}

	// ![alt](relative-or-wikilink)
	const mdMatches = [...text.matchAll(MD_IMAGE_REGEXP)];
	for (let i = mdMatches.length - 1; i >= 0; i--) {
		const match = mdMatches[i];
		if (!match || match.index === undefined) {
			continue;
		}
		const alt = match[1] ?? '';
		const src = (match[2] ?? '').trim().replace(/^<|>$/g, '');
		if (!src || /^https?:\/\//i.test(src) || src.startsWith('data:')) {
			continue;
		}
		let decoded = src;
		try {
			decoded = decodeURIComponent(src);
		} catch {
			decoded = src;
		}
		const file = resolveVaultFile(app, decoded, sourcePath);
		if (!file) {
			continue;
		}
		const kind = mediaKindForExtension(file.extension);
		if (!kind) {
			continue;
		}
		const asset = await remember(file, kind);
		const snippet = mediaSnippet(kind, asset.fileName, alt || file.basename);
		text =
			text.slice(0, match.index) +
			snippet +
			text.slice(match.index + match[0].length);
	}

	return { markdown: text, assets };
}

/**
 * Scan rendered HTML for remaining vault media (internal embeds / app:// imgs)
 * and rewrite src to Anki media filenames.
 */
export async function processRenderedHtmlMedia(
	app: App,
	html: string,
	sourcePath: string,
	options?: MediaProcessOptions,
): Promise<{ html: string; assets: MediaAsset[] }> {
	if (!html.trim()) {
		return { html, assets: [] };
	}

	const host = document.createElement('div');
	host.innerHTML = html;
	const assets: MediaAsset[] = [];
	const seen = new Set<string>();

	const remember = async (
		file: TFile,
		kind: 'image' | 'audio',
	): Promise<MediaAsset | null> => {
		if (seen.has(file.path)) {
			return assets.find((a) => a.vaultPath === file.path) ?? null;
		}
		seen.add(file.path);
		const asset = await buildAsset(app, file, kind, options);
		assets.push(asset);
		return asset;
	};

	const tryResolveFromAttr = (raw: string | null): TFile | null => {
		if (!raw) {
			return null;
		}
		let candidate = raw.trim();
		if (
			!candidate ||
			/^https?:\/\//i.test(candidate) ||
			candidate.startsWith('data:')
		) {
			return null;
		}
		// app://local/.../vaultRelative or app://obsidian.md/...
		if (candidate.startsWith('app://')) {
			try {
				const url = new URL(candidate);
				candidate = decodeURIComponent(url.pathname).replace(/^\/+/, '');
				// Windows: /C:/Users/... — try to strip vault base if present.
				const adapter = app.vault.adapter as { basePath?: string };
				if (adapter.basePath) {
					const base = adapter.basePath.replace(/\\/g, '/');
					const norm = candidate.replace(/\\/g, '/');
					const idx = norm.toLowerCase().indexOf(base.toLowerCase());
					if (idx >= 0) {
						candidate = norm
							.slice(idx + base.length)
							.replace(/^\/+/, '');
					}
				}
			} catch {
				return null;
			}
		}
		candidate = candidate.replace(/\\/g, '/');
		return resolveVaultFile(app, candidate, sourcePath);
	};

	// Internal embeds often expose vault-relative path on the span.
	for (const embed of Array.from(
		host.querySelectorAll<HTMLElement>(
			'span.internal-embed.media-embed, span.image-embed, span.audio-embed, span.media-embed',
		),
	)) {
		const embedSrc =
			embed.getAttribute('src') ||
			embed.getAttribute('alt') ||
			'';
		const file = tryResolveFromAttr(embedSrc);
		if (!file) {
			continue;
		}
		const kind = mediaKindForExtension(file.extension);
		if (!kind) {
			continue;
		}
		const asset = await remember(file, kind);
		if (!asset) {
			continue;
		}
		if (kind === 'audio') {
			embed.replaceWith(
				document.createTextNode(`[sound:${asset.fileName}]`),
			);
		} else {
			const img = document.createElement('img');
			img.setAttribute('src', asset.fileName);
			img.setAttribute(
				'alt',
				embed.getAttribute('alt') || file.basename,
			);
			embed.replaceWith(img);
		}
	}

	for (const img of Array.from(host.querySelectorAll('img'))) {
		const src = img.getAttribute('src');
		// Already rewritten to flat Anki filename (no path / protocol).
		if (src && !src.includes('/') && !src.includes(':') && !src.includes('\\')) {
			continue;
		}
		const file =
			tryResolveFromAttr(src) ||
			tryResolveFromAttr(
				img.closest('.internal-embed')?.getAttribute('src') ?? null,
			);
		if (!file) {
			continue;
		}
		const kind = mediaKindForExtension(file.extension);
		if (kind !== 'image') {
			continue;
		}
		const asset = await remember(file, kind);
		if (!asset) {
			continue;
		}
		img.setAttribute('src', asset.fileName);
	}

	for (const el of Array.from(
		host.querySelectorAll('audio, source, video'),
	)) {
		const src = el.getAttribute('src');
		const file = tryResolveFromAttr(src);
		if (!file) {
			continue;
		}
		const kind = mediaKindForExtension(file.extension);
		if (kind !== 'audio') {
			continue;
		}
		const asset = await remember(file, kind);
		if (!asset) {
			continue;
		}
		el.replaceWith(document.createTextNode(`[sound:${asset.fileName}]`));
	}

	return { html: host.innerHTML, assets };
}

export function dedupeMediaAssets(assets: MediaAsset[]): MediaAsset[] {
	const map = new Map<string, MediaAsset>();
	for (const asset of assets) {
		map.set(asset.vaultPath, asset);
	}
	return [...map.values()];
}
