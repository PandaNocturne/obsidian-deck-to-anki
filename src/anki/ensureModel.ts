import type { AnkiConnectClient } from './AnkiConnectClient';
import {
	CODE_HIGHLIGHT_CSS_FILENAME,
	codeHighlightCssBase64,
	withCodeHighlightLinks,
} from './codeHighlightCss';
import {
	FIELD_BACK,
	FIELD_FRONT,
	FIELD_ID,
	FIELD_TREE,
	MODEL_FIELDS,
	isReversibleDeckTemplate,
	resolveReverseCardSides,
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
		const reverse = resolveReverseCardSides(style);
		return [
			{
				Name: 'Card 1',
				Front: style.front,
				Back: style.back,
			},
			{
				Name: 'Card 2',
				Front: reverse.Front,
				Back: reverse.Back,
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

/** Reposition every known field to MODEL_FIELDS order (id first). */
async function ensureModelFieldOrder(
	client: AnkiConnectClient,
	templateId: DeckTemplateId,
	warnings: string[],
): Promise<void> {
	for (let i = 0; i < MODEL_FIELDS.length; i++) {
		const fieldName = MODEL_FIELDS[i]!;
		const names = await client.modelFieldNames(templateId);
		const at = names.indexOf(fieldName);
		if (at < 0 || at === i) {
			continue;
		}
		try {
			await client.modelFieldReposition(templateId, fieldName, i);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			warnings.push(`调整字段顺序 ${fieldName}→${i} 失败：${msg}`);
		}
	}
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
	for (let i = 0; i < MODEL_FIELDS.length; i++) {
		const fieldName = MODEL_FIELDS[i]!;
		if (have.has(fieldName)) {
			continue;
		}
		try {
			await client.modelFieldAdd(templateId, fieldName, i);
			have.add(fieldName);
		} catch (error) {
			// Older AnkiConnect may not accept index; add then reorder.
			try {
				await client.modelFieldAdd(templateId, fieldName);
				have.add(fieldName);
			} catch (error2) {
				const msg =
					error2 instanceof Error ? error2.message : String(error2);
				const first =
					error instanceof Error ? error.message : String(error);
				throw new Error(
					`笔记类型 ${templateId} 缺少字段 ${fieldName}，自动添加失败：${msg || first}`,
				);
			}
		}
	}

	await ensureModelFieldOrder(client, templateId, warnings);

	const ordered = await client.modelFieldNames(templateId);
	if (ordered[0] !== FIELD_ID) {
		warnings.push(
			`笔记类型 ${templateId} 首字段应为 ${FIELD_ID}（当前为 ${ordered[0] ?? '无'}）`,
		);
	}

	return warnings;
}

/**
 * Ensure reverse Card 2 exists when the style is reversible.
 * `updateModelTemplates` cannot create new card types.
 */
async function ensureReverseCardTemplate(
	client: AnkiConnectClient,
	templateId: DeckTemplateId,
	style: DeckTemplateStyle,
	force: boolean,
): Promise<boolean> {
	if (!isReversibleDeckTemplate(templateId, style)) {
		return false;
	}
	const live = await client.modelTemplates(templateId);
	const liveNames = Object.keys(live);
	const reverse = resolveReverseCardSides(style);
	const missing = liveNames.length < 2;
	if (!missing && !force) {
		return false;
	}
	const name = liveNames[1] ?? 'Card 2';
	await client.modelTemplateAdd(templateId, {
		Name: name,
		Front: reverse.Front,
		Back: reverse.Back,
	});
	return true;
}

/**
 * Drop leftover Card 2+ when the note type is not reversible.
 * Older builds always created Card 2 for every model (including basic).
 */
async function removeExtraReverseCardTemplates(
	client: AnkiConnectClient,
	templateId: DeckTemplateId,
	style: DeckTemplateStyle,
): Promise<boolean> {
	if (isReversibleDeckTemplate(templateId, style)) {
		return false;
	}
	const live = await client.modelTemplates(templateId);
	const liveNames = Object.keys(live);
	if (liveNames.length <= 1) {
		return false;
	}
	// Remove from the end so index shifts do not skip names.
	for (let i = liveNames.length - 1; i >= 1; i--) {
		const name = liveNames[i]!;
		await client.modelTemplateRemove(templateId, name);
	}
	return true;
}

/**
 * Upload Prism/Obsidian token stylesheet into Anki collection.media.
 * Safe to call on every sync — overwrites with the bundled CSS.
 */
export async function ensureCodeHighlightMedia(
	client: AnkiConnectClient,
): Promise<void> {
	await client.storeMediaFile({
		filename: CODE_HIGHLIGHT_CSS_FILENAME,
		data: codeHighlightCssBase64(),
	});
}

/**
 * Ensure the selected ob-deck model exists in Anki.
 * Always migrates/adds ob-deck-* fields when the model already exists.
 * Templates/CSS are applied on first create, or whenever `force` is true.
 * Also uploads `_dta-code-highlight.css` and injects `<link>` into card HTML.
 */
export async function ensureDeckTemplateModel(
	client: AnkiConnectClient,
	templateId: DeckTemplateId,
	style: DeckTemplateStyle,
	force = false,
): Promise<'created' | 'updated' | 'exists'> {
	await ensureCodeHighlightMedia(client);
	const linkedStyle = withCodeHighlightLinks(style);
	const models = await client.modelNames();
	const exists = models.includes(templateId);
	const cardTemplates = buildCardTemplates(templateId, linkedStyle);

	if (!exists) {
		await client.createModel({
			modelName: templateId,
			inOrderFields: [...MODEL_FIELDS],
			css: linkedStyle.css,
			cardTemplates,
		});
		return 'created';
	}

	// Existing models must gain the new field names before any note sync.
	await ensureModelFields(client, templateId);

	const reverseAdded = await ensureReverseCardTemplate(
		client,
		templateId,
		linkedStyle,
		force,
	);
	const reverseRemoved = await removeExtraReverseCardTemplates(
		client,
		templateId,
		linkedStyle,
	);

	if (!force) {
		return reverseAdded || reverseRemoved ? 'updated' : 'exists';
	}

	// Use live template names from Anki (may not be exactly "Card 1").
	const live = await client.modelTemplates(templateId);
	const liveNames = Object.keys(live);
	const templatesMap: Record<string, { Front: string; Back: string }> = {};
	const reverse = resolveReverseCardSides(linkedStyle);

	if (liveNames.length === 0) {
		templatesMap['Card 1'] = {
			Front: linkedStyle.front,
			Back: linkedStyle.back,
		};
		if (isReversibleDeckTemplate(templateId, linkedStyle)) {
			templatesMap['Card 2'] = reverse;
		}
	} else {
		const primary = liveNames[0]!;
		templatesMap[primary] = {
			Front: linkedStyle.front,
			Back: linkedStyle.back,
		};
		if (isReversibleDeckTemplate(templateId, linkedStyle)) {
			const second = liveNames[1] ?? 'Card 2';
			templatesMap[second] = reverse;
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
	await client.updateModelStyling(templateId, linkedStyle.css);
	return 'updated';
}
