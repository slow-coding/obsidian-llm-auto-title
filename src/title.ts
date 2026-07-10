import { Notice, normalizePath, TAbstractFile, TFile } from "obsidian";
import type AutoTitlePlugin from "./main";
import type { AutoTitleSettings } from "./settings";
import { t } from "./i18n";
import { compileUserRegex, isRefusalTitle, momentFormatToRegex, sanitizeTitle, stripExtension, uniquePath } from "./util";
import { pickTitle } from "./titlePicker";

/** Resolve the active detection regex: custom regex if valid, else the Moment format. null = no valid pattern. */
export function resolvePattern(s: AutoTitleSettings): RegExp | null {
	const custom = compileUserRegex(s.customRegex);
	if (custom) return custom;
	try {
		return momentFormatToRegex(s.timestampFormat);
	} catch {
		return null;
	}
}

/** Parse the trigger-folders textarea into normalized folder paths (empty = all). */
export function parseFolders(raw: string): string[] {
	const out: string[] = [];
	for (const part of raw.split(/[\n,]/)) {
		const f = normalizePath(part.trim());
		if (f) out.push(f);
	}
	return out;
}

/** True if the file is inside one of the trigger folders (empty = all folders). */
function inScope(file: TFile, s: AutoTitleSettings): boolean {
	const folders = parseFolders(s.triggerFolders);
	if (folders.length === 0) return true;
	const parent = (file.parent?.path ?? "").toLowerCase();
	return folders.some((f) => {
		const fl = f.toLowerCase();
		return parent === fl || parent.startsWith(fl + "/");
	});
}

/** Scan target: a markdown note whose basename matches the timestamp pattern and is in scope. */
export function shouldScanTarget(file: TAbstractFile, s: AutoTitleSettings): boolean {
	if (!(file instanceof TFile) || file.extension !== "md") return false;
	const re = resolvePattern(s);
	if (!re || !re.test(file.basename)) return false;
	return inScope(file, s);
}

/**
 * Orchestrate: read → generate → sanitize → dedupe → rename.
 * `manual` only affects user-facing notices (the manual command shows more
 * feedback). Checks `plugin.unloaded` before the rename so we don't touch the
 * vault while the plugin is being disabled.
 */
export async function generateForFile(plugin: AutoTitlePlugin, file: TFile, manual: boolean): Promise<void> {
	const s = plugin.settings;
	const path = file.path;

	// re-fetch — file may have been deleted/renamed since the command was issued
	const current = plugin.app.vault.getAbstractFileByPath(path);
	if (!current || !(current instanceof TFile)) return;
	if (plugin.unloaded) return;

	let content: string;
	try {
		content = await plugin.app.vault.cachedRead(current);
	} catch (e) {
		if (manual) {
			new Notice(t("notice.readFail", { err: e instanceof Error ? e.message : String(e) }), 6000);
		}
		return;
	}
	if (content.trim().length < s.minContentLength) {
		if (manual) new Notice(t("notice.empty"));
		return;
	}
	if (plugin.unloaded) return;

	const notice = new Notice(t("notice.generating"), 0);

	let title: string;
	if (s.offerTitleOptions && manual) {
		// Options path — manual command only. Batch scan (manual === false)
		// never pops a per-file picker even when the toggle is on.
		const opt = await plugin.lmstudio.generateTitleOptions(content, s.optionCount);
		if (plugin.unloaded) {
			notice.hide();
			return;
		}
		if (!opt.ok) {
			notice.hide();
			new Notice(t("notice.fail", { msg: opt.message }), 6000);
			return;
		}
		// Sanitize each candidate on its own (sanitizeTitle keeps only the
		// first line), then de-dupe case-insensitively — sanitization can
		// collapse two raw lines into the same title.
		const seen = new Set<string>();
		const cands: string[] = [];
		for (const raw of opt.titles) {
			const c = sanitizeTitle(raw, s.titleMaxLength);
			if (!c || isRefusalTitle(c)) continue;
			const key = c.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			cands.push(c);
		}
		if (cands.length === 0) {
			notice.hide();
			new Notice(t("notice.optionsEmpty"), 6000);
			return;
		}
		// Generation is done — drop the "Generating…" toast; the modal (when
		// there's more than one candidate) is the UI now.
		notice.hide();
		// With a single usable candidate there's nothing to pick; otherwise
		// open the picker (it resolves "" on Esc / click-away).
		const chosen = cands.length === 1 ? (cands[0] ?? "") : await pickTitle(plugin.app, cands);
		if (plugin.unloaded) return;
		if (!chosen) {
			new Notice(t("notice.optionCanceled"), 6000);
			return;
		}
		title = chosen;
	} else {
		const result = await plugin.lmstudio.generateTitle(content);
		if (plugin.unloaded) {
			notice.hide();
			return;
		}
		if (!result.ok) {
			notice.hide();
			new Notice(t("notice.fail", { msg: result.message }), 6000);
			return;
		}
		title = sanitizeTitle(result.title, s.titleMaxLength);
	}

	if (!title) {
		notice.hide();
		new Notice(t("notice.titleEmpty"), 6000);
		return;
	}
	if (isRefusalTitle(title)) {
		// The model answered with a clarification ("Please provide the note…")
		// because the note has no usable prose (embed/link/empty). Don't let that
		// become the filename.
		notice.hide();
		new Notice(t("notice.noText"), 6000);
		return;
	}

	// re-fetch again — the generation may have taken a while
	const latest = plugin.app.vault.getAbstractFileByPath(path);
	if (!latest || !(latest instanceof TFile)) {
		notice.hide();
		return;
	}

	if (title === latest.basename) {
		notice.hide();
		if (manual) new Notice(t("notice.same"));
		return;
	}

	const folder = latest.parent ?? plugin.app.vault.getRoot();
	const baseName = stripExtension(title);
	const newPath = uniquePath(plugin.app.vault, folder, baseName, latest);

	if (newPath === latest.path) {
		notice.hide();
		if (manual) new Notice(t("notice.same"));
		return;
	}
	if (plugin.unloaded) {
		notice.hide();
		return;
	}

	try {
		await plugin.app.fileManager.renameFile(latest, newPath);
		notice.hide();
		new Notice(t("notice.renamed", { name: baseName }), 4000);
	} catch (e) {
		notice.hide();
		new Notice(t("notice.renameFail", { err: e instanceof Error ? e.message : String(e) }), 6000);
	}
}
