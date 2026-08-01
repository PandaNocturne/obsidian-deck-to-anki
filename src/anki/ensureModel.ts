import type { AnkiConnectClient } from './AnkiConnectClient';
import {
	FIELD_BACK,
	FIELD_FRONT,
	FIELD_TREE,
	MODEL_FIELDS,
	isReversibleDeckTemplate,
	swapFrontBackFields,
	type DeckTemplateId,
	type DeckTemplateStyle,
} from './templates';

/** Legacy field names from earlier plugin versions. */
const LEGACY_FIELD_RENAMES: Array<{ from: string; to: string }> = [
	{ from: 'Front', to: FIELD_FRONT },
	{ from: 'Back', to: FIELD_BACK },
	/** Old DeckBacklink / tree lived in backlink; tree is now ob-deck-tree. */
	{ from: 'DeckBacklink', to: FIELD_TREE },
];

function buildCardTemplates(
	templateId: DeckTemplateId,
	style: DeckTemplateStyle,
): Array<{ Name: string; Front: string; Back: string }> {
	if (isReversibleDeckTemplate(templateId, style)) {
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

/**
 * Migrate legacy Front/Back/DeckBacklink → ob-deck-* and add any missing fields.
 * Safe to call on every sync.
 */
export async function ensureModelFields(
	client: AnkiConnectClient,
	templateId: DeckTemplateId,
): Promise<string[]> {
	let existing = await client.modelFieldNames(templateId);
	const warnings: string[] = [];

	for (const { from, to } of LEGACY_FIELD_RENAMES) {
		const hasOld = existing.includes(from);
		const hasNew = existing.includes(to);
		if (hasOld && !hasNew) {
			try {
				await client.modelFieldRename(templateId, from, to);
			} catch (error) {
				const msg =
					error instanceof Error ? error.message : String(error);
				warnings.push(`重命名字段 ${from}→${to} 失败：${msg}`);
				// Fall through to modelFieldAdd below.
			}
			existing = await client.modelFieldNames(templateId);
		}
	}

	existing = await client.modelFieldNames(templateId);
	const have = new Set(existing);
	for (const fieldName of MODEL_FIELDS) {
		if (have.has(fieldName)) {
			continue;
		}
		try {
			await client.modelFieldAdd(templateId, fieldName);
			have.add(fieldName);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			throw new Error(
				`笔记类型 ${templateId} 缺少字段 ${fieldName}，自动添加失败：${msg}`,
			);
		}
	}

	// Card mode leaves head empty; AnkiConnect requires fields[0] non-empty.
	existing = await client.modelFieldNames(templateId);
	if (existing[0] !== FIELD_FRONT && existing.includes(FIELD_FRONT)) {
		try {
			await client.modelFieldReposition(templateId, FIELD_FRONT, 0);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			warnings.push(
				`调整字段顺序 ${FIELD_FRONT}→首位失败：${msg}`,
			);
		}
	}

	return warnings;
}

/**
 * Ensure the selected ob-deck model exists in Anki.
 * Always migrates/adds ob-deck-* fields when the model already exists.
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

	// Existing models must gain the new field names before any note sync.
	await ensureModelFields(client, templateId);

	if (!force) {
		return 'exists';
	}

	// Use live template names from Anki (may not be exactly "Card 1").
	const live = await client.modelTemplates(templateId);
	const liveNames = Object.keys(live);
	const templatesMap: Record<string, { Front: string; Back: string }> = {};

	if (liveNames.length === 0) {
		templatesMap['Card 1'] = { Front: style.front, Back: style.back };
		if (isReversibleDeckTemplate(templateId, style)) {
			templatesMap['Card 2'] = {
				Front: swapFrontBackFields(style.front),
				Back: swapFrontBackFields(style.back),
			};
		}
	} else {
		const primary = liveNames[0]!;
		templatesMap[primary] = { Front: style.front, Back: style.back };
		if (isReversibleDeckTemplate(templateId, style)) {
			const second = liveNames[1] ?? 'Card 2';
			templatesMap[second] = {
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
