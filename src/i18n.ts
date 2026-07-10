/**
 * Minimal i18n. The active language is set once from the host via
 * `setLang(app.getLanguage())` (called by the plugin in onload); defaults to
 * English until then. Add a locale + strings below to support more languages.
 */

export type Lang = "en" | "zh";

let cached: Lang | null = null;

/** Set the active language from Obsidian's `App#getLanguage()`. Call once in onload. */
export function setLang(locale: string): void {
	cached = locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function getLang(): Lang {
	if (cached) return cached;
	cached = "en";
	return cached;
}

type Entry = Record<Lang, string>;

const STRINGS: Record<string, Entry> = {
	// ---- commands ----
	"cmd.generateTitle": { en: "Generate title for current note", zh: "为当前笔记生成标题" },
	"cmd.scanTimestamp": { en: "Scan and title all timestamp notes", zh: "扫描并命名全部时间戳笔记" },

	// ---- notices (main) ----
	"notice.noScanTargets": { en: "No timestamp notes found to title", zh: "没有发现待命名的时间戳笔记" },
	"notice.scanStart": { en: "Titling {n} timestamp notes (sequential)…", zh: "开始命名 {n} 个时间戳笔记（串行处理）…" },
	"notice.scanDone": { en: "Titled {done}/{n} timestamp notes", zh: "已完成 {done}/{n} 个时间戳笔记的命名" },

	// ---- notices (title flow) ----
	"notice.generating": { en: "Generating title…", zh: "正在生成标题…" },
	"notice.readFail": { en: "Failed to read file: {err}", zh: "读取文件失败：{err}" },
	"notice.empty": { en: "Note is empty; cannot generate a title.", zh: "笔记内容为空，无法生成标题" },
	"notice.fail": { en: "Title generation failed: {msg}", zh: "标题生成失败：{msg}" },
	"notice.titleEmpty": { en: "Generated title is empty; skipped.", zh: "生成的标题为空，已跳过" },
	"notice.same": { en: "Title is the same as the current filename.", zh: "标题与当前文件名相同" },
	"notice.renamed": { en: "Renamed: {name}", zh: "已重命名：{name}" },
	"notice.renameFail": { en: "Rename failed: {err}", zh: "重命名失败：{err}" },
	"notice.optionsEmpty": { en: "No usable title options; kept the current name.", zh: "没有可用的候选项，已保持当前文件名。" },
	"notice.optionCanceled": { en: "Canceled; kept the current name.", zh: "已取消，保持当前文件名。" },

	// ---- model picker ----
	"modal.pickModel": { en: "Select model…", zh: "选择模型…" },
	"notice.picked": { en: "Selected: {model}", zh: "已选择：{model}" },
	"notice.noModels": { en: "No chat models found; load a chat model on the server first.", zh: "未发现 chat 模型，请先在服务端加载一个 chat 模型" },
	"notice.connFail": { en: "Connection failed: {err}", zh: "连接失败：{err}" },

	// ---- title picker ----
	"modal.pickTitle": { en: "Choose a title…", zh: "选择一个标题…" },
	"modal.instr.pick": { en: "Pick candidate", zh: "选择候选项" },
	"modal.instr.move": { en: "Move", zh: "移动" },
	"modal.instr.choose": { en: "Choose", zh: "确认" },
	"modal.instr.cancel": { en: "Cancel", zh: "取消" },

	// ---- settings: headings ----
	"set.heading.connection": {
		en: "LLM connection (LMStudio by default; any OpenAI-compat server)",
		zh: "LLM 连接（默认 LMStudio，兼容任意 OpenAI-compat 服务）",
	},
	"set.heading.params": { en: "Generation", zh: "生成参数" },
	"set.heading.scope": { en: "Scan scope", zh: "扫描范围" },

	// ---- settings: connection ----
	"set.baseUrl.name": { en: "Base URL", zh: "Base URL" },
	"set.baseUrl.desc": {
		en: "Local server URL. Default LMStudio http://127.0.0.1:1234; change for Ollama / vLLM etc.",
		zh: "本地服务地址，默认 LMStudio http://127.0.0.1:1234；Ollama / vLLM 等改这里即可",
	},
	"set.apiKey.name": { en: "API token (optional)", zh: "API Token（可选）" },
	"set.apiKey.desc": {
		en: "Only if the server has auth enabled; leave empty when auth is off (default).",
		zh: "仅当服务端开启了鉴权时需要填写；默认关闭鉴权可留空。",
	},
	"set.apiKey.ph": { en: "empty = no auth", zh: "留空 = 无鉴权" },
	"set.model.name": { en: "Model", zh: "模型" },
	"set.model.desc": {
		en: "Chat model id. Type it directly, or click the button to pick from the server's list.",
		zh: "chat 模型标识符。可直接输入，或点右侧从服务器列表选择。",
	},
	"set.model.ph": { en: "(not set)", zh: "（未选择）" },
	"set.timeout.name": { en: "Request timeout (ms)", zh: "请求超时（毫秒）" },
	"set.timeout.desc": {
		en: "Reasoning models with thinking on are slow (6–20s); suggest ≥ 60000. ~1–2s with thinking off.",
		zh: "推理模型开启思考时较慢（6–20s），建议 ≥ 60000；关闭思考时约 1–2s。",
	},

	// ---- settings: generation ----
	"set.temp.name": { en: "Temperature", zh: "Temperature" },
	"set.temp.desc": { en: "Lower = more deterministic. 0.1–0.5 for titles.", zh: "越低越确定，标题建议 0.1–0.5。" },
	"set.maxTokens.name": { en: "Max tokens", zh: "Max tokens" },
	"set.maxTokens.desc": {
		en: "1024 recommended. Raising maxTokens can make some reasoning models reason longer and not converge — if it often fails, simplify the System prompt or switch models.",
		zh: "推理模型建议 1024。注意：对部分推理模型调大 maxTokens 反而让它推理更久、不收敛——若频繁失败应简化 System prompt 或更换模型。",
	},
	"set.thinking.name": { en: "Enable thinking (reasoning)", zh: "开启思考（推理）" },
	"set.thinking.desc": {
		en: "Off (default) sends reasoning_effort:none to skip the reasoning chain — faster and more stable. On lets reasoning models think first; slower and occasionally non-convergent (the reasoning fallback then kicks in).",
		zh: "关闭时发送 reasoning_effort:none 禁用思考链——生成更快更稳（默认）。开启则让推理模型先思考再给标题，更慢且偶发不收敛（此时“从思考链回退提取”会兜底）。",
	},
	"set.fallback.name": { en: "Fallback: extract title from reasoning", zh: "从思考链回退提取标题" },
	"set.fallback.desc": {
		en: "When the model emits no content (reasoning models occasionally spiral), try to extract a candidate title from reasoning_content. On by default.",
		zh: "当模型未输出 content 时（推理模型偶发螺旋不收敛），尝试从 reasoning_content 的候选标题中提取一个。默认开启。",
	},
	"set.prompt.name": { en: "System prompt (custom rules)", zh: "System prompt（可写自定义规则）" },
	"set.prompt.desc": {
		en: "Prompt guiding title generation; add your own rules (language/style/required elements). Empty uses the built-in default. ⚠️ For reasoning models avoid hard length limits (e.g. 'max 12 chars') — they trigger generate-reject loops with no output; length is capped by 'Title max length' below.",
		zh: "指导模型生成标题的提示词，可写入自定义规则（语言/风格/必含元素等）。清空则使用内置默认值。⚠️ 对推理模型（如 Gemma-4）避免写死长度上限（如“不超过12字”）——会触发反复生成-否决候选导致无输出；长度由下方“标题最大长度”统一截断。",
	},
	"set.maxContent.name": { en: "Max content chars sent", zh: "发送内容最大字符数" },
	"set.maxContent.desc": { en: "Truncate note content to avoid overly long context.", zh: "截断笔记内容，避免过长上下文。" },
	"set.titleMax.name": { en: "Title max length", zh: "标题最大长度" },
	"set.titleMax.desc": {
		en: "Max characters for the title filename (code-point safe truncation; filesystem safety cap only, normal titles won't hit it).",
		zh: "标题文件名字符上限（code-point 安全截断，仅作文件系统安全兜底，正常标题不会触及）。",
	},
	"set.offerOptions.name": { en: "Offer title options", zh: "提供标题候选项" },
	"set.offerOptions.desc": {
		en: "After generating, show a pick-menu of N candidate titles and apply the one you choose. Manual command only — never triggers during batch scan.",
		zh: "生成标题后弹出 N 个候选项供选择，应用你选中的那个。仅手动命令生效，批量扫描不触发。",
	},
	"set.optionCount.name": { en: "Number of title options", zh: "标题候选项数量" },
	"set.optionCount.desc": {
		en: "How many candidate titles to request (2-5). Fewer may come back if the model repeats or sanitization collapses duplicates.",
		zh: "请求的候选项数量（2-5）。若模型重复或净化后重名，实际数量可能更少。",
	},

	// ---- settings: scope ----
	"set.minContent.name": { en: "Min content length", zh: "最小内容长度" },
	"set.minContent.desc": {
		en: "Notes with empty content are skipped; any non-empty content generates a title (default 1).",
		zh: "笔记内容为空时不生成；任意非空内容都会生成（默认 1）。",
	},
	"set.fmt.name": { en: "Timestamp format (Moment tokens)", zh: "时间戳格式（Moment token）" },
	"set.customRegex.name": { en: "Custom regex (overrides the format)", zh: "自定义正则（覆盖上面的格式）" },
	"set.scanFolders.name": { en: "Scan folders", zh: "扫描文件夹" },
	"set.scanFolders.desc": {
		en: "The 'Scan and title all timestamp notes' command only processes notes under these folders (recursive); empty = whole vault. e.g. Inbox / Notes/Capture",
		zh: "「扫描并命名全部时间戳笔记」命令只处理这些目录（递归）下的笔记，留空 = 全仓库。示例：\nInbox\nNotes/Capture",
	},

	// ---- format / regex preview ----
	"fmt.empty": { en: "Format is empty", zh: "格式为空" },
	"fmt.noTime": {
		en: "Format must contain a time part (HH/mm/ss), otherwise date-only notes get mistitled.",
		zh: "时间戳格式必须包含时间部分（HH/mm/ss），否则会误改纯日期笔记",
	},
	"fmt.sample": { en: "Sample {sample} → {result}; anchored ^…$, basename only.", zh: "示例 {sample} → {result}；自动锚定 ^…$，仅匹配文件名。" },
	"fmt.match": { en: "✓ matches", zh: "✓ 匹配" },
	"fmt.nomatch": { en: "✗ no match", zh: "✗ 不匹配" },
	"re.invalid": { en: "✗ Invalid regex: {err}", zh: "✗ 正则无效：{err}" },
	"re.empty": { en: "Empty → uses the Moment format above. Auto-anchored as ^(?:…)$.", zh: "留空则使用上面的 Moment 格式。自动锚定为 ^(?:…)$。" },
	"re.valid": {
		en: "✓ Auto-anchored as ^(?:…)$. Note: a custom regex overrides the 'must contain time' protection.",
		zh: "✓ 自动锚定为 ^(?:…)$；注意：自定义正则会覆盖“必须含时间”的保护。",
	},

	// ---- prompts (multi-candidate) ----
	"prompt.optionsSuffix": {
		en: "Now provide exactly {n} distinct candidate titles for this note, one per line. No numbering, no quotes, no bullets, no extra text.",
		zh: "现在请给出 {n} 个互不相同、各自独立的候选标题，每行一个，不要编号、引号、项目符号或任何额外说明。",
	},

	// ---- lmstudio errors ----
	"err.nomodel": { en: "No model set; pick one in settings first.", zh: "未设置模型，请先在设置中选择模型" },
	"err.notloaded": {
		en: "Model not loaded (503); load '{model}' on the server or enable JIT auto-load.",
		zh: "模型未加载（503），请在服务端加载模型「{model}」或开启 JIT 自动加载",
	},
	"err.http": { en: "Server returned {status}: {text}", zh: "服务返回 {status}：{text}" },
	"err.noChoices": { en: "Model returned no choices.", zh: "模型未返回任何选项" },
	"err.budget": {
		en: "Reasoning did not converge (finish=length). Simplify the System prompt or switch to a non-reasoning model; raising maxTokens is counterproductive for some reasoning models.",
		zh: "模型推理未收敛（finish=length）。建议简化 System prompt 或更换非推理模型；对部分推理模型调大 maxTokens 反而无效。",
	},
	"err.emptyResult": {
		en: "Model returned no usable title. Simplify the System prompt or switch models.",
		zh: "模型未返回可用标题。建议简化 System prompt 或更换模型。",
	},
	"err.timeout": {
		en: "Request timed out ({ms}ms); reasoning models can be slow — raise the timeout or use a faster model.",
		zh: "请求超时（{ms}ms），推理模型较慢，请调大超时或更换更快的模型",
	},
	"err.unreachable": {
		en: "Cannot reach the server ({url}); make sure it is running.",
		zh: "无法连接服务（{url}），请确认服务器已启动",
	},
	"err.httpFail": { en: "Request failed: {msg}", zh: "请求失败：{msg}" },
	"err.netFriendly": {
		en: "Cannot reach {url}; make sure the server is running.",
		zh: "无法连接 {url}，请确认服务已启动",
	},
};

/** Translate a key, interpolating {param} placeholders. Falls back to English, then the key. */
export function t(key: string, params?: Record<string, string | number>): string {
	const entry = STRINGS[key];
	const lang = getLang();
	let s = entry ? (entry[lang] ?? entry.en) : key;
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			s = s.replace(new RegExp("\\{" + k + "\\}", "g"), String(v));
		}
	}
	return s;
}

const DEFAULT_PROMPTS: Record<Lang, string> = {
	en: "Give this note a concise, descriptive title that is easy to reference from other notes. Output only the title: no explanation, no quotes, no brackets. Match the note's language.",
	zh: "给这条笔记起一个描述性的标题，便于在其它笔记中引用它。只输出标题本身，不要解释、不要引号、不要方括号，语言与笔记一致。",
};

/** The localized default system prompt (used when the user leaves the prompt empty). */
export function defaultSystemPrompt(): string {
	return DEFAULT_PROMPTS[getLang()];
}

