import type { AnkiConnectClient } from './AnkiConnectClient';
import {
	MODEL_FIELDS,
	swapFrontBackFields,
	type DeckTemplateId,
	type DeckTemplateStyle,
} from './templates';

/**
 * Ensure the selected ob-deck model exists in Anki.
 * Templates/CSS are applied only on first create unless `force` is true.
 */
export async function ensureDeckTemplateModel(
	client: AnkiConnectClient,
	templateId: DeckTemplateId,
	style: DeckTemplateStyle,
	force = false,
): Promise<'created' | 'updated' | 'exists'> {
	const models = await client.modelNames();
	const exists = models.includes(templateId);

	const cardTemplates =
		templateId === 'ob-deck-basic++'
			? [
					{
						Name: 'Card 1',
						Front: style.front,
						Back: style.back,
					},
					{
						Name: 'Card 2',
						Front: swapFrontBackFields(style.front),
						Back: swapFrontBackFields(style.back),
					},
				]
			: [
					{
						Name: 'Card 1',
						Front: style.front,
						Back: style.back,
					},
				];

	if (!exists) {
		await client.createModel({
			modelName: templateId,
			inOrderFields: [...MODEL_FIELDS],
			css: style.css,
			cardTemplates,
		});
		return 'created';
	}

	if (!force) {
		return 'exists';
	}

	const templatesMap: Record<string, { Front: string; Back: string }> = {
		'Card 1': { Front: style.front, Back: style.back },
	};
	if (templateId === 'ob-deck-basic++') {
		templatesMap['Card 2'] = {
			Front: swapFrontBackFields(style.front),
			Back: swapFrontBackFields(style.back),
		};
	}

	try {
		await client.updateModelTemplates(templateId, templatesMap);
	} catch (error) {
		// Some Anki/AnkiConnect combos throw even when the update applied.
		const msg = error instanceof Error ? error.message : String(error);
		if (!msg.includes('save() takes from 1 to 2 positional arguments')) {
			throw error;
		}
	}
	await client.updateModelStyling(templateId, style.css);
	return 'updated';
}
