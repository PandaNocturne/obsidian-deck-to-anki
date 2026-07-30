/** Built-in Anki note type ids for this plugin. */
export type DeckTemplateId = 'ob-deck-basic' | 'ob-deck-basic++';

export const DECK_TEMPLATE_IDS: DeckTemplateId[] = [
	'ob-deck-basic',
	'ob-deck-basic++',
];

export const DECK_TEMPLATE_LABELS: Record<DeckTemplateId, string> = {
	'ob-deck-basic': 'ob-deck-basic（普通问答）',
	'ob-deck-basic++': 'ob-deck-basic++（可反转）',
};

/** Field names created on ob-deck-* models. */
export const MODEL_FIELDS = ['Front', 'Back', 'DeckBacklink'] as const;

export interface DeckTemplateStyle {
	/** Anki card Front side HTML. */
	front: string;
	/** Anki card Back side HTML. */
	back: string;
	/** Model CSS. */
	css: string;
}

export const DEFAULT_CARD_CSS = `.card {
  font-family: arial;
  font-size: 20px;
  text-align: center;
  color: black;
  background-color: white;
  line-height: 1.45;
}

.dta-front,
.dta-back {
  text-align: left;
  display: inline-block;
  max-width: 36em;
  width: 100%;
}

.dta-backlink {
  margin-top: 1.25em;
  font-size: 0.75em;
  color: #666;
  text-align: left;
}

.dta-backlink a {
  color: #666;
}

.nightMode .dta-backlink,
.nightMode .dta-backlink a {
  color: #aaa;
}
`;

export const DEFAULT_CARD_FRONT = `<div class="dta-front">{{Front}}</div>
{{#DeckBacklink}}
<div class="dta-backlink">{{DeckBacklink}}</div>
{{/DeckBacklink}}
`;

export const DEFAULT_CARD_BACK = `<div class="dta-front">{{Front}}</div>
<hr>
<div class="dta-back">{{Back}}</div>
{{#DeckBacklink}}
<div class="dta-backlink">{{DeckBacklink}}</div>
{{/DeckBacklink}}
`;

export function defaultStyleFor(_id: DeckTemplateId): DeckTemplateStyle {
	return {
		front: DEFAULT_CARD_FRONT,
		back: DEFAULT_CARD_BACK,
		css: DEFAULT_CARD_CSS,
	};
}

export function createDefaultDeckTemplateStyles(): Record<
	DeckTemplateId,
	DeckTemplateStyle
> {
	return {
		'ob-deck-basic': defaultStyleFor('ob-deck-basic'),
		'ob-deck-basic++': defaultStyleFor('ob-deck-basic++'),
	};
}

/** Swap {{Front}} / {{Back}} for the reverse card of basic++. */
export function swapFrontBackFields(html: string): string {
	return html
		.replace(/\{\{#Front\}\}/g, '{{#__DTA_BACK__}}')
		.replace(/\{\{\/Front\}\}/g, '{{/__DTA_BACK__}}')
		.replace(/\{\{Front\}\}/g, '{{__DTA_BACK__}}')
		.replace(/\{\{#Back\}\}/g, '{{#Front}}')
		.replace(/\{\{\/Back\}\}/g, '{{/Front}}')
		.replace(/\{\{Back\}\}/g, '{{Front}}')
		.replace(/__DTA_BACK__/g, 'Back');
}
