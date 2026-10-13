import { existsSync, readFileSync } from "node:fs";

export type SettingValue =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly reason: string };

/** Reads one nested key from a settings file: a missing file or key is `ok` with undefined, unparseable JSON is not. */
export function readSettingValue(path: string, keys: readonly string[]): SettingValue {
	if (!existsSync(path)) return { ok: true, value: undefined };
	let node: unknown;
	try {
		node = JSON.parse(readFileSync(path, "utf-8"));
	} catch (err) {
		return { ok: false, reason: err instanceof Error ? err.message : String(err) };
	}
	for (const key of keys) {
		if (node === null || typeof node !== "object" || Array.isArray(node)) return { ok: true, value: undefined };
		node = (node as Record<string, unknown>)[key];
	}
	return { ok: true, value: node };
}
