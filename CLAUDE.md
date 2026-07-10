# obsidian-llm-auto-title

本地 LLM（默认 LMStudio，兼容任意 OpenAI-compat 服务）给 Obsidian 笔记自动生成标题的插件。plugin id：`llm-auto-title`，`minAppVersion` 1.8.7。

## 发布（Release）

版本号策略（0.x 阶段）：**fix → patch，新功能 → minor**；`minAppVersion` 只在用到新 API 时才升。

发版步骤：
1. 同步 bump `manifest.json` 与 `package.json` 的 `version`（两者必须一致）。
2. `versions.json` 加一行 `"X.Y.Z": "<minAppVersion>"`（Obsidian 社区插件的兼容性门控读它）。
3. 提交 `chore(release): vX.Y.Z`。
4. 打**轻量** tag：`git tag X.Y.Z`（本仓库历史 tag 都是轻量的，不是 `-a`）。

注意：
- `main.js` 是 gitignored 的构建产物，**不进 git**。GitHub Release 的产物（`main.js` + `manifest.json`，有 `styles.css` 就一起）需**手动上传**——本仓库没有 release workflow。
- `npm run build` 不会因版本号变化而改变 `main.js`（版本只写在 manifest 里）。
- push 与 GitHub Release 是对外动作，先确认再做。

## 构建 / 测试 / Lint

- `npm run build` = `tsc -noEmit -skipLibCheck && esbuild(production)` → 输出 `main.js`（CJS，target es2018）。
- `npm run lint` = eslint + `eslint-plugin-obsidianmd`。踩坑：
  - `obsidianmd/prefer-create-el`：用 `createSpan`/`createDiv`，别 `createEl("span")`。
  - `obsidianmd/no-static-styles-assignment`：禁止 `el.style.x=`；动态样式用 `setCssProps({...})`，静态用 CSS class。
  - `obsidianmd/settings-tab/prefer-setting-definitions`：预存 warning，已接受、不阻塞。
  - 滑块要自己显示当前值：`setDynamicTooltip` 已废弃且「always inline」只在新版 Obsidian 生效——自己在 `controlEl` 上 `createSpan` 一个值，`onChange` 里 `setText`。
- tsc 严格：`noUncheckedIndexedAccess`（下标访问返回 `T | undefined`）、`strictNullChecks`——数组下标取值要防 undefined。
- 测试：
  - `node test/run.mjs`：纯单元（util/i18n），不需服务。
  - `node test/run-integration.mjs`：集成，**需要本地 LMStudio 跑着 + 已加载一个 chat 模型**；它 shim 了 `window`，并把 `obsidian` 别名到 stub（集成→`test/integration-stub.mjs`，单元→`test/obsidian-stub.mjs`）。
  - **给 `src/` 新增任何 `obsidian` 导入，都要在对应 stub 里补 export，否则 esbuild 打测试包报 "No matching export"。**

## 本地开发生效（个人 vault）

插件是**复制**（非软链）进 vault 的 `.obsidian/plugins/llm-auto-title/`（vault 路径见 Claude 私有 memory，不入库）。改完代码生效：
1. `npm run build`。
2. 把 `main.js`（版本变了就连 `manifest.json`）复制进 vault 插件目录。
3. Obsidian 里重载插件（设置→第三方插件→关掉再开，或重启）。
4. **绝不覆盖 `data.json`**（那是用户已保存的设置）。

新增 settings 字段不用写迁移：`loadSettings` 用 `Object.assign({}, DEFAULT_SETTINGS, data)`，老 data 自动补默认值。

## Obsidian 类型 / scorecard

tsconfig `paths` 把 `obsidian` 指向 `node_modules/.obsidian-types/obsidian.d.ts`，让源码能 type-check 又不让该 .d.ts 被 lint（scorecard ~388 条假阳性的根因修法；详见全局 CLAUDE.md）。`requestUrl` 等都走这个类型。

## 编写 Obsidian 插件的通用规则（checklist）

改/加功能时按这套来，少踩坑：

- **国际化必做**：所有面向用户的字符串（设置名/描述、Notice、命令名、给 LLM 的 prompt 文案）都必须走 `src/i18n.ts` 的 `t()`，每个 key 同时给 `en` + `zh`。不要硬编码用户可见文案，也不要拿字段名/英文兜底当界面文字。
- **本地 Obsidian 先验证再算完成**：见「本地开发生效」——build + 复制 + 重载，真机跑通才算 done，别只凭 tsc/lint 过就说没问题。
- **重命名走 `fileManager`**：改名/移动用 `app.fileManager.renameFile`（会自动更新其它笔记里的 `[[链接]]` 和 `![[嵌入]]`），**不要**用 `app.vault.rename`（底层、不更新引用；obsidian.d.ts 里它已标 deprecated 并指向 fileManager）。
- **原生 UI 优先**：优先用 Obsidian 原生组件（`SuggestModal` / `FuzzySuggestModal` / `Setting` / `Notice` / `Menu`），少自造 HTML，观感和无障碍都更好。选择菜单要支持数字键/快捷键，就在 `Modal` 子类里 `this.scope.register(...)`（scope 在 open 时入栈、close 时出栈，自动清理）。
- **SuggestModal 的 click/close 竞态**：把"选择"包成 Promise 时，要 override `selectSuggestion(value)` 在 `close()` **之前** settle 结果，并用 `queueMicrotask` 延迟 `onClose` 里的"取消哨兵"。否则点击会先触发 close→onClose→取消，导致**鼠标点击永远判为取消**（键盘能用是因为 handler 自己先 settle 再 close）。见 `src/titlePicker.ts`。
- **模型输出要防 refusal**：当笔记正文是嵌入/链接/空时，模型会回 "Please provide the note…" 之类——必须用 `isRefusalTitle()` 识别并当空处理，**不能让它变成文件名**。见 `src/title.ts`。
- **滑块要显式显示数值 / tsc 严格 + lint 规则 / 新 obsidian 导入要补 stub**：见「构建 / 测试 / Lint」。
