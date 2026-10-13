import { readFileSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "./git.ts";

export const SETTINGS_PATH = join(".pi", "settings.json");

/** The committed project settings, parsed fresh each call. */
export function readSettings(): Record<string, unknown> {
	return JSON.parse(readFileSync(join(repoRoot(), SETTINGS_PATH), "utf-8")) as Record<string, unknown>;
}

/** `packages[]` from the project settings; an absent key reads as none, never as a vacuous pass over `undefined`. */
export function readSettingsPackages(): string[] {
	const packages = readSettings().packages;
	if (packages === undefined) return [];
	if (!Array.isArray(packages)) throw new Error(`${SETTINGS_PATH} "packages" is present but not an array`);
	return packages as string[];
}

/** The package name in an `npm:<name>[@<ref>]` spec (scoped names keep their leading `@`), else undefined. */
export function packageNameFromNpmSpec(spec: string): string | undefined {
	if (!spec.startsWith("npm:")) return undefined;
	const name = spec.slice("npm:".length);
	const at = name.indexOf("@", name.startsWith("@") ? 1 : 0);
	return at === -1 ? name : name.slice(0, at);
}
