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
export const MODEL_FIELDS = [
	'ob-deck-front',
	'ob-deck-back',
	'ob-deck-backlink',
	'ob-deck-tags',
] as const;

export type ModelFieldName = (typeof MODEL_FIELDS)[number];

export const FIELD_FRONT: ModelFieldName = 'ob-deck-front';
export const FIELD_BACK: ModelFieldName = 'ob-deck-back';
export const FIELD_BACKLINK: ModelFieldName = 'ob-deck-backlink';
export const FIELD_TAGS: ModelFieldName = 'ob-deck-tags';

export interface DeckTemplateStyle {
	/** Anki card Front side HTML. */
	front: string;
	/** Anki card Back side HTML. */
	back: string;
	/** Model CSS. */
	css: string;
}

export const DEFAULT_CARD_CSS = `.card {
  font-family: "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
    system-ui, -apple-system, sans-serif;
  font-size: 18px;
  line-height: 1.6;
  color: #1f2937;
  background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
  padding: 1.25rem 1rem 1.5rem;
  min-height: 100%;
  box-sizing: border-box;
}

.dta-card {
  max-width: 42rem;
  margin: 0 auto;
  padding: 1.35rem 1.5rem 1.25rem;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(148, 163, 184, 0.35);
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 12px 28px rgba(15, 23, 42, 0.06);
}

.dta-title {
  text-align: center;
  font-size: 1.2em;
  font-weight: 650;
  letter-spacing: 0.01em;
  color: #0f172a;
  margin: 0 0 0.85rem;
}

.dta-title > *:first-child {
  margin-top: 0;
}

.dta-title > *:last-child {
  margin-bottom: 0;
}

.dta-divider {
  height: 1px;
  margin: 0.85rem auto 1rem;
  border: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(99, 102, 241, 0.35) 50%,
    transparent 100%
  );
}

.dta-answer {
  text-align: left;
  color: #334155;
  margin: 0 0 1rem;
}

.dta-answer > *:first-child {
  margin-top: 0;
}

.dta-answer > *:last-child {
  margin-bottom: 0;
}

.dta-tags {
  text-align: center;
  margin: 0.85rem 0 0.35rem;
  font-size: 0.78em;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: #6366f1;
  word-break: break-word;
}

.dta-backlink {
  text-align: center;
  margin: 0.75rem 0 0;
  font-size: 0.78em;
  line-height: 1.45;
  color: #64748b;
}

.dta-backlink a,
.dta-deck-backlink {
  color: #64748b;
  text-decoration: none;
  border-bottom: 1px dashed rgba(100, 116, 139, 0.55);
}

.dta-backlink a:hover,
.dta-deck-backlink:hover {
  color: #4f46e5;
  border-bottom-color: rgba(79, 70, 229, 0.7);
}

.dta-card img {
  max-width: 100%;
  height: auto;
  border-radius: 10px;
  display: block;
  margin: 0.65rem auto;
}

.dta-card pre,
.dta-card code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
}

.dta-card pre {
  text-align: left;
  overflow-x: auto;
  padding: 0.75rem 0.9rem;
  border-radius: 10px;
  background: #f1f5f9;
}

.nightMode .card {
  color: #e2e8f0;
  background: linear-gradient(180deg, #0b1220 0%, #111827 100%);
}

.nightMode .dta-card {
  background: rgba(17, 24, 39, 0.92);
  border-color: rgba(71, 85, 105, 0.55);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.25),
    0 14px 32px rgba(0, 0, 0, 0.28);
}

.nightMode .dta-title {
  color: #f8fafc;
}

.nightMode .dta-answer {
  color: #cbd5e1;
}

.nightMode .dta-tags {
  color: #a5b4fc;
}

.nightMode .dta-backlink,
.nightMode .dta-backlink a,
.nightMode .dta-deck-backlink {
  color: #94a3b8;
}

.nightMode .dta-backlink a:hover,
.nightMode .dta-deck-backlink:hover {
  color: #c7d2fe;
}

.nightMode .dta-divider {
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(165, 180, 252, 0.4) 50%,
    transparent 100%
  );
}

.nightMode .dta-card pre {
  background: #1e293b;
}
`;

export const DEFAULT_CARD_FRONT = `<div class="dta-card">
  <div class="dta-title">{{ob-deck-front}}</div>
  {{#ob-deck-tags}}
  <div class="dta-tags">{{ob-deck-tags}}</div>
  {{/ob-deck-tags}}
  {{#ob-deck-backlink}}
  <div class="dta-backlink">{{ob-deck-backlink}}</div>
  {{/ob-deck-backlink}}
</div>
`;

export const DEFAULT_CARD_BACK = `<div class="dta-card">
  <div class="dta-title">{{ob-deck-front}}</div>
  <div class="dta-divider"></div>
  <div class="dta-answer">{{ob-deck-back}}</div>
  {{#ob-deck-tags}}
  <div class="dta-tags">{{ob-deck-tags}}</div>
  {{/ob-deck-tags}}
  {{#ob-deck-backlink}}
  <div class="dta-backlink">{{ob-deck-backlink}}</div>
  {{/ob-deck-backlink}}
</div>
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

/** Swap ob-deck-front / ob-deck-back for the reverse card of basic++. */
export function swapFrontBackFields(html: string): string {
	return html
		.replace(/\{\{#ob-deck-front\}\}/g, '{{#__DTA_BACK__}}')
		.replace(/\{\{\/ob-deck-front\}\}/g, '{{/__DTA_BACK__}}')
		.replace(/\{\{ob-deck-front\}\}/g, '{{__DTA_BACK__}}')
		.replace(/\{\{#ob-deck-back\}\}/g, '{{#ob-deck-front}}')
		.replace(/\{\{\/ob-deck-back\}\}/g, '{{/ob-deck-front}}')
		.replace(/\{\{ob-deck-back\}\}/g, '{{ob-deck-front}}')
		.replace(/__DTA_BACK__/g, 'ob-deck-back');
}
