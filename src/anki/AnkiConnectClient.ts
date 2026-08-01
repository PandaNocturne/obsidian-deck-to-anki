import { requestUrl } from 'obsidian';

interface AnkiResponse<T> {
	result: T;
	error: string | null;
}

export class AnkiConnectError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AnkiConnectError';
	}
}

/**
 * Thin AnkiConnect (v6) client.
 */
export class AnkiConnectClient {
	constructor(private readonly getBaseUrl: () => string) { }

	async ping(): Promise<number> {
		return this.invoke<number>('version', {});
	}

	async modelNames(): Promise<string[]> {
		return this.invoke<string[]>('modelNames', {});
	}

	async modelTemplates(
		modelName: string,
	): Promise<Record<string, { Front: string; Back: string }>> {
		const result = await this.invoke<
			Record<string, { Front?: string; Back?: string }>
		>('modelTemplates', { modelName });
		const out: Record<string, { Front: string; Back: string }> = {};
		for (const [name, sides] of Object.entries(result ?? {})) {
			out[name] = {
				Front: sides?.Front ?? '',
				Back: sides?.Back ?? '',
			};
		}
		return out;
	}

	async modelStyling(modelName: string): Promise<{ css: string }> {
		const result = await this.invoke<{ css?: string }>('modelStyling', {
			modelName,
		});
		return { css: result?.css ?? '' };
	}

	async modelFieldNames(modelName: string): Promise<string[]> {
		const names = await this.invoke<string[]>('modelFieldNames', {
			modelName,
		});
		return Array.isArray(names) ? names : [];
	}

	async modelFieldAdd(
		modelName: string,
		fieldName: string,
		index?: number,
	): Promise<void> {
		const params: {
			modelName: string;
			fieldName: string;
			index?: number;
		} = {
			modelName,
			fieldName,
		};
		if (index !== undefined) {
			params.index = index;
		}
		await this.invoke('modelFieldAdd', params);
	}

	async modelFieldRename(
		modelName: string,
		oldFieldName: string,
		newFieldName: string,
	): Promise<void> {
		await this.invoke('modelFieldRename', {
			modelName,
			oldFieldName,
			newFieldName,
		});
	}

	/** Move a field within a model (0 = first). */
	async modelFieldReposition(
		modelName: string,
		fieldName: string,
		index: number,
	): Promise<void> {
		await this.invoke('modelFieldReposition', {
			modelName,
			fieldName,
			index,
		});
	}

	async createDeck(deck: string): Promise<void> {
		await this.invoke('createDeck', { deck });
	}

	async createModel(params: {
		modelName: string;
		inOrderFields: string[];
		css: string;
		cardTemplates: Array<{ Name: string; Front: string; Back: string }>;
		isCloze?: boolean;
	}): Promise<void> {
		await this.invoke('createModel', {
			modelName: params.modelName,
			inOrderFields: params.inOrderFields,
			css: params.css,
			isCloze: params.isCloze ?? false,
			cardTemplates: params.cardTemplates,
		});
	}

	async updateModelTemplates(
		modelName: string,
		templates: Record<string, { Front: string; Back: string }>,
	): Promise<void> {
		await this.invoke('updateModelTemplates', {
			model: {
				name: modelName,
				templates,
			},
		});
	}

	/**
	 * Add a card template to an existing model (or update if the name exists).
	 * `updateModelTemplates` cannot create new card types.
	 */
	async modelTemplateAdd(
		modelName: string,
		template: { Name: string; Front: string; Back: string },
	): Promise<void> {
		await this.invoke('modelTemplateAdd', {
			modelName,
			template,
		});
	}

	async updateModelStyling(modelName: string, css: string): Promise<void> {
		await this.invoke('updateModelStyling', {
			model: {
				name: modelName,
				css,
			},
		});
	}

	async addNote(input: {
		deckName: string;
		modelName: string;
		fields: Record<string, string>;
		tags: string[];
		allowDuplicate?: boolean;
	}): Promise<number | null> {
		return this.invoke<number | null>('addNote', {
			note: {
				deckName: input.deckName,
				modelName: input.modelName,
				fields: input.fields,
				tags: input.tags,
				options: {
					allowDuplicate: input.allowDuplicate === true,
					duplicateScope: 'deck',
				},
			},
		});
	}

	async updateNoteFields(
		noteId: number,
		fields: Record<string, string>,
	): Promise<void> {
		await this.invoke('updateNoteFields', {
			note: {
				id: noteId,
				fields,
			},
		});
	}

	async findNotes(query: string): Promise<number[]> {
		const ids = await this.invoke<number[]>('findNotes', { query });
		return Array.isArray(ids) ? ids : [];
	}

	async deleteNotes(noteIds: number[]): Promise<void> {
		if (noteIds.length === 0) {
			return;
		}
		await this.invoke('deleteNotes', { notes: noteIds });
	}

	async notesInfo(noteIds: number[]): Promise<
		Array<{
			noteId: number;
			cards: number[];
			tags: string[];
			modelName: string;
			fields: Record<string, string>;
		}>
	> {
		if (noteIds.length === 0) {
			return [];
		}

		const parse = (
			raw:
				| Array<{
					noteId?: number;
					cards?: number[];
					tags?: string[];
					modelName?: string;
					fields?: Record<string, { value?: string }>;
				} | null>
				| null
				| undefined,
		) => {
			if (!Array.isArray(raw)) {
				return [];
			}
			return raw.flatMap((entry) => {
				if (!entry || typeof entry.noteId !== 'number') {
					return [];
				}
				const fields: Record<string, string> = {};
				for (const [name, value] of Object.entries(entry.fields ?? {})) {
					fields[name] = value?.value ?? '';
				}
				return [
					{
						noteId: entry.noteId,
						cards: Array.isArray(entry.cards) ? entry.cards : [],
						tags: Array.isArray(entry.tags) ? entry.tags : [],
						modelName: entry.modelName ?? '',
						fields,
					},
				];
			});
		};

		try {
			const raw = await this.invoke<
				Array<{
					noteId?: number;
					cards?: number[];
					tags?: string[];
					modelName?: string;
					fields?: Record<string, { value?: string }>;
				} | null>
			>('notesInfo', { notes: noteIds });
			return parse(raw);
		} catch {
			// Deleted / invalid ids: some AnkiConnect builds error the whole
			// batch (or a single id) instead of returning null entries.
			if (noteIds.length === 1) {
				return [];
			}
			const out: Array<{
				noteId: number;
				cards: number[];
				tags: string[];
				modelName: string;
				fields: Record<string, string>;
			}> = [];
			for (const id of noteIds) {
				out.push(...(await this.notesInfo([id])));
			}
			return out;
		}
	}

	/**
	 * Safe single-note lookup. Returns null when the note was deleted or
	 * AnkiConnect errors on a stale id (common after deleting a deck).
	 */
	async noteInfo(
		noteId: number,
	): Promise<{
		noteId: number;
		cards: number[];
		tags: string[];
		modelName: string;
		fields: Record<string, string>;
	} | null> {
		const list = await this.notesInfo([noteId]);
		return list[0] ?? null;
	}

	async listDeckNames(): Promise<string[]> {
		const map = await this.invoke<Record<string, number>>(
			'deckNamesAndIds',
			{},
		);
		return Object.keys(map ?? {});
	}

	async getDeckStats(
		deckNames: string[],
	): Promise<Array<{ deckName: string; noteCount: number }>> {
		if (deckNames.length === 0) {
			return [];
		}
		const deckNamesAndIds = await this.invoke<Record<string, number>>(
			'deckNamesAndIds',
			{},
		);
		const rawStats = await this.invoke<unknown>('getDeckStats', {
			decks: deckNames,
		});

		return deckNames.map((deckName) => ({
			deckName,
			noteCount: extractDeckNoteCount(
				rawStats,
				deckNamesAndIds[deckName],
			),
		}));
	}

	async deleteDecks(deckNames: string[]): Promise<void> {
		const unique = [...new Set(deckNames.filter(Boolean))];
		if (unique.length === 0) {
			return;
		}
		await this.invoke('deleteDecks', {
			decks: unique,
			cardsToo: true,
		});
	}

	async changeDeck(cardIds: number[], deck: string): Promise<void> {
		if (cardIds.length === 0) {
			return;
		}
		await this.invoke('changeDeck', { cards: cardIds, deck });
	}

	async addTags(noteIds: number[], tags: string[]): Promise<void> {
		if (noteIds.length === 0 || tags.length === 0) {
			return;
		}
		await this.invoke('addTags', {
			notes: noteIds,
			tags: tags.join(' '),
		});
	}

	async removeTags(noteIds: number[], tags: string[]): Promise<void> {
		if (noteIds.length === 0 || tags.length === 0) {
			return;
		}
		await this.invoke('removeTags', {
			notes: noteIds,
			tags: tags.join(' '),
		});
	}

	/**
	 * Upload one media file into Anki's collection.media.
	 * Prefer absolute `path` (desktop); fall back to base64 `data`.
	 */
	async storeMediaFile(input: {
		filename: string;
		path?: string;
		data?: string;
	}): Promise<void> {
		const params: Record<string, unknown> = {
			filename: input.filename,
		};
		if (input.path) {
			params.path = input.path;
		} else if (input.data) {
			params.data = input.data;
		} else {
			throw new AnkiConnectError(
				`storeMediaFile 缺少 path/data：${input.filename}`,
			);
		}
		await this.invoke('storeMediaFile', params);
	}

	async storeMediaFiles(
		assets: Array<{
			fileName: string;
			absolutePath?: string;
			dataBase64?: string;
		}>,
	): Promise<void> {
		for (const asset of assets) {
			await this.storeMediaFile({
				filename: asset.fileName,
				path: asset.absolutePath,
				data: asset.dataBase64,
			});
		}
	}

	/**
	 * Open Anki's Card Browser focused on a search query.
	 * Example: `nid:1649198355435` for a single note.
	 */
	async guiBrowse(query: string): Promise<number[]> {
		const ids = await this.invoke<number[]>('guiBrowse', { query });
		return Array.isArray(ids) ? ids : [];
	}

	/** Open browser on a note by Anki note id. */
	async guiBrowseNote(noteId: number): Promise<number[]> {
		return this.guiBrowse(`nid:${noteId}`);
	}

	private async invoke<TResult>(
		action: string,
		params: Record<string, unknown>,
	): Promise<TResult> {
		let response: { json: unknown };
		try {
			response = await requestUrl({
				url: this.getBaseUrl(),
				method: 'POST',
				contentType: 'application/json',
				body: JSON.stringify({
					action,
					version: 6,
					params,
				}),
			});
		} catch (error) {
			const detail =
				error instanceof Error ? error.message : String(error);
			throw new AnkiConnectError(
				`无法连接 AnkiConnect（${this.getBaseUrl()}）：${detail}`,
			);
		}

		const parsed = response.json as AnkiResponse<TResult>;
		if (parsed?.error) {
			throw new AnkiConnectError(parsed.error);
		}
		return parsed.result;
	}
}

function extractDeckNoteCount(
	rawStats: unknown,
	deckId: number | undefined,
): number {
	if (!rawStats || typeof rawStats !== 'object' || typeof deckId !== 'number') {
		return -1;
	}
	const raw = (rawStats as Record<string, unknown>)[String(deckId)];
	if (!raw || typeof raw !== 'object') {
		return -1;
	}
	const total = (raw as { total_in_deck?: unknown }).total_in_deck;
	return typeof total === 'number' && Number.isFinite(total) ? total : -1;
}
