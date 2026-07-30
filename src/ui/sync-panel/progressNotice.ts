import { Notice } from 'obsidian';

/**
 * Sticky Obsidian notice (top-right) that stays until {@link finish} / {@link hide}.
 * timeout `0` disables auto-dismiss while work is in progress.
 */
export class ProgressNotice {
	private readonly notice: Notice;
	private closed = false;

	constructor(message: string) {
		this.notice = new Notice(message, 0);
	}

	setMessage(message: string): void {
		if (this.closed) {
			return;
		}
		this.notice.setMessage(message);
	}

	/** Update to the final message, then auto-dismiss after lingerMs. */
	finish(message: string, lingerMs = 3500): void {
		if (this.closed) {
			new Notice(message, lingerMs);
			return;
		}
		this.notice.setMessage(message);
		window.setTimeout(() => {
			this.hide();
		}, lingerMs);
	}

	hide(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.notice.hide();
	}
}
