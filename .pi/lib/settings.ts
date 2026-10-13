import { readFileSync } from "node:fs";

export type SettingValue =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly reason: string };

/** Reads one nested key from a settings file: a missing file or key is `ok` with undefined, unparseable JSON is not. */
export function readSettingValue(path: string, keys: readonly string[]): SettingValue {
	let node: unknown;
	try {
		const text = readFileSync(path, "utf-8");
		// Pi strips a leading BOM too: pi 1.1.0 dist/core/settings-manager.js:269.
		node = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return { ok: true, value: undefined };
		return { ok: false, reason: err instanceof Error ? err.message : String(err) };
	}
	for (const key of keys) {
		if (node === null || typeof node !== "object" || Array.isArray(node)) return { ok: true, value: undefined };
		node = (node as Record<string, unknown>)[key];
	}
	return { ok: true, value: node };
}
