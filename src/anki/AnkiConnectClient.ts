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
	constructor(private readonly getBaseUrl: () => string) {}

	async ping(): Promise<number> {
		return this.invoke<number>('version', {});
	}

	async modelNames(): Promise<string[]> {
		return this.invoke<string[]>('modelNames', {});
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
	}): Promise<number> {
		const noteId = await this.invoke<number | null>('addNote', {
			note: {
				deckName: input.deckName,
				modelName: input.modelName,
				fields: input.fields,
				tags: input.tags,
				options: {
					allowDuplicate: false,
					duplicateScope: 'deck',
				},
			},
		});
		if (noteId == null) {
			throw new AnkiConnectError('addNote returned null (duplicate?)');
		}
		return noteId;
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

	async notesInfo(noteIds: number[]): Promise<
		Array<{
			noteId: number;
			cards: number[];
			tags: string[];
			modelName: string;
		}>
	> {
		if (noteIds.length === 0) {
			return [];
		}
		const raw = await this.invoke<
			Array<{
				noteId?: number;
				cards?: number[];
				tags?: string[];
				modelName?: string;
			} | null>
		>('notesInfo', { notes: noteIds });

		return raw.flatMap((entry) => {
			if (!entry || typeof entry.noteId !== 'number') {
				return [];
			}
			return [
				{
					noteId: entry.noteId,
					cards: Array.isArray(entry.cards) ? entry.cards : [],
					tags: Array.isArray(entry.tags) ? entry.tags : [],
					modelName: entry.modelName ?? '',
				},
			];
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
