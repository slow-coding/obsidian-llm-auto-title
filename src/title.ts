import { Notice, normalizePath, TAbstractFile, TFile } from "obsidian";
import type AutoTitlePlugin from "./main";
import type { AutoTitleSettings } from "./settings";
import { t } from "./i18n";
import { compileUserRegex, momentFormatToRegex, sanitizeTitle, stripExtension, uniquePath } from "./util";

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

	const title = sanitizeTitle(result.title, s.titleMaxLength);
	if (!title) {
		notice.hide();
		new Notice(t("notice.titleEmpty"), 6000);
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
