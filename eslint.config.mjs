import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

// The `obsidian` type declarations are committed at
// `node_modules/.obsidian-types/obsidian.d.ts` and mapped via tsconfig.json `paths`,
// so the types resolve even when the `obsidian` npm package isn't installed — e.g. the
// Obsidian community scorecard's audit, which lints without node_modules. Without it,
// every Obsidian API becomes an `error` type and the type-checked `no-unsafe-*` rules
// fire ~388 false positives. The file lives under node_modules/ specifically because
// that's the only path eslint ignores by default, so the upstream-generated declaration
// isn't itself linted (the scorecard lints every other committed .ts/.d.ts).

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
	]),
);
