import type { Plugin } from 'obsidian';

/** Persisted compressed (or original) bytes for Anki upload / field compare. */
export interface MediaCompressCacheEntry {
	/** Anki media extension to use (`jpg` when compressed). */
	ext: string;
	/** Payload for storeMediaFile (never written to vault notes). */
	dataBase64: string;
	/** Unix ms when cached. */
	cachedAt: number;
}

interface CacheFileShape {
	version: 1;
	entries: Record<string, MediaCompressCacheEntry>;
}

const CACHE_VERSION = 1 as const;
const MAX_ENTRIES = 400;
const SAVE_DEBOUNCE_MS = 600;

/**
 * Content-hash keyed cache so compress → Anki filename stays stable across
 * sync and status checks (avoids PNG/JPEG flip-flop marking cards modified).
 */
export class MediaCompressCache {
	private entries = new Map<string, MediaCompressCacheEntry>();
	private saveTimer: number | null = null;
	private loaded = false;

	constructor(private readonly plugin: Plugin) {}

	get size(): number {
		return this.entries.size;
	}

	static cacheKey(contentHash: string, quality: number): string {
		const q = Math.min(100, Math.max(1, Math.round(quality)));
		return `${contentHash}:q${q}`;
	}

	get(key: string): MediaCompressCacheEntry | undefined {
		return this.entries.get(key);
	}

	set(key: string, entry: MediaCompressCacheEntry): void {
		this.entries.delete(key);
		this.entries.set(key, entry);
		this.trimIfNeeded();
		this.scheduleSave();
	}

	clear(): void {
		this.entries.clear();
		this.scheduleSave(true);
	}

	async load(): Promise<void> {
		if (this.loaded) {
			return;
		}
		this.loaded = true;
		try {
			const raw = await this.plugin.app.vault.adapter.read(
				this.filePath(),
			);
			const parsed = JSON.parse(raw) as CacheFileShape;
			if (parsed?.version !== CACHE_VERSION || !parsed.entries) {
				return;
			}
			this.entries.clear();
			for (const [key, entry] of Object.entries(parsed.entries)) {
				if (
					entry &&
					typeof entry.ext === 'string' &&
					typeof entry.dataBase64 === 'string'
				) {
					this.entries.set(key, {
						ext: entry.ext,
						dataBase64: entry.dataBase64,
						cachedAt:
							typeof entry.cachedAt === 'number'
								? entry.cachedAt
								: Date.now(),
					});
				}
			}
		} catch {
			// Missing file or corrupt — start empty.
		}
	}

	async saveNow(): Promise<void> {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		const payload: CacheFileShape = {
			version: CACHE_VERSION,
			entries: Object.fromEntries(this.entries),
		};
		const path = this.filePath();
		const body = JSON.stringify(payload);
		try {
			await this.plugin.app.vault.adapter.write(path, body);
		} catch {
			// Plugin dir may be unwritable on some hosts; ignore.
		}
	}

	private scheduleSave(immediate = false): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		if (immediate) {
			void this.saveNow();
			return;
		}
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.saveNow();
		}, SAVE_DEBOUNCE_MS);
	}

	private trimIfNeeded(): void {
		while (this.entries.size > MAX_ENTRIES) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.entries.delete(oldest);
		}
	}

	private filePath(): string {
		const dir = this.plugin.manifest.dir?.replace(/\\/g, '/') ?? '';
		const base = dir.replace(/\/$/, '');
		return `${base}/media-compress-cache.json`;
	}
}

/** SHA-256 hex (truncated) of file bytes for cache lookup. */
export async function hashFileContent(data: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data);
	const bytes = new Uint8Array(digest);
	let hex = '';
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i]!.toString(16).padStart(2, '0');
	}
	return hex.slice(0, 24);
}
