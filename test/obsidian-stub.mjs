// Minimal stub for the `obsidian` module so pure logic in src/util.ts can be
// tested under plain Node (no Obsidian host). Only normalizePath is actually
// called at runtime; the classes are type-only and erased.
export function normalizePath(p) {
	return String(p).replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}
export class TFile {}
export class TFolder {}
export class Vault {}
