import { App, MarkdownView, Notice, normalizePath, TAbstractFile, TFile } from "obsidian";
import type AutoTitlePlugin from "./main";
import type { AutoTitleSettings } from "./settings";
import { t } from "./i18n";
import { compileUserRegex, isRefusalTitle, momentFormatToRegex, sanitizeTitle, stripExtension, uniquePath } from "./util";
import { pickTitle } from "./titlePicker";
import type { GenerateOpts } from "./lmstudio";

/** Max attempts to dedup against the session history before giving up (and
 *  keeping the current name). Each attempt is a full HTTP request, so keep small. */
const MAX_HISTORY_RETRIES = 3;
/** Temperature bump per dedup retry (clamped to 0.95). First attempt always
 *  uses the user's setting (crisp); only collisions raise it to add noise. */
const RETRY_TEMP_STEP = 0.25;

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

/** If the file is open in an editor, return its live (possibly unsaved) text;
 *  otherwise null (caller falls back to vault.cachedRead). Fixes "content
 *  pasted just-now not detected": cachedRead reads the on-disk/cached content,
 *  not what's still in the editor buffer. */
function liveEditorContent(app: App, file: TFile): string | null {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === file.path) {
			return view.editor.getValue();
		}
	}
	return null;
}

/** If `basename` starts with a timestamp matching the detection `pattern`,
 *  return that leading timestamp; otherwise null. Supports a bare timestamp
 *  ("20260709_143022") and an already-prefixed name ("20260709_143022 Title")
 *  so re-triggering keeps the timestamp. Strips the pattern's trailing `$` to
 *  match a leading prefix instead of the whole basename. */
function timestampPrefixOf(pattern: RegExp, basename: string): string | null {
	// 1. Precise: match the detection pattern at the start of the basename.
	//    Handles space-containing formats too (e.g. "YYYY-MM-DD HH.mm.ss").
	const precise = new RegExp(pattern.source.replace(/\$$/, "")).exec(basename);
	if (precise?.[0]) return precise[0];
	// 2. Fallback: when the pattern doesn't fit the actual name (e.g. format is
	//    YYMMDD but the note is YYYYMMDD — a 2/4-digit-year mismatch, or any
	//    other format/file divergence), take the leading run of digits +
	//    separators before the first space. Only fires for digit-led names, so
	//    ordinary names ("meeting notes") are left untouched.
	const firstToken = basename.split(" ")[0] ?? "";
	if (firstToken && /^\d[\d_.\-:/]+$/.test(firstToken)) return firstToken;
	return null;
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
	// Prefer the live editor buffer when the file is open — cachedRead reads the
	// on-disk content, which is empty/stale right after a paste that hasn't
	// flushed yet ("content not detected" on a just-pasted note).
	const live = liveEditorContent(plugin.app, current);
	if (live !== null) {
		content = live;
	} else {
		try {
			content = await plugin.app.vault.cachedRead(current);
		} catch (e) {
			if (manual) {
				new Notice(t("notice.readFail", { err: e instanceof Error ? e.message : String(e) }), 6000);
			}
			return;
		}
	}
	if (content.trim().length < s.minContentLength) {
		if (manual) new Notice(t("notice.empty"));
		return;
	}
	if (plugin.unloaded) return;

	const notice = new Notice(t("notice.generating"), 0);

	// Session history of titles already generated for THIS file this session —
	// drives "re-trigger gives a different title". `path` captured above.
	const history = plugin.sessionTitles.get(path) ?? new Set<string>();

	let title: string;
	if (s.offerTitleOptions && manual) {
		// Options path — manual command only. Batch scan (manual === false)
		// never pops a per-file picker even when the toggle is on.
		const opt = await plugin.lmstudio.generateTitleOptions(content, s.optionCount, { exclude: [...history] });
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
			if (history.has(key)) continue; // skip titles already used this session
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
		// Single-title path with session dedup: retry (raising temperature) until
		// the model yields a title not already used for this file this session.
		title = "";
		for (let attempt = 0; attempt < MAX_HISTORY_RETRIES && !plugin.unloaded; attempt++) {
			const opts: GenerateOpts =
				attempt === 0
					? { exclude: [...history] }
					: { exclude: [...history], temperature: Math.min(0.95, s.temperature + RETRY_TEMP_STEP * attempt) };
			const result = await plugin.lmstudio.generateTitle(content, opts);
			if (plugin.unloaded) {
				notice.hide();
				return;
			}
			if (!result.ok) {
				notice.hide();
				new Notice(t("notice.fail", { msg: result.message }), 6000);
				return;
			}
			const cand = sanitizeTitle(result.title, s.titleMaxLength);
			if (!cand) {
				notice.hide();
				new Notice(t("notice.titleEmpty"), 6000);
				return;
			}
			if (isRefusalTitle(cand)) {
				notice.hide();
				new Notice(t("notice.noText"), 6000);
				return;
			}
			if (!history.has(cand.toLowerCase())) {
				title = cand; // novel — accept
				break;
			}
			// collided with history — retry with higher temperature + the negative list
		}
	}

	if (!title) {
		// Single-title path exhausted MAX_HISTORY_RETRIES without a novel title
		// (the model kept repeating). Don't rename, don't record history.
		notice.hide();
		new Notice(t("notice.noNewTitle", { n: MAX_HISTORY_RETRIES }), 6000);
		return;
	}
	if (isRefusalTitle(title)) {
		// The model answered with a clarification ("Please provide the note…")
		// because the note has no usable prose (embed/link/empty). Don't let that
		// become the filename. (Options path already filtered refusals.)
		notice.hide();
		new Notice(t("notice.noText"), 6000);
		return;
	}

	// Record into session history (current path) — survives whether or not the
	// rename below succeeds, so a re-trigger keeps avoiding this title.
	history.add(title.toLowerCase());
	plugin.sessionTitles.set(path, history);

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

	// Optional: keep the timestamp prefix (e.g. "20260709_143022 <title>") on
	// timestamp notes so the sortable timestamp survives. Matches the basename's
	// leading timestamp (bare or already-prefixed) so a re-trigger keeps it and
	// only swaps the title part. The prefix is added AFTER recording history, so
	// dedup compares the LLM title, not the timestamp+title combo.
	if (s.prefixTimestamp) {
		const pattern = resolvePattern(s);
		const ts = pattern ? timestampPrefixOf(pattern, latest.basename) : null;
		if (ts) {
			title = `${ts} ${title}`;
		}
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
		// Migrate the session history to the new path so a re-trigger on the
		// renamed file still avoids this title (the key is the file path).
		if (newPath !== path) {
			plugin.sessionTitles.delete(path);
			plugin.sessionTitles.set(newPath, history);
		}
		notice.hide();
		new Notice(t("notice.renamed", { name: baseName }), 4000);
	} catch (e) {
		notice.hide();
		new Notice(t("notice.renameFail", { err: e instanceof Error ? e.message : String(e) }), 6000);
	}
}
