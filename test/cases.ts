import {
	compileUserRegex,
	isReservedName,
	momentFormatToRegex,
	sanitizeTitle,
	stripExtension,
	truncate,
	validateUserRegex,
} from "../src/util";
import { defaultSystemPrompt, getLang, t } from "../src/i18n";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
	const ok = got === want;
	if (ok) {
		pass++;
		console.log("  ✓", name);
	} else {
		fail++;
		console.log("  ✗", name, "got:", JSON.stringify(got), "want:", JSON.stringify(want));
	}
}

console.log("momentFormatToRegex:");
const re = momentFormatToRegex("YYYYMMDD_HHmmss");
eq("matches YYYYMMDD_HHmmss", re.test("20260709_143022"), true);
eq("rejects daily date 2026-07-09", re.test("2026-07-09"), false);
eq("rejects date-only 20260709", re.test("20260709"), false);
eq("rejects plain word", re.test("meeting-notes"), false);
let threw = false;
try {
	momentFormatToRegex("YYYYMMDD");
} catch {
	threw = true;
}
eq("throws on no-time format (protects daily notes)", threw, true);
eq("matches dash format", momentFormatToRegex("YYYY-MM-DD-HH-mm").test("2026-07-09-14-30"), true);
eq("matches space format", momentFormatToRegex("YYYY-MM-DD HH.mm.ss").test("2026-07-09 14.30.22"), true);

console.log("compileUserRegex:");
const cr = compileUserRegex("^note-\\d{8}$");
eq("custom regex matches note-20260709", !!cr && cr.test("note-20260709"), true);
eq("custom regex rejects note-2026", !!cr && cr.test("note-2026"), false);
eq("auto-anchored (no partial match)", !!compileUserRegex("foo")?.test("xfoox"), false);
eq("invalid regex returns null", compileUserRegex("[") === null, true);
eq("empty returns null", compileUserRegex("") === null, true);

console.log("validateUserRegex:");
eq("invalid returns error message", validateUserRegex("[") !== null, true);
eq("valid returns null", validateUserRegex("^\\d+$"), null);
eq("empty returns null", validateUserRegex(""), null);

console.log("sanitizeTitle:");
eq("strip CJK quotes + markdown + fullwidth colon", sanitizeTitle("「**Q3：对齐**」", 80), "Q3 对齐");
eq("strip wrapping double quotes", sanitizeTitle('"Hello World"', 80), "Hello World");
eq("trim surrounding spaces", sanitizeTitle("  Hello World  ", 80), "Hello World");
eq("first line only", sanitizeTitle("Line1\nLine2", 80), "Line1");
eq("strip leading/trailing dots", sanitizeTitle("...Title...", 80), "Title");
eq("garbage markdown to empty", sanitizeTitle("***", 80), "");
eq("all invalid chars replaced", /[*?:\\/<>|]/.test(sanitizeTitle("a*b?c:d/e\\f<g>h|i", 80)), false);
eq("code-point-safe truncate (emoji)", sanitizeTitle("📊 Report 数据看板", 5), "📊 Rep");
eq("reserved name guarded", sanitizeTitle("CON", 80), "CON note");
eq("XML unwrap", sanitizeTitle("<title>My Title</title>", 80), "My Title");
eq("markdown bold unwrap", sanitizeTitle("**Important Note**", 80), "Important Note");

console.log("stripExtension:");
eq("strip .md", stripExtension("Foo.md"), "Foo");
eq("strip .MD (case-insensitive)", stripExtension("Foo.MD"), "Foo");
eq("strip .markdown", stripExtension("Foo.markdown"), "Foo");
eq("keep non-md ext", stripExtension("Foo.txt"), "Foo.txt");
eq("keep no extension", stripExtension("Foo"), "Foo");

console.log("truncate:");
eq("truncate long to 5", truncate("abcdefghij", 5), "abcde");
eq("no truncation when short", truncate("abc", 10), "abc");
eq("emoji-safe truncate length", Array.from(truncate("📊abc", 3)).length, 3);

console.log("isReservedName:");
eq("CON reserved", isReservedName("CON"), true);
eq("con reserved (case-insensitive)", isReservedName("con"), true);
eq("COM1 reserved", isReservedName("COM1"), true);
eq("Hello not reserved", isReservedName("Hello"), false);

console.log("i18n:");
eq("default lang is en (no localStorage/moment in node)", getLang(), "en");
eq("t returns english value", t("cmd.generateTitle"), "Generate title for current note");
eq("t interpolates {n}", t("notice.scanStart", { n: 3 }), "Titling 3 timestamp notes (sequential)…");
eq("t interpolates {done}/{n}", t("notice.scanDone", { done: 2, n: 5 }), "Titled 2/5 timestamp notes");
eq("unknown key falls back to key", t("nope.notreal"), "nope.notreal");
eq("default system prompt (en) mentions title", defaultSystemPrompt().toLowerCase().includes("title"), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
