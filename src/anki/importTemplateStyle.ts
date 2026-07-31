import type { AnkiConnectClient } from './AnkiConnectClient';
import {
	defaultStyleFor,
	isReversibleDeckTemplate,
	normalizeDeckCardKind,
	swapFrontBackFields,
	type DeckTemplateStyle,
} from './templates';

/**
 * Pull Front / Back / CSS from an existing Anki note type into local style.
 */
export async function importDeckTemplateStyleFromAnki(
	client: AnkiConnectClient,
	modelName: string,
	previous?: DeckTemplateStyle | null,
): Promise<DeckTemplateStyle> {
	const models = await client.modelNames();
	if (!models.includes(modelName)) {
		throw new Error(`Anki 中不存在笔记类型「${modelName}」`);
	}

	const templates = await client.modelTemplates(modelName);
	const names = Object.keys(templates);
	if (names.length === 0) {
		throw new Error(`笔记类型「${modelName}」没有卡片模板`);
	}

	const primary = templates[names[0]!]!;
	const front = primary.Front ?? '';
	const back = primary.Back ?? '';

	let reversible = isReversibleDeckTemplate(modelName, previous);
	if (names.length >= 2) {
		const second = templates[names[1]!]!;
		const expectFront = swapFrontBackFields(front);
		const expectBack = swapFrontBackFields(back);
		if (
			(second.Front ?? '') === expectFront &&
			(second.Back ?? '') === expectBack
		) {
			reversible = true;
		} else if (names.length >= 2) {
			reversible = true;
		}
	} else if (modelName !== 'ob-deck-basic++') {
		reversible = false;
	}

	const styling = await client.modelStyling(modelName);
	const css = styling.css ?? '';

	return {
		front,
		back,
		css,
		reversible: modelName === 'ob-deck-basic++' ? true : reversible,
		kind: normalizeDeckCardKind(previous?.kind),
	};
}

export function blankCustomTemplateStyle(): DeckTemplateStyle {
	const base = defaultStyleFor('ob-deck-basic');
	return {
		front: base.front,
		back: base.back,
		css: base.css,
		reversible: false,
		kind: 'qa',
	};
}
