import { DEFAULT_SETTINGS, type AutoTitleSettings } from "../src/settings";
import { LMStudioClient } from "../src/lmstudio";
import { generateForFile, shouldScanTarget } from "../src/title";
// from the integration stub (aliased to "obsidian" by the build step)
import { mock, Notice, notices, stats, TFile, TFolder } from "obsidian";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = ""): void {
	if (cond) {
		pass++;
		console.log("  ✓", name);
	} else {
		fail++;
		console.log("  ✗", name, extra);
	}
}

const settings: AutoTitleSettings = { ...DEFAULT_SETTINGS };

// ---- in-memory fake vault ----
const root: any = new TFolder({ path: "", _root: true, children: [] });
const folders = new Map<string, any>();
function getFolder(path: string): any {
	if (path === "") return root;
	if (folders.has(path)) return folders.get(path);
	const f = new TFolder({ path, _root: false, children: [] });
	folders.set(path, f);
	return f;
}
const files = new Map<string, { file: any; content: string }>();
const renames: { from: string; to: string }[] = [];

function addFile(path: string, content: string): any {
	const parts = path.split("/");
	const filename = parts.pop() as string;
	const folderPath = parts.join("/");
	const parent = folderPath === "" ? root : getFolder(folderPath);
	const basename = filename.replace(/\.md$/, "");
	const f: any = new TFile({ path, basename, extension: "md", parent });
	files.set(path, { file: f, content });
	parent.children.push(f);
	return f;
}

const plugin: any = {
	settings,
	unloaded: false,
	lmstudio: new LMStudioClient(() => settings),
	app: {
		vault: {
			cachedRead: async (f: any) => files.get(f.path)?.content ?? "",
			getAbstractFileByPath: (p: string) => files.get(p)?.file ?? null,
			getRoot: () => root,
			getMarkdownFiles: () => Array.from(files.values()).map((v) => v.file),
		},
		fileManager: {
			renameFile: async (file: any, newPath: string) => {
				const from = file.path;
				const entry = files.get(from);
				if (!entry) throw new Error("not found: " + from);
				files.delete(from);
				const idx = root.children.indexOf(file);
				if (idx >= 0) root.children.splice(idx, 1);
				const newBasename = newPath.replace(/\.md$/, "").split("/").pop() as string;
				file.path = newPath;
				file.basename = newBasename;
				file.parent = root;
				files.set(newPath, entry);
				root.children.push(file);
				renames.push({ from, to: newPath });
			},
		},
	},
};

function reset(): void {
	notices.length = 0;
	stats.requestCount = 0;
}

async function main(): Promise<void> {
	console.log("listModels (real LMStudio):");
	const models = await plugin.lmstudio.listModels();
	ok("returns a non-empty array", Array.isArray(models) && models.length > 0, JSON.stringify(models));
	ok("filters out embedding models", models.every((m: string) => !/embed/i.test(m)));
	if (models.length > 0) settings.model = models[0]; // use whatever chat model is loaded (portable)

	// empty model → nomodel error (no request, no rename)
	{
		const saved = settings.model;
		settings.model = "";
		reset();
		const r0 = await plugin.lmstudio.generateTitle("some content");
		ok("empty model returns nomodel error (no call)", !r0.ok && r0.kind === "nomodel" && stats.requestCount === 0, JSON.stringify(r0));
		settings.model = saved;
	}

	console.log("\nshouldScanTarget (timestamp pattern — target for scan command):");
	ok("timestamp note is a scan target", shouldScanTarget(addFile("20260709_143022.md", "x"), settings));
	ok("daily date note is NOT a scan target", !shouldScanTarget(addFile("2026-07-09.md", "x"), settings));
	ok("date-only digits NOT a scan target", !shouldScanTarget(addFile("20260709.md", "x"), settings));
	ok("non-timestamp word NOT a scan target", !shouldScanTarget(addFile("meeting-notes.md", "x"), settings));
	ok("scan respects folder scope (in)", shouldScanTarget(addFile("Inbox2/20260709_180000.md", "x"), { ...settings, triggerFolders: "Inbox2" }));
	ok("scan respects folder scope (out)", !shouldScanTarget(addFile("Notes2/20260709_190000.md", "x"), { ...settings, triggerFolders: "Inbox2" }));
	ok("scan subfolder (recursive)", shouldScanTarget(addFile("Inbox2/sub/20260709_200000.md", "x"), { ...settings, triggerFolders: "Inbox2" }));

	console.log("\ngenerateForFile manual (thinking OFF, real model, ~1-2s):");
	reset();
	const note = addFile(
		"20260709_180000.md",
		"今天和团队对齐了 Q3 的 OKR，重点是把搜索召回率从 72% 提到 85%，另外要拆分搜索和推荐的索引。下周三前出技术方案。"
	);
	const before = renames.length;
	await generateForFile(plugin, note, true);
	ok("renamed exactly once", renames.length === before + 1);
	const newBase = note.basename;
	ok("new name is not the timestamp", newBase !== "20260709_180000", newBase);
	ok("new name is non-empty", !!newBase && newBase.length > 0);
	ok("new name has no invalid filename chars (incl. brackets)", !/[\\/:*?"<>|\[\]]/.test(newBase), newBase);
	ok("success notice shown", notices.some((n) => n.includes("Renamed")), notices.join(" | "));

	console.log("\nmanual re-trigger on already-titled note:");
	reset();
	await generateForFile(plugin, note, true);
	ok("manual triggers generation on any titled note", stats.requestCount >= 1, `calls=${stats.requestCount}`);

	console.log("\nbudget exhaustion (mocked: empty content + finish=length, reasoning echoes input):");
	reset();
	settings.enableThinking = true;
	settings.maxTokens = 30;
	const nbContent = "这是一段需要生成标题的笔记内容，关于本地大模型与笔记自动命名。";
	const nb = addFile("20260709_190000.md", nbContent);
	const budgetResp = {
		status: 200,
		text: "",
		json: {
			choices: [{
				index: 0,
				message: { content: "", reasoning_content: `* Input: "${nbContent}"\n* Key topics: local models, note naming` },
				finish_reason: "length",
			}],
			usage: { completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 30 } },
		},
	};
	mock.responses.push(budgetResp, budgetResp); // 2 responses: generateTitle retries once on budget/empty
	await generateForFile(plugin, nb, false);
	ok("not renamed (input-echo not mistaken for title)", nb.basename === "20260709_190000", nb.basename);
	ok("budget error notice shown", notices.some((n) => n.includes("converge") || n.includes("finish=length")), notices.join(" | "));
	settings.maxTokens = 1024;
	settings.enableThinking = false;

	console.log("\ngenerateTitleOptions (mocked multi-line: strip / dedup / cap):");
	reset();
	mock.responses.push({
		status: 200,
		text: "",
		json: { choices: [{ index: 0, message: { content: '1. Alpha\n2. "Bravo"\n- Charlie\nalpha\n4. Delta' }, finish_reason: "stop" }] },
	});
	{
		const opt = await plugin.lmstudio.generateTitleOptions("x", 5);
		ok("options ok", !!opt.ok, JSON.stringify(opt));
		if (opt.ok) {
			ok("strips numbering/quotes/bullets", opt.titles[0] === "Alpha" && opt.titles[1] === "Bravo" && opt.titles[2] === "Charlie", JSON.stringify(opt.titles));
			ok("dedupes case-insensitively (4 of 5 kept)", opt.titles.length === 4 && opt.titles.filter((x: string) => x.toLowerCase() === "alpha").length === 1, JSON.stringify(opt.titles));
		}
	}
	reset();
	mock.responses.push({
		status: 200,
		text: "",
		json: { choices: [{ index: 0, message: { content: "1. Alpha\n2. Bravo\n3. Charlie" }, finish_reason: "stop" }] },
	});
	{
		const opt = await plugin.lmstudio.generateTitleOptions("x", 2);
		ok("caps at requested count", !!opt.ok && opt.titles.length === 2, JSON.stringify(opt));
	}
	reset();
	mock.responses.push({
		status: 200,
		text: "",
		json: { choices: [{ index: 0, message: { content: '"1. Quarterly Review"\n"2. Project Update"' }, finish_reason: "stop" }] },
	});
	{
		const opt = await plugin.lmstudio.generateTitleOptions("x", 5);
		ok("strips numbering inside quotes", !!opt.ok && opt.titles[0] === "Quarterly Review" && opt.titles[1] === "Project Update", JSON.stringify(opt));
	}

	console.log("\nrefusal guard (model asks for content -> not used as title):");
	reset();
	{
		const beforeR = renames.length;
		const refuseNote = addFile("20260709_230000.md", "![[some-other-note]]");
		mock.responses.push({
			status: 200,
			text: "",
			json: { choices: [{ index: 0, message: { content: "Please provide the note so I can generate a title for you." }, finish_reason: "stop" }] },
		});
		await generateForFile(plugin, refuseNote, true);
		ok("refusal not used as title (not renamed)", renames.length === beforeR, `renames=${renames.length}`);
		ok("noText notice shown", notices.some((n) => n.includes("usable text") || n.includes("正文")), notices.join(" | "));
	}

	console.log("\nunreachable (bad port 1235):");
	settings.baseUrl = "http://127.0.0.1:1235";
	reset();
	const r = await plugin.lmstudio.generateTitle("some content");
	ok("classified as unreachable", !r.ok && r.kind === "unreachable", JSON.stringify(r));
	settings.baseUrl = "http://127.0.0.1:1234";

	console.log("\ntimeout (1ms):");
	settings.requestTimeoutMs = 1;
	reset();
	const r2 = await plugin.lmstudio.generateTitle("some content");
	ok("classified as timeout", !r2.ok && r2.kind === "timeout", JSON.stringify(r2));
	settings.requestTimeoutMs = 60000;

	console.log("\nempty content (manual):");
	reset();
	const empty = addFile("20260709_210000.md", "");
	const beforeE = renames.length;
	await generateForFile(plugin, empty, true);
	ok("empty note not titled + no LMStudio call", renames.length === beforeE && stats.requestCount === 0);
	ok("empty-content notice shown", notices.some((n) => n.includes("empty")), notices.join(" | "));

	console.log("\nunload cancellation (rename skipped after unload):");
	reset();
	plugin.unloaded = true;
	const u = addFile("20260709_220000.md", "some real content here for a title");
	const beforeU = renames.length;
	await generateForFile(plugin, u, true);
	ok("not renamed after unload", renames.length === beforeU);
	plugin.unloaded = false;

	console.log(`\n${pass} passed, ${fail} failed`);
	if (fail > 0) process.exit(1);
}

void main().catch((e) => {
	console.error(e);
	process.exit(1);
});
