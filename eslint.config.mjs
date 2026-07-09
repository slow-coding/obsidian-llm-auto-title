import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

/**
 * Type-checked `@typescript-eslint/no-unsafe-*` rules require the `obsidian`
 * package types to resolve. The Obsidian community scorecard lints the published
 * source in an environment where `obsidian` is not installed, so every Obsidian
 * API becomes an `error` type and these rules fire ~388 false positives. They are
 * therefore OFF in the default config (what the scorecard runs via `npm run lint`);
 * enable them locally with `npm run lint:types` (LINT_STRICT_TYPES=1) when obsidian
 * is installed. Type safety is still enforced by `tsc -noEmit` in the build.
 */
const strictTypes = process.env.LINT_STRICT_TYPES === "1";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.mjs", "manifest.json"],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	...obsidianmd.configs.recommended,
	// Default (what the scorecard runs): turn the type-checked no-unsafe rules
	// OFF so they can't false-positive without obsidian types. Strict mode
	// (LINT_STRICT_TYPES=1) omits this block, leaving obsidianmd's
	// recommendedTypeChecked to keep them "error" (needs obsidian installed).
	...(strictTypes
		? []
		: [
				{
					rules: {
						"@typescript-eslint/no-unsafe-call": "off",
						"@typescript-eslint/no-unsafe-assignment": "off",
						"@typescript-eslint/no-unsafe-member-access": "off",
						"@typescript-eslint/no-unsafe-argument": "off",
						"@typescript-eslint/no-unsafe-return": "off",
					},
				},
			]),
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.mjs",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"test",
	]),
);
