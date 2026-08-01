import { App, FuzzySuggestModal } from 'obsidian';
import { listVaultFolders } from '../../domain/scanFilters';

/** Fuzzy folder picker for scan-scope settings. */
export class FolderSuggestModal extends FuzzySuggestModal<string> {
	private readonly onPick: (path: string) => void;
	private readonly excluded: Set<string>;

	constructor(
		app: App,
		onPick: (path: string) => void,
		excluded: string[] = [],
	) {
		super(app);
		this.onPick = onPick;
		this.excluded = new Set(
			excluded.map((p) => p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || './'),
		);
		this.setPlaceholder('输入以筛选文件夹…');
	}

	getItems(): string[] {
		return listVaultFolders(this.app).filter((path) => {
			const key = path === './' ? './' : path.replace(/^\/+|\/+$/g, '');
			return !this.excluded.has(key) && !this.excluded.has(path);
		});
	}

	getItemText(path: string): string {
		return path;
	}

	onChooseItem(path: string): void {
		this.onPick(path);
	}
}
