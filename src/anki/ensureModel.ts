import type { AnkiConnectClient } from './AnkiConnectClient';
import {
	MODEL_FIELDS,
	swapFrontBackFields,
	type DeckTemplateId,
	type DeckTemplateStyle,
} from './templates';

function buildCardTemplates(
	templateId: DeckTemplateId,
	style: DeckTemplateStyle,
): Array<{ Name: string; Front: string; Back: string }> {
	if (templateId === 'ob-deck-basic++') {
		return [
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
		];
	}
	return [
		{
			Name: 'Card 1',
			Front: style.front,
			Back: style.back,
		},
	];
}

/** Add any missing ob-deck-* fields on an existing Anki note type. */
async function ensureModelFields(
	client: AnkiConnectClient,
	templateId: DeckTemplateId,
): Promise<void> {
	const existing = new Set(await client.modelFieldNames(templateId));
	for (const fieldName of MODEL_FIELDS) {
		if (existing.has(fieldName)) {
			continue;
		}
		await client.modelFieldAdd(templateId, fieldName);
	}
}

/**
 * Ensure the selected ob-deck model exists in Anki.
 * Templates/CSS are applied on first create, or whenever `force` is true.
 */
export async function ensureDeckTemplateModel(
	client: AnkiConnectClient,
	templateId: DeckTemplateId,
	style: DeckTemplateStyle,
	force = false,
): Promise<'created' | 'updated' | 'exists'> {
	const models = await client.modelNames();
	const exists = models.includes(templateId);
	const cardTemplates = buildCardTemplates(templateId, style);

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

	await ensureModelFields(client, templateId);

	// Use live template names from Anki (may not be exactly "Card 1").
	const live = await client.modelTemplates(templateId);
	const liveNames = Object.keys(live);
	const templatesMap: Record<string, { Front: string; Back: string }> = {};

	if (liveNames.length === 0) {
		templatesMap['Card 1'] = { Front: style.front, Back: style.back };
		if (templateId === 'ob-deck-basic++') {
			templatesMap['Card 2'] = {
				Front: swapFrontBackFields(style.front),
				Back: swapFrontBackFields(style.back),
			};
		}
	} else {
		const primary = liveNames[0]!;
		templatesMap[primary] = { Front: style.front, Back: style.back };
		if (templateId === 'ob-deck-basic++' && liveNames[1]) {
			templatesMap[liveNames[1]] = {
				Front: swapFrontBackFields(style.front),
				Back: swapFrontBackFields(style.back),
			};
		}
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
