import { App, FuzzySuggestModal } from 'obsidian';
import { listVaultTags } from '../../domain/scanFilters';

/** Fuzzy tag picker for scan-scope settings. */
export class TagSuggestModal extends FuzzySuggestModal<string> {
	private readonly onPick: (tag: string) => void;
	private readonly excluded: Set<string>;

	constructor(
		app: App,
		onPick: (tag: string) => void,
		excluded: string[] = [],
	) {
		super(app);
		this.onPick = onPick;
		this.excluded = new Set(
			excluded.map((t) => t.replace(/^#/, '').toLowerCase()),
		);
		this.setPlaceholder('输入以筛选标签…');
	}

	getItems(): string[] {
		return listVaultTags(this.app).filter(
			(tag) => !this.excluded.has(tag.toLowerCase()),
		);
	}

	getItemText(tag: string): string {
		return `#${tag}`;
	}

	onChooseItem(tag: string): void {
		this.onPick(tag);
	}
}
