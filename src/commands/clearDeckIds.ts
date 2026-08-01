import { MarkdownView, Notice, TFile } from 'obsidian';
import type DeckToAnkiPlugin from '../../main';
import {
	clearDeckIdsAndYamlFromContent,
	clearDeckIdsFromContent,
} from '../domain/head/clearDeckIds';

function getActiveMarkdownFile(plugin: DeckToAnkiPlugin): TFile | null {
	const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	const file = view?.file;
	return file instanceof TFile ? file : null;
}

async function rewriteActiveFile(
	plugin: DeckToAnkiPlugin,
	transform: (content: string) => string,
	unchangedNotice: string,
	changedNotice: string,
): Promise<void> {
	const file = getActiveMarkdownFile(plugin);
	if (!file) {
		new Notice('请先打开要清空的笔记');
		return;
	}

	const content = await plugin.app.vault.read(file);
	const next = transform(content);
	if (next === content) {
		new Notice(unchangedNotice);
		return;
	}
	await plugin.app.vault.modify(file, next);
	new Notice(changedNotice);
}

/** Clear YAML deckID, `<!--ID-->`, and numeric `^id` in the active note. */
export async function clearCurrentFileDeckIds(
	plugin: DeckToAnkiPlugin,
): Promise<void> {
	await rewriteActiveFile(
		plugin,
		clearDeckIdsFromContent,
		'当前文件没有可清空的 deckID',
		'已清空当前文件的 deckID（YAML / <!--ID--> / ^id）',
	);
}

/**
 * Clear all deck YAML plus YAML deckID, `<!--ID-->`, and numeric `^id`
 * in the active note.
 */
export async function clearCurrentFileDeckIdsAndYaml(
	plugin: DeckToAnkiPlugin,
): Promise<void> {
	await rewriteActiveFile(
		plugin,
		clearDeckIdsAndYamlFromContent,
		'当前文件没有可清空的 deckID 或 deck YAML',
		'已清空当前文件的 deckID 与全部 deck YAML',
	);
}
