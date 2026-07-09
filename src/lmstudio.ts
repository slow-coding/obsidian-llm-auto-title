import { requestUrl } from "obsidian";
import { defaultSystemPrompt, t } from "./i18n";
import { type AutoTitleSettings } from "./settings";
import { truncate } from "./util";

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
		let res;
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
		const data = res.json?.data;
		if (!Array.isArray(data)) return [];
		const ids: string[] = [];
		for (const m of data) {
			const id = m?.id;
			if (typeof id === "string" && id && !/embed/i.test(id)) ids.push(id);
		}
		return ids.sort();
	}

	/** Generate a title for the given content. Never throws — returns a TitleResult. */
	async generateTitle(content: string): Promise<TitleResult> {
		// Reasoning models occasionally spiral and emit no content; a second
		// attempt usually converges. Retry only on budget/empty (not on network
		// errors, which won't resolve by retrying).
		let result = await this.attemptTitle(content);
		if (!result.ok && (result.kind === "budget" || result.kind === "empty")) {
			result = await this.attemptTitle(content);
		}
		return result;
	}

	private async attemptTitle(content: string): Promise<TitleResult> {
		const s = this.s;
		if (!s.model.trim()) {
			return { ok: false, kind: "nomodel", message: t("err.nomodel") };
		}

		const userContent = truncate(content, s.maxContentChars);
		const body: Record<string, unknown> = {
			model: s.model,
			messages: [
				{ role: "system", content: s.systemPrompt.trim() || defaultSystemPrompt() },
				{ role: "user", content: userContent },
			],
			temperature: s.temperature,
			max_tokens: s.maxTokens,
			stream: false,
		};
		if (!s.enableThinking) {
			// Disables the reasoning/thinking chain. Verified effective on Gemma-4
			// via LMStudio (reasoning_effort:"none") — unlike reasoning:false /
			// enable_thinking:false which are ignored. Default off = fast & stable.
			body.reasoning_effort = "none";
		}

		const headers = this.authHeader();

		let res;
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

		const choices = res.json?.choices;
		const choice = Array.isArray(choices) && choices.length > 0 ? choices[0] : null;
		if (!choice) {
			return { ok: false, kind: "empty", message: t("err.noChoices") };
		}

		const message = choice.message ?? {};
		const content0 = typeof message.content === "string" ? message.content.trim() : "";
		const finishReason = choice.finish_reason;

		if (content0) {
			return { ok: true, title: content0 };
		}

		// Empty content — reasoning models sometimes spiral and never emit
		// content (often finish=length) but leave candidate titles in
		// reasoning_content. Try to salvage one before reporting an error.
		if (s.reasoningFallback) {
			const rc = typeof message.reasoning_content === "string" ? message.reasoning_content : "";
			const extracted = this.extractFromReasoning(rc, userContent);
			if (extracted) return { ok: true, title: extracted };
		}

		if (finishReason === "length") {
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

	private classifyError(e: unknown): TitleResult {
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
}
