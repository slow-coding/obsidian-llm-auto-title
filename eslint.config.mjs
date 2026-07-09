import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

// `vendor/obsidian.d.ts` + the tsconfig.json `paths` mapping make the `obsidian`
// types resolvable even when the `obsidian` npm package isn't installed — e.g. the
// Obsidian community scorecard's audit environment, which lints without node_modules.
// Without it every Obsidian API becomes an `error` type and the type-checked
// `no-unsafe-*` rules fire ~388 false positives. `vendor/` is excluded from linting
// below (it's a generated declaration, not our code).

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
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.mjs",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"test",
		"vendor",
	]),
);
