import { Notice, setIcon, Setting } from 'obsidian';
import type DeckToAnkiPlugin from '../../../main';
import {
	normalizeFolderPath,
	normalizeTagFilter,
} from '../../domain/scanFilters';
import { FolderSuggestModal } from './FolderSuggestModal';
import { TagSuggestModal } from './TagSuggestModal';

type BeginSection = (
	containerEl: HTMLElement,
	title: string,
	desc?: string,
) => HTMLElement;

interface ScopeListOptions {
	section: HTMLElement;
	name: string;
	desc: string;
	placeholder: string;
	/** Shown when the list is empty. */
	emptyHint?: string;
	/** Lucide icon for the picker button. */
	pickerIcon: string;
	pickerAria: string;
	getItems: () => string[];
	setItems: (items: string[]) => Promise<void>;
	normalize: (raw: string) => string | null;
	/** Format chip label. */
	formatItem?: (item: string) => string;
	openPicker: (excluded: string[], onPick: (value: string) => void) => void;
}

function renderChips(
	host: HTMLElement,
	items: string[],
	emptyHint: string | undefined,
	formatItem: (item: string) => string,
	onRemove: (item: string) => void,
): void {
	host.empty();
	if (items.length === 0) {
		if (emptyHint) {
			host.createSpan({
				cls: 'dta-scope-empty',
				text: emptyHint,
			});
		}
		return;
	}
	for (const item of items) {
		const chip = host.createSpan({ cls: 'dta-scope-chip' });
		chip.createSpan({
			cls: 'dta-scope-chip-text',
			text: formatItem(item),
		});
		const removeBtn = chip.createEl('button', {
			cls: 'dta-scope-chip-remove clickable-icon',
			attr: {
				type: 'button',
				'aria-label': `移除 ${formatItem(item)}`,
				title: '移除',
			},
		});
		setIcon(removeBtn, 'x');
		removeBtn.addEventListener('click', (evt) => {
			evt.preventDefault();
			onRemove(item);
		});
	}
}

function renderScopeListSetting(options: ScopeListOptions): void {
	const {
		section,
		name,
		desc,
		placeholder,
		emptyHint,
		pickerIcon,
		pickerAria,
		getItems,
		setItems,
		normalize,
		formatItem = (item) => item,
		openPicker,
	} = options;

	const setting = new Setting(section).setName(name).setDesc(desc);
	setting.settingEl.addClass('dta-scope-setting');

	const control = setting.controlEl;
	control.empty();
	control.addClass('dta-scope-control');

	const chipsHost = control.createDiv({ cls: 'dta-scope-chips' });
	const row = control.createDiv({ cls: 'dta-scope-row' });

	const input = row.createEl('input', {
		cls: 'dta-scope-input',
		attr: {
			type: 'text',
			placeholder,
			spellcheck: 'false',
		},
	});

	const refreshChips = (): void => {
		renderChips(chipsHost, getItems(), emptyHint, formatItem, (item) => {
			void (async () => {
				const next = getItems().filter((x) => x !== item);
				await setItems(next);
				refreshChips();
			})();
		});
	};

	const tryAdd = async (raw: string): Promise<void> => {
		const value = normalize(raw);
		if (!value) {
			new Notice('无效的路径或标签');
			return;
		}
		const current = getItems();
		const exists = current.some(
			(x) => x.toLowerCase() === value.toLowerCase(),
		);
		if (exists) {
			new Notice('已在列表中');
			return;
		}
		await setItems([...current, value]);
		input.value = '';
		refreshChips();
	};

	const addBtn = row.createEl('button', {
		cls: 'dta-scope-btn clickable-icon',
		attr: {
			type: 'button',
			'aria-label': '添加',
			title: '添加',
		},
	});
	setIcon(addBtn, 'plus');
	addBtn.addEventListener('click', () => {
		void tryAdd(input.value);
	});

	const pickBtn = row.createEl('button', {
		cls: 'dta-scope-btn clickable-icon',
		attr: {
			type: 'button',
			'aria-label': pickerAria,
			title: pickerAria,
		},
	});
	setIcon(pickBtn, pickerIcon);
	pickBtn.addEventListener('click', () => {
		openPicker(getItems(), (value) => {
			void tryAdd(value);
		});
	});

	input.addEventListener('keydown', (evt) => {
		if (evt.key === 'Enter') {
			evt.preventDefault();
			void tryAdd(input.value);
		}
	});

	refreshChips();
}

/**
 * 常规 → 卡片扫描与解析范围（文件夹 / 忽略 / 标签三级限制）。
 */
export function renderScanScopeSettings(
	plugin: DeckToAnkiPlugin,
	containerEl: HTMLElement,
	beginSection: BeginSection,
): void {
	const section = beginSection(
		containerEl,
		'扫描范围',
		'限制「所有卡片 / 归档卡片」扫描哪些笔记。一级文件夹 → 二级忽略 → 三级标签。',
	);

	const saveFolders = async (
		key: 'includeFolders' | 'ignoreFolders',
		items: string[],
	): Promise<void> => {
		plugin.settings[key] = items;
		await plugin.saveSettings();
	};

	const saveTags = async (items: string[]): Promise<void> => {
		plugin.settings.includeTags = items;
		await plugin.saveSettings();
	};

	renderScopeListSetting({
		section,
		name: '扫描文件夹',
		desc: '只扫描这些文件夹及其子文件夹。默认为空，扫描整个库。',
		placeholder: '文件夹路径，如 Notes',
		pickerIcon: 'folder',
		pickerAria: '从清单选择文件夹',
		getItems: () => plugin.settings.includeFolders ?? [],
		setItems: (items) => saveFolders('includeFolders', items),
		normalize: normalizeFolderPath,
		openPicker: (excluded, onPick) => {
			new FolderSuggestModal(plugin.app, onPick, excluded).open();
		},
	});

	renderScopeListSetting({
		section,
		name: '忽略文件夹',
		desc: '在扫描文件夹结果中排除这些路径及其子文件夹。',
		placeholder: '文件夹路径，如 Archive',
		pickerIcon: 'folder',
		pickerAria: '从清单选择忽略文件夹',
		getItems: () => plugin.settings.ignoreFolders ?? [],
		setItems: (items) => saveFolders('ignoreFolders', items),
		normalize: normalizeFolderPath,
		openPicker: (excluded, onPick) => {
			new FolderSuggestModal(plugin.app, onPick, excluded).open();
		},
	});

	renderScopeListSetting({
		section,
		name: '标签限制',
		desc: '只扫描带有这些标签的笔记（支持嵌套，如 anki 可匹配 anki/deck）。默认为空。',
		placeholder: '标签，如 anki 或 anki/deck',
		pickerIcon: 'tags',
		pickerAria: '从清单选择标签',
		getItems: () => plugin.settings.includeTags ?? [],
		setItems: saveTags,
		normalize: normalizeTagFilter,
		formatItem: (tag) => `#${tag}`,
		openPicker: (excluded, onPick) => {
			new TagSuggestModal(plugin.app, onPick, excluded).open();
		},
	});
}
