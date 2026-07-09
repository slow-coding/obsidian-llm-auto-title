import esbuild from "esbuild";
import { pathToFileURL } from "url";
import { resolve } from "path";

// The plugin uses window.setTimeout/clearTimeout (correct for Obsidian/Electron,
// matches the sample's window.setInterval convention, and avoids @types/node
// NodeJS.Timeout type conflicts). Shim a minimal `window` so the same code runs
// under plain Node for integration testing.
if (!globalThis.window) {
	globalThis.window = {
		setTimeout: (fn, ms, ...args) => setTimeout(fn, ms, ...args),
		clearTimeout: (id) => clearTimeout(id),
		setInterval: (fn, ms, ...args) => setInterval(fn, ms, ...args),
		clearInterval: (id) => clearInterval(id),
	};
}

const out = resolve("test/integration-out.mjs");
await esbuild.build({
	entryPoints: ["test/integration.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	alias: { obsidian: resolve("test/integration-stub.mjs") },
	outfile: out,
	logLevel: "warning",
});
await import(pathToFileURL(out).href);
