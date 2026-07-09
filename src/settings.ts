import { App, FuzzySuggestModal, Notice, PluginSettingTab, Setting, TextComponent } from "obsidian";
import type AutoTitlePlugin from "./main";
import { defaultSystemPrompt, t } from "./i18n";
import { momentFormatToRegex, validateUserRegex } from "./util";

export interface AutoTitleSettings {
	baseUrl: string;
	apiKey: string;
	model: string;
	temperature: number;
	maxTokens: number;
	requestTimeoutMs: number;
	enableThinking: boolean;
	reasoningFallback: boolean;
	systemPrompt: string;
	maxContentChars: number;
	titleMaxLength: number;
	timestampFormat: string;
	customRegex: string;
	triggerFolders: string;
	minContentLength: number;
}

export const DEFAULT_SETTINGS: AutoTitleSettings = {
	baseUrl: "http://127.0.0.1:1234",
	apiKey: "",
	model: "",
	temperature: 0.3,
	maxTokens: 1024,
	requestTimeoutMs: 60000,
	enableThinking: false,
	reasoningFallback: true,
	systemPrompt: "",
	maxContentChars: 4000,
	titleMaxLength: 120,
	timestampFormat: "YYYYMMDD_HHmmss",
	customRegex: "",
	triggerFolders: "",
	minContentLength: 1,
};

/** Fuzzy-picker for selecting a chat model from the server's list. */
class ModelSuggestModal extends FuzzySuggestModal<string> {
	constructor(app: App, private models: string[], private onPicked: (id: string) => void) {
		super(app);
		this.setPlaceholder(t("modal.pickModel"));
	}
	getItems(): string[] {
		return this.models;
	}
	getItemText(item: string): string {
		return item;
	}
	onChooseItem(item: string): void {
		this.onPicked(item);
	}
}

export class AutoTitleSettingTab extends PluginSettingTab {
	plugin: AutoTitlePlugin;

	constructor(app: App, plugin: AutoTitlePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const s = this.plugin.settings;
		const save = async (): Promise<void> => {
			await this.plugin.saveSettings();
		};

		// ---------- connection ----------
		new Setting(containerEl).setName(t("set.heading.connection")).setHeading();

		new Setting(containerEl)
			.setName(t("set.baseUrl.name"))
			.setDesc(t("set.baseUrl.desc"))
			.addText((text) =>
				text
					.setValue(s.baseUrl)
					.onChange(async (v) => {
						s.baseUrl = v.trim().replace(/\/+$/, "");
						await save();
					})
			);

		new Setting(containerEl)
			.setName(t("set.apiKey.name"))
			.setDesc(t("set.apiKey.desc"))
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder(t("set.apiKey.ph"))
					.setValue(s.apiKey)
					.onChange(async (v) => {
						s.apiKey = v.trim();
						await save();
					});
			});

		let modelText: TextComponent;
		const modelSetting = new Setting(containerEl)
			.setName(t("set.model.name"))
			.setDesc(t("set.model.desc"));
		modelSetting.addText((text) => {
			modelText = text;
			text
				.setPlaceholder(t("set.model.ph"))
				.setValue(s.model)
				.onChange(async (v) => {
					s.model = v.trim();
					await save();
				});
		});
		modelSetting.addExtraButton((b) =>
			b.setIcon("list")
				.setTooltip(t("modal.pickModel"))
				.onClick(async () => {
					let models: string[];
					try {
						models = await this.plugin.lmstudio.listModels();
					} catch (e) {
						new Notice(t("notice.connFail", { err: e instanceof Error ? e.message : String(e) }), 6000);
						return;
					}
					if (models.length === 0) {
						new Notice(t("notice.noModels"));
						return;
					}
					new ModelSuggestModal(this.app, models, (id) => {
						s.model = id;
						modelText.setValue(id);
						void save();
						new Notice(t("notice.picked", { model: id }));
					}).open();
				})
		);

		new Setting(containerEl)
			.setName(t("set.timeout.name"))
			.setDesc(t("set.timeout.desc"))
			.addText((text) =>
				text
					.setPlaceholder("60000")
					.setValue(String(s.requestTimeoutMs))
					.onChange(async (v) => {
						const n = Number(v);
						if (Number.isFinite(n) && n > 0) {
							s.requestTimeoutMs = Math.round(n);
							await save();
						}
					})
			);

		// ---------- generation ----------
		new Setting(containerEl).setName(t("set.heading.params")).setHeading();

		new Setting(containerEl)
			.setName(t("set.temp.name"))
			.setDesc(t("set.temp.desc"))
			.addSlider((sl) =>
				sl.setLimits(0, 1, 0.05)
					.setValue(s.temperature)
					.onChange(async (v) => {
						s.temperature = v;
						await save();
					})
			);

		new Setting(containerEl)
			.setName(t("set.maxTokens.name"))
			.setDesc(t("set.maxTokens.desc"))
			.addText((text) =>
				text
					.setPlaceholder("1024")
					.setValue(String(s.maxTokens))
					.onChange(async (v) => {
						const n = Math.round(Number(v));
						if (Number.isFinite(n) && n > 0) {
							s.maxTokens = n;
							await save();
						}
					})
			);

		new Setting(containerEl)
			.setName(t("set.thinking.name"))
			.setDesc(t("set.thinking.desc"))
			.addToggle((toggle) =>
				toggle.setValue(s.enableThinking).onChange(async (v) => {
					s.enableThinking = v;
					await save();
				})
			);

		new Setting(containerEl)
			.setName(t("set.fallback.name"))
			.setDesc(t("set.fallback.desc"))
			.addToggle((toggle) =>
				toggle.setValue(s.reasoningFallback).onChange(async (v) => {
					s.reasoningFallback = v;
					await save();
				})
			);

		new Setting(containerEl)
			.setName(t("set.prompt.name"))
			.setDesc(t("set.prompt.desc"))
			.addTextArea((ta) => {
				ta.setPlaceholder(defaultSystemPrompt())
					.setValue(s.systemPrompt)
					.onChange(async (v) => {
						s.systemPrompt = v;
						await save();
					});
				ta.inputEl.rows = 5;
			});

		new Setting(containerEl)
			.setName(t("set.maxContent.name"))
			.setDesc(t("set.maxContent.desc"))
			.addText((text) =>
				text
					.setPlaceholder("4000")
					.setValue(String(s.maxContentChars))
					.onChange(async (v) => {
						const n = Math.round(Number(v));
						if (Number.isFinite(n) && n > 0) {
							s.maxContentChars = n;
							await save();
						}
					})
			);

		new Setting(containerEl)
			.setName(t("set.titleMax.name"))
			.setDesc(t("set.titleMax.desc"))
			.addText((text) =>
				text
					.setPlaceholder("120")
					.setValue(String(s.titleMaxLength))
					.onChange(async (v) => {
						const n = Math.round(Number(v));
						if (Number.isFinite(n) && n > 0) {
							s.titleMaxLength = n;
							await save();
						}
					})
			);

		// ---------- scan scope ----------
		new Setting(containerEl).setName(t("set.heading.scope")).setHeading();

		new Setting(containerEl)
			.setName(t("set.minContent.name"))
			.setDesc(t("set.minContent.desc"))
			.addText((text) =>
				text
					.setPlaceholder("1")
					.setValue(String(s.minContentLength))
					.onChange(async (v) => {
						const n = Math.round(Number(v));
						if (Number.isFinite(n) && n >= 1) {
							s.minContentLength = n;
							await save();
						}
					})
			);

		const fmtSetting = new Setting(containerEl)
			.setName(t("set.fmt.name"))
			.setDesc(this.formatPreview(s.timestampFormat));
		fmtSetting.addText((text) =>
			text
				.setValue(s.timestampFormat)
				.onChange(async (v) => {
					s.timestampFormat = v.trim();
					fmtSetting.descEl.setText(this.formatPreview(s.timestampFormat));
					await save();
				})
		);

		const reSetting = new Setting(containerEl)
			.setName(t("set.customRegex.name"))
			.setDesc(this.regexPreview(s.customRegex));
		reSetting.addText((text) =>
			text
				.setValue(s.customRegex)
				.onChange(async (v) => {
					s.customRegex = v;
					reSetting.descEl.setText(this.regexPreview(s.customRegex));
					await save();
				})
		);

		new Setting(containerEl)
			.setName(t("set.scanFolders.name"))
			.setDesc(t("set.scanFolders.desc"))
			.addTextArea((ta) => {
				ta.setPlaceholder(t("set.scanFolders.desc")).setValue(s.triggerFolders).onChange(async (v) => {
					s.triggerFolders = v;
					await save();
				});
				ta.inputEl.rows = 3;
			});
	}

	private formatPreview(fmt: string): string {
		if (!fmt.trim()) return t("fmt.empty");
		try {
			const re = momentFormatToRegex(fmt);
			const sample = this.sampleForFormat(fmt);
			const ok = re.test(sample);
			return t("fmt.sample", { sample, result: ok ? t("fmt.match") : t("fmt.nomatch") });
		} catch (e) {
			return t("re.invalid", { err: e instanceof Error ? e.message : String(e) });
		}
	}

	private regexPreview(re: string): string {
		const err = validateUserRegex(re);
		if (err) return t("re.invalid", { err });
		if (!re.trim()) return t("re.empty");
		return t("re.valid");
	}

	private sampleForFormat(fmt: string): string {
		return fmt
			.replace(/YYYY/g, "2026")
			.replace(/YY/g, "26")
			.replace(/MM/g, "07")
			.replace(/DD/g, "09")
			.replace(/HH/g, "14")
			.replace(/mm/g, "30")
			.replace(/ss/g, "22")
			.replace(/M/g, "7")
			.replace(/D/g, "9")
			.replace(/H/g, "14")
			.replace(/m/g, "30")
			.replace(/s/g, "22");
	}
}
