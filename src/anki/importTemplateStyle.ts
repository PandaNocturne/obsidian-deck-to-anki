import type { AnkiConnectClient } from './AnkiConnectClient';
import {
	DEFAULT_REVERSE_CARD_BACK,
	DEFAULT_REVERSE_CARD_FRONT,
	defaultStyleFor,
	isBuiltInDeckTemplate,
	isReversibleDeckTemplate,
	normalizeDeckCardKind,
	type DeckTemplateStyle,
} from './templates';

/**
 * Pull Front / Back / CSS (and Card 2 reverse HTML when present) from Anki.
 * Built-in `ob-deck-basic` is never treated as reversible, even if Anki still
 * has a leftover Card 2 from older plugin versions.
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

	let reverseFront =
		(previous?.reverseFront ?? '').trim() || DEFAULT_REVERSE_CARD_FRONT;
	let reverseBack =
		(previous?.reverseBack ?? '').trim() || DEFAULT_REVERSE_CARD_BACK;

	const builtinReversible = isBuiltInDeckTemplate(modelName)
		? isReversibleDeckTemplate(modelName)
		: null;
	let reversible =
		builtinReversible ?? isReversibleDeckTemplate(modelName, previous);

	const shouldImportReverse =
		builtinReversible === true ||
		(builtinReversible === null && names.length >= 2);

	if (shouldImportReverse && names.length >= 2) {
		const second = templates[names[1]!]!;
		reverseFront = second.Front ?? reverseFront;
		reverseBack = second.Back ?? reverseBack;
		if (builtinReversible === null) {
			reversible = true;
		}
	} else if (builtinReversible === null) {
		reversible = false;
	}

	const styling = await client.modelStyling(modelName);
	const css = styling.css ?? '';

	return {
		front,
		back,
		reverseFront,
		reverseBack,
		css,
		reversible:
			builtinReversible !== null ? builtinReversible : reversible,
		kind: normalizeDeckCardKind(previous?.kind),
	};
}

export function blankCustomTemplateStyle(): DeckTemplateStyle {
	const base = defaultStyleFor('ob-deck-basic');
	return {
		front: base.front,
		back: base.back,
		reverseFront: base.reverseFront,
		reverseBack: base.reverseBack,
		css: base.css,
		reversible: false,
		kind: 'qa',
	};
}
