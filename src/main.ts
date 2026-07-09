import { getLanguage, Notice, Plugin } from "obsidian";
import { AutoTitleSettingTab, AutoTitleSettings, DEFAULT_SETTINGS } from "./settings";
import { setLang, t } from "./i18n";
import { LMStudioClient } from "./lmstudio";
import { generateForFile, shouldScanTarget } from "./title";

export default class AutoTitlePlugin extends Plugin {
	settings!: AutoTitleSettings;
	lmstudio!: LMStudioClient;
	/** Set on unload so in-flight generations abort before renaming. */
	unloaded = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		setLang(getLanguage());
		this.lmstudio = new LMStudioClient(() => this.settings);

		this.addSettingTab(new AutoTitleSettingTab(this.app, this));

		// Generate/regenerate a title for the CURRENT note. Works on any markdown
		// note. Default hotkey Cmd/Ctrl+Shift+T (see setDefaultHotkey); also
		// user-bindable via Settings → Hotkeys.
		this.addCommand({
			id: "generate-title",
			name: t("cmd.generateTitle"),
			checkCallback: (checking: boolean): boolean => {
				const file = this.app.workspace.getActiveFile();
				if (file && file.extension === "md") {
					if (!checking) {
						void generateForFile(this, file, true);
					}
					return true;
				}
				return false;
			},
		});

		// Batch-rename all timestamp-pattern notes (the scan target).
		this.addCommand({
			id: "scan-timestamp-notes",
			name: t("cmd.scanTimestamp"),
			callback: () => {
				void this.scanVault();
			},
		});

		this.app.workspace.onLayoutReady(() => {
			// Best-effort: set Cmd/Ctrl+Shift+T as the default hotkey (only if the
			// user hasn't already bound/cleared it). Obsidian has no plugin API for
			// default hotkeys, so we write .obsidian/hotkeys.json directly. May
			// require an Obsidian reload to take effect.
			void this.setDefaultHotkey();
		});
	}

	onunload(): void {
		this.unloaded = true;
	}

	private async scanVault(): Promise<void> {
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => shouldScanTarget(f, this.settings));
		if (files.length === 0) {
			new Notice(t("notice.noScanTargets"));
			return;
		}
		new Notice(t("notice.scanStart", { n: files.length }));
		let done = 0;
		for (const f of files) {
			if (this.unloaded) break;
			await generateForFile(this, f, false);
			done++;
		}
		new Notice(t("notice.scanDone", { done, n: files.length }), 5000);
	}

	private async setDefaultHotkey(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			const path = `${this.app.vault.configDir}/hotkeys.json`;
			let raw = "";
			try {
				raw = await adapter.read(path);
			} catch {
				raw = "{}";
			}
			const parsed = raw.trim() ? (JSON.parse(raw) as unknown) : {};
			if (!parsed || typeof parsed !== "object") return; // corrupt — don't touch
			const hotkeys = parsed as Record<string, unknown>;
			const key = `${this.manifest.id}:generate-title`;
			if (hotkeys[key] !== undefined) return; // user already bound or cleared it — respect
			hotkeys[key] = [{ modifiers: ["Mod", "Shift"], key: "T" }];
			await adapter.write(path, JSON.stringify(hotkeys, null, 4));
		} catch (e) {
			console.warn("[auto-title] could not set default hotkey", e);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<AutoTitleSettings>);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
