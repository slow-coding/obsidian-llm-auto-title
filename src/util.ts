import { normalizePath, TFile, TFolder, Vault } from "obsidian";

/** Escape regex special characters in a literal string. */
export function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TOKEN_MAP: Record<string, string> = {
	YYYY: "\\d{4}",
	YY: "\\d{2}",
	MM: "\\d{2}",
	M: "\\d{1,2}",
	DD: "\\d{2}",
	D: "\\d{1,2}",
	HH: "\\d{2}",
	H: "\\d{1,2}",
	mm: "\\d{2}",
	m: "\\d{1,2}",
	ss: "\\d{2}",
	s: "\\d{1,2}",
};

// Longest-first alternation so `YYYY` wins over `YY`, `MM` over `M`, etc.
const TOKEN_RE = /YYYY|YY|MM|DD|HH|mm|ss|M|D|H|m|s/g;
const TIME_TOKEN_RE = /HH|H|mm|m|ss|s/;

/**
 * Convert a Moment-style format string (e.g. `YYYYMMDD_HHmmss`) into an
 * anchored regex that matches a basename. Throws if the format contains no
 * time component (HH/mm/ss) — this enforces "only time-stamped notes trigger",
 * protecting date-only daily notes.
 */
export function momentFormatToRegex(fmt: string): RegExp {
	if (!fmt || !fmt.trim()) {
		throw new Error("时间戳格式不能为空");
	}
	if (!TIME_TOKEN_RE.test(fmt)) {
		throw new Error("时间戳格式必须包含时间部分（HH/mm/ss），否则会误改纯日期笔记");
	}
	let out = "";
	let last = 0;
	let m: RegExpExecArray | null;
	TOKEN_RE.lastIndex = 0;
	while ((m = TOKEN_RE.exec(fmt)) !== null) {
		out += escapeRegExp(fmt.slice(last, m.index));
		out += TOKEN_MAP[m[0]] ?? escapeRegExp(m[0]);
		last = m.index + m[0].length;
	}
	out += escapeRegExp(fmt.slice(last));
	return new RegExp("^" + out + "$");
}

/** Compile a user-supplied regex string, auto-anchored to the full basename. Returns null if empty or invalid. */
export function compileUserRegex(str: string): RegExp | null {
	const trimmed = str.trim();
	if (!trimmed) return null;
	try {
		return new RegExp("^(?:" + trimmed + ")$");
	} catch {
		return null;
	}
}

/** Validate a user regex string for the settings UI. Returns an error message, or null if valid/empty. */
export function validateUserRegex(str: string): string | null {
	const trimmed = str.trim();
	if (!trimmed) return null;
	try {
		new RegExp(trimmed);
		return null;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
}

const RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Windows-reserved base names (case-insensitive). Vaults sync to Windows/mobile. */
export function isReservedName(base: string): boolean {
	return RESERVED_NAME_RE.test(base.trim());
}

/** Strip a trailing .md/.markdown extension (case-insensitive) to avoid Foo.md.md. */
export function stripExtension(name: string): string {
	return name.replace(/\.(md|markdown)$/i, "");
}

/** True if a sanitized "title" is really a model refusal / clarification request
 * rather than a title. This happens when the note has no usable prose (e.g. it
 * is only an embed `![[…]]`, a bare link, or a near-empty quote): the model
 * answers "Please provide the note…" / "无法生成…", which must NOT become the
 * filename. Conservative — only matches unambiguous refusal phrasings. */
const REFUSAL_TITLE_RE =
	/\bplease provide\b|unable to (generate|determine|provide|title)|请提供|请补充|无法(生成|提取|确定|命名|提供)/i;
export function isRefusalTitle(title: string): boolean {
	return REFUSAL_TITLE_RE.test((title ?? "").trim());
}

/** Code-point-safe truncation (won't split surrogate pairs / emoji). */
export function truncate(text: string, maxChars: number): string {
	if (maxChars <= 0) return text;
	const chars = Array.from(text);
	if (chars.length <= maxChars) return text;
	return chars.slice(0, maxChars).join("");
}

/**
 * Sanitize a raw model title into a safe filename base:
 * first line only → unwrap XML/quotes/markdown → replace invalid chars with
 * space → collapse whitespace → strip leading/trailing dots & spaces →
 * code-point-safe truncate → reserved-name guard.
 */
export function sanitizeTitle(raw: string, maxLen: number): string {
	let t = (raw ?? "").trim();
	// first line only
	t = t.split(/\r?\n/, 1)[0] ?? "";
	// unwrap a single XML-ish wrapper like <title>...</title>
	t = t.replace(/^\s*<[^>]+>\s*/, "").replace(/\s*<\/[^>]+>\s*$/, "");
	// strip wrapping quotes (ASCII + CJK)
	t = t.replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, "");
	// strip wrapping markdown emphasis/code/heading/bullet, and [[wikilink]] wrapper
	t = t.replace(/^\[\[(.+)\]\]$/, "$1")
		.replace(/^\*\*(.+)\*\*$/, "$1")
		.replace(/^__(.+)__$/, "$1")
		.replace(/^[\s`*_~#>-]+/, "")
		.replace(/[\s`*_~]+$/, "");
	// invalid filename chars (cross-platform) → space
	t = t.replace(/[\\/:*?"<>|]/g, " ");
	// fullwidth invalid chars → space
	t = t.replace(/[：＊？／＼＂＜＞｜]/g, " ");
	// collapse whitespace
	t = t.replace(/\s+/g, " ").trim();
	// strip leading/trailing dots & spaces (Windows/sync safety)
	t = t.replace(/^[\s.]+|[\s.]+$/g, "");
	if (!t) return "";
	// code-point-safe truncate
	const chars = Array.from(t);
	if (chars.length > maxLen) t = chars.slice(0, maxLen).join("");
	// re-strip trailing dots/spaces exposed by truncation
	t = t.replace(/[\s.]+$/g, "");
	if (!t) return "";
	if (isReservedName(t)) t = t + " note";
	return t;
}

/**
 * Build a non-colliding markdown path inside `folder`, case-insensitively
 * comparing against existing sibling basenames. Appends " (1)", " (2)", …
 * Pass `ignoreFile` to exclude the file being renamed from collision detection.
 */
export function uniquePath(vault: Vault, folder: TFolder, baseName: string, ignoreFile?: TFile): string {
	const folderPath = folder.isRoot() ? "" : folder.path;
	const makePath = (name: string): string =>
		normalizePath((folderPath ? folderPath + "/" : "") + name + ".md");

	const existing = new Set<string>();
	for (const child of folder.children) {
		if (child instanceof TFile && child.extension === "md" && child !== ignoreFile) {
			existing.add(child.basename.toLowerCase());
		}
	}

	let name = baseName;
	let path = makePath(name);
	if (!existing.has(name.toLowerCase())) return path;
	for (let i = 1; i <= 99; i++) {
		name = `${baseName} (${i})`;
		path = makePath(name);
		if (!existing.has(name.toLowerCase())) return path;
	}
	return path;
}

/** Type guard: a non-null plain object. */
export function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

/** Type guard: an array narrowed to `unknown[]` (avoids the `any[]` from Array.isArray). */
export function isUnknownArray(v: unknown): v is unknown[] {
	return Array.isArray(v);
}

