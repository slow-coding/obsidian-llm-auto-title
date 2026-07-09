import esbuild from "esbuild";
import { pathToFileURL } from "url";
import { resolve } from "path";

const out = resolve("test/out.mjs");
await esbuild.build({
	entryPoints: ["test/cases.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	alias: { obsidian: resolve("test/obsidian-stub.mjs") },
	outfile: out,
	logLevel: "warning",
});
await import(pathToFileURL(out).href);
