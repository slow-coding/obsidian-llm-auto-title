// Integration-test stub for the `obsidian` module.
// `requestUrl` performs a REAL HTTP call to the local LMStudio, so the actual
// LMStudioClient/generateForFile code paths are exercised against the real model.
// vault/fileManager/Notice are in-memory fakes.
import http from "node:http";

export class TAbstractFile {}
export class TFile {
	constructor(props) {
		Object.assign(this, props);
	}
}
export class TFolder {
	constructor(props) {
		Object.assign(this, props);
	}
	isRoot() {
		return !!this._root;
	}
}
export class Vault {}
export class App {}
export class Plugin {}
// UI classes — not exercised by integration tests (display() is never called),
// but must exist as exports so esbuild can resolve settings.ts imports.
export class DropdownComponent {}
export class TextComponent {
	setValue() {
		return this;
	}
	setPlaceholder() {
		return this;
	}
	onChange() {
		return this;
	}
}
export class FuzzySuggestModal {
	constructor() {}
	setPlaceholder() {
		return this;
	}
	open() {}
}
// Exported so esbuild can resolve titlePicker.ts imports. The title-options
// picker isn't exercised by these tests (offerTitleOptions is off by default),
// so a minimal stub suffices; scope.register is included for safety.
export class SuggestModal {
	constructor() {}
	scope = { register() { return {}; } };
	setPlaceholder() {
		return this;
	}
	setInstructions() {
		return this;
	}
	open() {}
	close() {}
}
export class PluginSettingTab {}
// Exported so esbuild can resolve title.ts's MarkdownView import. Integration
// tests don't exercise the live-editor path (fake views aren't MarkdownView
// instances, so liveEditorContent returns null → falls back to cachedRead).
export class MarkdownView {}
export class Setting {
	constructor() {}
	setName() {
		return this;
	}
	setDesc() {
		return this;
	}
	setHeading() {
		return this;
	}
	addText() {
		return this;
	}
	addTextArea() {
		return this;
	}
	addToggle() {
		return this;
	}
	addDropdown() {
		return this;
	}
	addSlider() {
		return this;
	}
	addExtraButton() {
		return this;
	}
}

export function normalizePath(p) {
	return String(p)
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/|\/$/g, "");
}

export const notices = [];
export const stats = { requestCount: 0, lastUrl: "" };

// If non-empty, requestUrl resolves with the next queued response instead of
// making a real HTTP call (one consumed per call). Lets tests reliably exercise
// error/edge paths, including generateTitle's retry (queue 2 responses).
export const mock = { responses: [] };

export class Notice {
	constructor(message, _duration) {
		this.message = message;
		notices.push(typeof message === "string" ? message : String(message));
	}
	setMessage(m) {
		this.message = m;
	}
	hide() {}
}

// Real HTTP requestUrl against the local LMStudio. Matches Obsidian semantics:
// resolves with {status, json, text} on any HTTP response (incl. 4xx/5xx when
// throw:false), rejects on network errors (ECONNREFUSED etc.).
export function requestUrl(req) {
	stats.requestCount++;
	if (mock.responses.length > 0) {
		return Promise.resolve(mock.responses.shift());
	}
	const url = new URL(req.url);
	stats.lastUrl = url.href;
	const body = req.body;
	const headers = { ...(req.headers || {}) };
	if (body && req.contentType) headers["Content-Type"] = req.contentType;
	const opts = {
		method: req.method || "GET",
		hostname: url.hostname,
		port: url.port,
		path: url.pathname + url.search,
		headers,
	};
	return new Promise((resolve, reject) => {
		const r = http.request(opts, (res) => {
			let data = "";
			res.on("data", (c) => (data += c));
			res.on("end", () => {
				let json = null;
				try {
					json = JSON.parse(data);
				} catch {
					json = null;
				}
				resolve({
					status: res.statusCode,
					headers: res.headers,
					text: data,
					json,
					arrayBuffer: Buffer.from(data),
				});
			});
		});
		r.on("error", reject);
		if (body) r.write(body);
		r.end();
	});
}
