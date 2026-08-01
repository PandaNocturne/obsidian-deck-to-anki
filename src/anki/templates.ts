/** Anki note type id (built-in or user-defined). */
export type DeckTemplateId = string;

export type BuiltInDeckTemplateId = 'ob-deck-basic' | 'ob-deck-basic++';

export const BUILT_IN_DECK_TEMPLATE_IDS: BuiltInDeckTemplateId[] = [
	'ob-deck-basic',
	'ob-deck-basic++',
];

/** @deprecated Prefer BUILT_IN_DECK_TEMPLATE_IDS + custom list from settings. */
export const DECK_TEMPLATE_IDS: BuiltInDeckTemplateId[] =
	BUILT_IN_DECK_TEMPLATE_IDS;

export const BUILT_IN_DECK_TEMPLATE_LABELS: Record<
	BuiltInDeckTemplateId,
	string
> = {
	'ob-deck-basic': 'ob-deck-basic',
	'ob-deck-basic++': 'ob-deck-basic++',
};

/** @deprecated Prefer deckTemplateLabel(). */
export const DECK_TEMPLATE_LABELS: Record<BuiltInDeckTemplateId, string> =
	BUILT_IN_DECK_TEMPLATE_LABELS;

export function isBuiltInDeckTemplate(
	id: string,
): id is BuiltInDeckTemplateId {
	return (BUILT_IN_DECK_TEMPLATE_IDS as string[]).includes(id);
}

export function allDeckTemplateIds(
	customIds: string[] | undefined | null,
): DeckTemplateId[] {
	const custom = (customIds ?? [])
		.map((id) => id.trim())
		.filter((id) => id.length > 0 && !isBuiltInDeckTemplate(id));
	return [...BUILT_IN_DECK_TEMPLATE_IDS, ...custom];
}

/**
 * Ordered template ids for UI / sync.
 * Keeps user order, then appends any missing builtins, then missing customs.
 */
export function normalizeDeckTemplateOrder(
	order: string[] | undefined | null,
	customIds: string[] | undefined | null,
): DeckTemplateId[] {
	const custom = [
		...new Set(
			(customIds ?? [])
				.map((id) => sanitizeDeckTemplateId(String(id)))
				.filter((id) => id.length > 0 && !isBuiltInDeckTemplate(id)),
		),
	];
	const allowed = new Set<string>([
		...BUILT_IN_DECK_TEMPLATE_IDS,
		...custom,
	]);
	const seen = new Set<string>();
	const out: DeckTemplateId[] = [];
	for (const raw of order ?? []) {
		const id = sanitizeDeckTemplateId(String(raw));
		if (!id || seen.has(id) || !allowed.has(id)) {
			continue;
		}
		seen.add(id);
		out.push(id);
	}
	for (const id of BUILT_IN_DECK_TEMPLATE_IDS) {
		if (!seen.has(id)) {
			seen.add(id);
			out.push(id);
		}
	}
	for (const id of custom) {
		if (!seen.has(id)) {
			seen.add(id);
			out.push(id);
		}
	}
	return out;
}

export function allDeckTemplateIdsOrdered(settings: {
	deckTemplateOrder?: string[] | null;
	customDeckTemplates?: string[] | null;
}): DeckTemplateId[] {
	return normalizeDeckTemplateOrder(
		settings.deckTemplateOrder,
		settings.customDeckTemplates,
	);
}

export function deckTemplateLabel(id: string): string {
	if (isBuiltInDeckTemplate(id)) {
		return BUILT_IN_DECK_TEMPLATE_LABELS[id];
	}
	return id;
}

/** Sanitize user input into an Anki model name. */
export function sanitizeDeckTemplateId(raw: string): string {
	return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Field names on ob-deck-* models.
 * Parse fields: head / front / back / tags
 * Custom fields: backlink (card jump) / tree (deck crumbs)
 */
export const MODEL_FIELDS = [
	'ob-deck-head',
	'ob-deck-front',
	'ob-deck-back',
	'ob-deck-tags',
	'ob-deck-backlink',
	'ob-deck-tree',
] as const;

export type ModelFieldName = (typeof MODEL_FIELDS)[number];

export const FIELD_HEAD: ModelFieldName = 'ob-deck-head';
export const FIELD_FRONT: ModelFieldName = 'ob-deck-front';
export const FIELD_BACK: ModelFieldName = 'ob-deck-back';
export const FIELD_TAGS: ModelFieldName = 'ob-deck-tags';
/** Link that opens the current card in Obsidian. */
export const FIELD_BACKLINK: ModelFieldName = 'ob-deck-backlink';
/** Deck tree crumbs (一级 > 牌组2 > …). */
export const FIELD_TREE: ModelFieldName = 'ob-deck-tree';

export interface DeckTemplateStyle {
	/** Anki card Front side HTML. */
	front: string;
	/** Anki card Back side HTML. */
	back: string;
	/** Model CSS. */
	css: string;
	/** Create reversible Card 2 (like ob-deck-basic++). */
	reversible?: boolean;
	/**
	 * Card interaction kind.
	 * Currently only `qa` is implemented; others are reserved.
	 */
	kind?: DeckCardKind;
}

/** Template card kinds shown in settings. */
export type DeckCardKind = 'qa' | 'truefalse' | 'choice' | 'cloze';

export const DECK_CARD_KIND_IDS: DeckCardKind[] = [
	'qa',
	'truefalse',
	'choice',
	'cloze',
];

export const DECK_CARD_KIND_LABELS: Record<DeckCardKind, string> = {
	qa: '问答型',
	truefalse: '判断型',
	choice: '选择型',
	cloze: '填空型',
};

/** Which kinds are selectable today. */
export const DECK_CARD_KIND_AVAILABLE: Record<DeckCardKind, boolean> = {
	qa: true,
	truefalse: false,
	choice: false,
	cloze: false,
};

export function normalizeDeckCardKind(
	value: string | undefined | null,
): DeckCardKind {
	if (value && (DECK_CARD_KIND_IDS as string[]).includes(value)) {
		return value as DeckCardKind;
	}
	return 'qa';
}

export function isReversibleDeckTemplate(
	id: string,
	style?: DeckTemplateStyle | null,
): boolean {
	if (id === 'ob-deck-basic++') {
		return true;
	}
	return style?.reversible === true;
}

export const DEFAULT_CARD_CSS = `.card {
  font-family: "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
    system-ui, -apple-system, sans-serif;
  font-size: 18px;
  line-height: 1.6;
  color: #1f2937;
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
  margin: 0 0 0.65rem;
}

.dta-title > *:first-child {
  margin-top: 0;
}

.dta-title > *:last-child {
  margin-bottom: 0;
}

.dta-front {
  text-align: left;
  color: #334155;
  margin: 0 0 0.35rem;
}

.dta-front > *:first-child {
  margin-top: 0;
}

.dta-front > *:last-child {
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

.dta-tree,
.dta-backlink {
  text-align: center;
  margin: 0.55rem 0 0;
  font-size: 0.78em;
  line-height: 1.45;
  color: #64748b;
}

.dta-deck-sep {
  color: #94a3b8;
  margin: 0 0.15em;
  user-select: none;
}

.dta-deck-crumb {
  color: #64748b;
}

.dta-tree a,
.dta-backlink a,
.dta-deck-backlink,
.dta-card-backlink {
  color: #64748b;
  text-decoration: none;
  border-bottom: 1px dashed rgba(100, 116, 139, 0.55);
}

.dta-tree a:hover,
.dta-backlink a:hover,
.dta-deck-backlink:hover,
.dta-card-backlink:hover {
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

.nightMode .dta-front,
.nightMode .dta-answer {
  color: #cbd5e1;
}

.nightMode .dta-tags {
  color: #a5b4fc;
}

.nightMode .dta-tree,
.nightMode .dta-backlink,
.nightMode .dta-tree a,
.nightMode .dta-backlink a,
.nightMode .dta-deck-backlink,
.nightMode .dta-card-backlink,
.nightMode .dta-deck-crumb {
  color: #94a3b8;
}

.nightMode .dta-deck-sep {
  color: #64748b;
}

.nightMode .dta-tree a:hover,
.nightMode .dta-backlink a:hover,
.nightMode .dta-deck-backlink:hover,
.nightMode .dta-card-backlink:hover {
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

.dta-card table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
  font-size: 0.9em;
  text-align: left;
}

.dta-card th,
.dta-card td {
  padding: 0.65rem 0.85rem;
  border: 1px solid rgba(148, 163, 184, 0.3);
}

.dta-card th {
  font-weight: 600;
  color: #0f172a;
  background-color: #f8fafc;
}

.dta-card td {
  color: #334155;
}

.dta-card tr:nth-child(even) td {
  background-color: rgba(248, 250, 252, 0.6);
}

.nightMode .dta-card th,
.nightMode .dta-card td {
  border-color: rgba(71, 85, 105, 0.45);
}

.nightMode .dta-card th {
  color: #f8fafc;
  background-color: rgba(30, 41, 59, 0.8);
}

.nightMode .dta-card td {
  color: #cbd5e1;
}

.nightMode .dta-card tr:nth-child(even) td {
  background-color: rgba(30, 41, 59, 0.3);
}

`;

export const DEFAULT_CARD_FRONT = `<div class="dta-card">
  {{#ob-deck-head}}
  <div class="dta-title">{{ob-deck-head}}</div>
  {{/ob-deck-head}}
  {{#ob-deck-front}}
  <div class="dta-front">{{ob-deck-front}}</div>
  {{/ob-deck-front}}
  {{#ob-deck-tags}}
  <div class="dta-tags">{{ob-deck-tags}}</div>
  {{/ob-deck-tags}}
  {{#ob-deck-tree}}
  <div class="dta-tree">{{ob-deck-tree}}</div>
  {{/ob-deck-tree}}
  {{#ob-deck-backlink}}
  <div class="dta-backlink">{{ob-deck-backlink}}</div>
  {{/ob-deck-backlink}}
</div>
`;

export const DEFAULT_CARD_BACK = `<div class="dta-card">
  {{#ob-deck-head}}
  <div class="dta-title">{{ob-deck-head}}</div>
  {{/ob-deck-head}}
  {{#ob-deck-front}}
  <div class="dta-front">{{ob-deck-front}}</div>
  {{/ob-deck-front}}
  <div class="dta-divider"></div>
  <div class="dta-answer">{{ob-deck-back}}</div>
  {{#ob-deck-tags}}
  <div class="dta-tags">{{ob-deck-tags}}</div>
  {{/ob-deck-tags}}
  {{#ob-deck-tree}}
  <div class="dta-tree">{{ob-deck-tree}}</div>
  {{/ob-deck-tree}}
  {{#ob-deck-backlink}}
  <div class="dta-backlink">{{ob-deck-backlink}}</div>
  {{/ob-deck-backlink}}
</div>
`;

export function defaultStyleFor(id: DeckTemplateId): DeckTemplateStyle {
	return {
		front: DEFAULT_CARD_FRONT,
		back: DEFAULT_CARD_BACK,
		css: DEFAULT_CARD_CSS,
		reversible: id === 'ob-deck-basic++',
		kind: 'qa',
	};
}

export function createDefaultDeckTemplateStyles(): Record<
	string,
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
