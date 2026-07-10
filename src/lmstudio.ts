import { requestUrl, type RequestUrlResponse } from "obsidian";
import { defaultSystemPrompt, t } from "./i18n";
import { type AutoTitleSettings } from "./settings";
import { isObject, isUnknownArray, truncate } from "./util";

export type TitleErrorKind =
	| "unreachable"
	| "timeout"
	| "notloaded"
	| "http"
	| "budget"
	| "empty"
	| "nomodel";

export type TitleResult =
	| { ok: true; title: string }
	| { ok: false; kind: TitleErrorKind; message: string };

export type TitleOptionsResult =
	| { ok: true; titles: string[] }
	| { ok: false; kind: TitleErrorKind; message: string };

/** Optional per-call overrides for title generation.
 *  - `exclude`: sanitized titles already used for this note; appended to the
 *    system prompt as a negative list so the model picks a different angle.
 *  - `temperature`: overrides the user's setting (used on dedup retries to
 *    inject sampling noise when the model ignores the negative list). */
export interface GenerateOpts {
	exclude?: string[];
	temperature?: number;
}

const TIMEOUT_SENTINEL = "__lmstudio_timeout__";
const NETWORK_RE = /ECONNREFUSED|ENOTFOUND|fetch failed|network error|failed to fetch/i;

export class LMStudioClient {
	constructor(private readonly getSettings: () => AutoTitleSettings) {}

	private get s(): AutoTitleSettings {
		return this.getSettings();
	}

	private get baseUrl(): string {
		return this.s.baseUrl.replace(/\/+$/, "");
	}

	/** List chat model ids from /v1/models, filtering out embedding models. Throws on error. */
	async listModels(): Promise<string[]> {
		const headers = this.authHeader();
		let res: RequestUrlResponse;
		try {
			res = await requestUrl({
				url: `${this.baseUrl}/v1/models`,
				method: "GET",
				headers,
				throw: false,
			});
		} catch (e) {
			throw new Error(this.friendlyNetwork(e));
		}
		if (res.status >= 400) {
			throw new Error(`HTTP ${res.status}: ${(res.text ?? "").slice(0, 200)}`);
		}
		const json: unknown = res.json;
		const data = isObject(json) ? json.data : undefined;
		if (!isUnknownArray(data)) return [];
		const ids: string[] = [];
		for (const m of data) {
			if (isObject(m) && typeof m.id === "string" && m.id && !/embed/i.test(m.id)) ids.push(m.id);
		}
		return ids.sort();
	}

	/** Generate a title for the given content. Never throws — returns a TitleResult. */
	async generateTitle(content: string, opts?: GenerateOpts): Promise<TitleResult> {
		// Reasoning models occasionally spiral and emit no content; a second
		// attempt usually converges. Retry only on budget/empty (not on network
		// errors, which won't resolve by retrying).
		let result = await this.attemptTitle(content, opts);
		if (!result.ok && (result.kind === "budget" || result.kind === "empty")) {
			result = await this.attemptTitle(content, opts);
		}
		return result;
	}

	/** Generate up to `count` candidate titles in one call. Never throws —
	 * returns a TitleOptionsResult. Retries once on budget/empty, like
	 * generateTitle. `count` is clamped to 1-5. */
	async generateTitleOptions(content: string, count: number, opts?: GenerateOpts): Promise<TitleOptionsResult> {
		const n = Math.max(1, Math.min(5, Math.round(count)));
		let result = await this.attemptTitleOptions(content, n, opts);
		if (!result.ok && (result.kind === "budget" || result.kind === "empty")) {
			result = await this.attemptTitleOptions(content, n, opts);
		}
		return result;
	}

	/** Shared chat-completion request: build the body, POST (racing the timeout),
	 * classify network/HTTP/choice errors. Returns the trimmed assistant content,
	 * finish_reason and reasoning_content on success, or a TitleResult-shaped
	 * error. Both the single-title and the multi-candidate paths route here. */
	private async rawCompletion(
		systemContent: string,
		userContent: string,
		temperature?: number,
	): Promise<
		| { ok: true; content: string; finishReason: string; reasoning: string }
		| { ok: false; kind: TitleErrorKind; message: string }
	> {
		const s = this.s;
		if (!s.model.trim()) {
			return { ok: false, kind: "nomodel", message: t("err.nomodel") };
		}

		const body: Record<string, unknown> = {
			model: s.model,
			messages: [
				{ role: "system", content: systemContent },
				{ role: "user", content: userContent },
			],
			temperature: temperature ?? s.temperature,
			max_tokens: s.maxTokens,
			stream: false,
		};
		if (!s.enableThinking) {
			// Disables the reasoning/thinking chain. Verified effective on Gemma-4
			// via LMStudio (reasoning_effort:"none") — unlike reasoning:false /
			// enable_thinking:false which are ignored. Default off = fast & stable.
			body.reasoning_effort = "none";
		}
		if (s.repetitionPenalty !== 1) {
			// llama.cpp repetition_penalty (LMStudio accepts it on the OpenAI-compat
			// endpoint). >1 discourages token reuse so the N candidate titles differ.
			body.repetition_penalty = s.repetitionPenalty;
		}

		const headers = this.authHeader();

		let res: RequestUrlResponse;
		try {
			res = await Promise.race([
				requestUrl({
					url: `${this.baseUrl}/v1/chat/completions`,
					method: "POST",
					contentType: "application/json",
					headers,
					body: JSON.stringify(body),
					throw: false,
				}),
				this.timeoutPromise(s.requestTimeoutMs),
			]);
		} catch (e) {
			return this.classifyError(e);
		}

		if (res.status === 503) {
			return {
				ok: false,
				kind: "notloaded",
				message: t("err.notloaded", { model: s.model }),
			};
		}
		if (res.status >= 400) {
			return {
				ok: false,
				kind: "http",
				message: t("err.http", { status: res.status, text: (res.text ?? "").slice(0, 200) }),
			};
		}

		const json: unknown = res.json;
		const choices = isObject(json) && isUnknownArray(json.choices) ? json.choices : [];
		const choice = choices.length > 0 ? choices[0] : null;
		if (!choice || !isObject(choice)) {
			return { ok: false, kind: "empty", message: t("err.noChoices") };
		}

		const message = isObject(choice.message) ? choice.message : {};
		const content = typeof message.content === "string" ? message.content.trim() : "";
		const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : "";
		const reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content : "";
		return { ok: true, content, finishReason, reasoning };
	}

	/** When `exclude` is non-empty, append a negative list of already-used
	 *  titles to the system prompt so the model picks a different angle. */
	private appendExclude(systemContent: string, exclude: string[] | undefined): string {
		if (!exclude || exclude.length === 0) return systemContent;
		const list = exclude.map((title) => `- ${title}`).join("\n");
		return `${systemContent}\n\n${t("prompt.excludeSuffix", { list })}`;
	}

	private async attemptTitle(content: string, opts?: GenerateOpts): Promise<TitleResult> {
		const s = this.s;
		const userContent = truncate(content, s.maxContentChars);
		const systemContent = this.appendExclude(s.systemPrompt.trim() || defaultSystemPrompt(), opts?.exclude);

		const raw = await this.rawCompletion(systemContent, userContent, opts?.temperature);
		if (!raw.ok) return raw;

		if (raw.content) {
			return { ok: true, title: raw.content };
		}

		// Empty content — reasoning models sometimes spiral and never emit
		// content (often finish=length) but leave candidate titles in
		// reasoning_content. Try to salvage one before reporting an error.
		if (s.reasoningFallback) {
			const extracted = this.extractFromReasoning(raw.reasoning, userContent);
			if (extracted) return { ok: true, title: extracted };
		}

		if (raw.finishReason === "length") {
			return {
				ok: false,
				kind: "budget",
				message: t("err.budget"),
			};
		}
		return {
			ok: false,
			kind: "empty",
			message: t("err.emptyResult"),
		};
	}

	/** Request up to `count` candidate titles in one call. The system prompt is
	 * augmented to ask for N line-separated titles; the response is split into
	 * clean lines (no numbering/quotes/bullets), de-duplicated and capped. No
	 * reasoning fallback here — extractFromReasoning is single-title only; the
	 * budget/empty retry above covers transient spirals. */
	private async attemptTitleOptions(content: string, count: number, opts?: GenerateOpts): Promise<TitleOptionsResult> {
		const s = this.s;
		const userContent = truncate(content, s.maxContentChars);
		const base = this.appendExclude(s.systemPrompt.trim() || defaultSystemPrompt(), opts?.exclude);
		const systemContent = `${base}\n\n${t("prompt.optionsSuffix", { n: count })}`;

		const raw = await this.rawCompletion(systemContent, userContent, opts?.temperature);
		if (!raw.ok) return raw;
		if (!raw.content) {
			return { ok: false, kind: "empty", message: t("err.emptyResult") };
		}

		const titles = this.parseTitleLines(raw.content, count);
		if (titles.length === 0) {
			return { ok: false, kind: "empty", message: t("err.emptyResult") };
		}
		return { ok: true, titles };
	}

	private authHeader(): Record<string, string> {
		const h: Record<string, string> = {};
		if (this.s.apiKey) h["Authorization"] = `Bearer ${this.s.apiKey}`;
		return h;
	}

	private timeoutPromise(ms: number): Promise<never> {
		return new Promise((_resolve, reject) => {
			window.setTimeout(() => reject(new Error(TIMEOUT_SENTINEL)), ms);
		});
	}

	private classifyError(e: unknown): { ok: false; kind: TitleErrorKind; message: string } {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes(TIMEOUT_SENTINEL)) {
			return {
				ok: false,
				kind: "timeout",
				message: t("err.timeout", { ms: this.s.requestTimeoutMs }),
			};
		}
		if (NETWORK_RE.test(msg)) {
			return {
				ok: false,
				kind: "unreachable",
				message: t("err.unreachable", { url: this.s.baseUrl }),
			};
		}
		return { ok: false, kind: "http", message: t("err.httpFail", { msg }) };
	}

	private friendlyNetwork(e: unknown): string {
		const msg = e instanceof Error ? e.message : String(e);
		if (NETWORK_RE.test(msg)) {
			return t("err.netFriendly", { url: this.s.baseUrl });
		}
		return msg;
	}

	/** Salvage a title from reasoning_content when the model didn't emit `content`.
	 * Reasoning models often enumerate candidate titles inside quotes; pick the
	 * last plausible one. `sourceContent` is the note text we sent, used to skip
	 * the input echo (reasoning often re-quotes the source verbatim). Heuristic —
	 * the caller still sanitizes the result. */
	private extractFromReasoning(rc: string, sourceContent: string): string {
		if (!rc) return "";
		const src = sourceContent;

		const isEchoOrMeta = (cand: string): boolean => {
			if (!cand) return true;
			if (/\b(chars?|words?|too (long|short)|option|final selection|answer)\b/i.test(cand)) return true;
			// skip the verbatim input echo
			if (src.includes(cand)) return true;
			return false;
		};

		// 1. Collect quoted candidate titles: "…", "…" (curly), '…', 「…」.
		const re = /"([^"]{2,80})"|"([^"]{2,80})"|'([^']{2,80})'|「([^」]{2,80})」/g;
		const candidates: string[] = [];
		let m: RegExpExecArray | null;
		while ((m = re.exec(rc)) !== null) {
			const cand = (m[1] || m[2] || m[3] || m[4] || "")
				.replace(/\s*\([^)]*\)\s*$/, "")
				.trim();
			if (isEchoOrMeta(cand)) continue;
			candidates.push(cand);
		}
		if (candidates.length > 0) return candidates[candidates.length - 1] ?? "";

		// 2. Fallback: last non-bullet, non-meta line.
		const lines = rc
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter((l) => l.length > 0);
		const skipRe = /^([-*•]|\d+[.)]|\s*(here|final|selection|option|title|answer|so|thus|therefore|wait|let|check|constraint|step|input|goal|key|main)\b)/i;
		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i];
			if (!line || skipRe.test(line) || /^[`*_~#>-]/.test(line)) continue;
			const cleaned = line.replace(/^["'""''「『]+|["'""''」』]+$/g, "").trim();
			if (cleaned && cleaned.length <= 200 && !isEchoOrMeta(cleaned)) return cleaned;
		}
		return "";
	}

	/** Split a multi-candidate model response into clean title lines: per line
	 * strip leading numbering / bullets / wrapping quotes, drop empties, de-dupe
	 * case-insensitively, cap at `max`. Returns RAW lines (filename-safety is the
	 * caller's job — sanitizeTitle takes the first line only, so we split first). */
	private parseTitleLines(raw: string, max: number): string[] {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const line of raw.split(/\r?\n/)) {
			let cleaned = line.trim();
			if (!cleaned) continue;
			// Peel outer wrappers (quotes / numbering / bullets) repeatedly so a
			// combination like "1. Foo" or 1. "Foo" cleans regardless of order.
			// Each step only removes chars, so this always reaches a fixed point.
			for (let guard = 0; guard < 4; guard++) {
				const before = cleaned;
				cleaned = cleaned
					.replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, "")
					.replace(/^\s*\d+[.)]\s*/, "")
					.replace(/^[-*•]\s*/, "")
					.trim();
				if (cleaned === before) break;
			}
			if (!cleaned) continue;
			const key = cleaned.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(cleaned);
			if (out.length >= max) break;
		}
		return out;
	}
}
