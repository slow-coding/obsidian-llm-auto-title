import { type App, SuggestModal } from "obsidian";
import { t } from "./i18n";

/**
 * Native Obsidian picker for choosing one of N generated title candidates.
 *
 * Built on {@link SuggestModal} so we get mouse-click + ArrowUp/Down + Enter +
 * Esc for free. SuggestModal extends Modal, so it inherits the public `scope`
 * (pushed on the keymap stack on open, popped on close); we register the
 * top-row number keys 1..N there to pick a candidate by keyboard.
 *
 * Two details make the number keys conflict-free despite SuggestModal's
 * always-focused filter input:
 *   - `getSuggestions()` ignores the query and returns every candidate, so a
 *     stray digit can never hide a row.
 *   - the digit handler returns false, which Obsidian turns into
 *     preventDefault+stopPropagation — the keystroke never reaches the input as
 *     typed text.
 *
 * The constructor callback resolves exactly once (a pick followed by the
 * auto-close, or an Esc, must not overwrite the real choice); closing without a
 * pick resolves with "" (the cancel sentinel) so the awaiting caller can't hang.
 */
export class TitlePickerModal extends SuggestModal<string> {
	private resolved = false;

	constructor(
		app: App,
		private readonly candidates: string[],
		private readonly onPick: (title: string) => void,
	) {
		super(app);
		this.setPlaceholder(t("modal.pickTitle"));
		this.setInstructions([
			{ command: `1-${candidates.length}`, purpose: t("modal.instr.pick") },
			{ command: "↑↓", purpose: t("modal.instr.move") },
			{ command: "↵", purpose: t("modal.instr.choose") },
			{ command: "esc", purpose: t("modal.instr.cancel") },
		]);
		// Register 1..N on the inherited scope. Handlers fire only while the
		// scope is active (i.e. while the modal is open).
		for (let i = 0; i < candidates.length; i++) {
			const cand = candidates[i];
			if (!cand) continue;
			const key = String(i + 1);
			this.scope.register(null, key, () => {
				this.settle(cand);
				this.close();
				return false;
			});
		}
	}

	// Ignore the query — the candidate set is fixed, so typing never filters.
	getSuggestions(): string[] {
		return this.candidates;
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		const idx = this.candidates.indexOf(value);
		el.setText(`${idx + 1}. ${value}`);
	}

	// Entry point for mouse click AND Enter (Obsidian's Chooser routes both
	// here). Settle the pick BEFORE close() so it always wins over the cancel
	// sentinel below — without this, a close-before-onChooseSuggestion ordering
	// made every click register as "canceled" (keyboard number keys still
	// worked because their handler settles before calling close()).
	selectSuggestion(value: string): void {
		this.settle(value);
		this.close();
	}

	onChooseSuggestion(item: string): void {
		this.settle(item);
	}

	// Defer the cancel sentinel to a microtask: a synchronous pick (a number
	// key or selectSuggestion) settles first and wins; only a genuine Esc /
	// click-away reaches here with nothing settled.
	onClose(): void {
		queueMicrotask(() => this.settle(""));
	}

	/** Resolve exactly once. "" is the cancel sentinel (Esc / click-away). */
	private settle(title: string): void {
		if (this.resolved) return;
		this.resolved = true;
		this.onPick(title);
	}
}

/** Open the picker and await the user's choice. Resolves with "" if canceled. */
export function pickTitle(app: App, candidates: string[]): Promise<string> {
	return new Promise<string>((resolve) => {
		new TitlePickerModal(app, candidates, resolve).open();
	});
}
