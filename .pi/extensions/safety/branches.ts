import { join } from "node:path";

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

import { readSettingValue } from "../../lib/settings.ts";

export const BUILTIN_PROTECTED: readonly string[] = ["main", "master"];

/** A push may never reach these; a commit on one is not refused. */
export const BUILTIN_PUSH_ONLY: readonly string[] = ["staging"];

export interface EffectiveBranches {
	readonly protectedBranches: readonly string[];
	readonly pushProtectedBranches: readonly string[];
	readonly warnings: readonly string[];
}

function dedupe(names: readonly string[]): string[] {
	const seen = new Set<string>();
	return names.filter((n) => {
		const key = n.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

// Files are read directly because Pi's settings merge replaces arrays and drops untrusted project settings; add-only lists can only tighten.
// A file that stops parsing mid-session (often mid-edit) keeps the list it last gave this process rather than dropping to the built-ins.
const lastGood = new Map<string, string[]>();

function listFrom(path: string, key: string, warnings: string[]): string[] {
	const read = readSettingValue(path, ["safety", key]);
	const cacheKey = `${key}:${path}`;
	const kept = lastGood.get(cacheKey);
	const fallback = kept === undefined ? "built-in branches only" : `keeping the branches last read from it (${kept.join(", ") || "none"})`;
	if (!read.ok) {
		warnings.push(`${path}: safety.${key} ignored, the file does not parse (${read.reason}); ${fallback}`);
		return kept ?? [];
	}
	if (read.value !== undefined && !Array.isArray(read.value)) {
		warnings.push(`${path}: safety.${key} must be an array of branch names; ignored, ${fallback}`);
		return kept ?? [];
	}
	const values: unknown[] = Array.isArray(read.value) ? read.value : [];
	const list = values.flatMap((v) => (typeof v === "string" && v.trim() !== "" ? [v.trim()] : []));
	lastGood.set(cacheKey, list);
	return list;
}

/** Built-in branches plus those added in the user and project settings files; nothing can be removed and `main` stays first. */
export function effectiveBranches(cwd: string, agentDir: string = getAgentDir()): EffectiveBranches {
	const files = [join(agentDir, "settings.json"), join(cwd, CONFIG_DIR_NAME, "settings.json")];
	const warnings: string[] = [];
	const read = (key: string): string[] => files.flatMap((f) => listFrom(f, key, warnings));
	const added = read("protectedBranches");
	const addedPush = read("pushProtectedBranches");
	return {
		protectedBranches: dedupe([...BUILTIN_PROTECTED, ...added]),
		pushProtectedBranches: dedupe([...BUILTIN_PROTECTED, ...BUILTIN_PUSH_ONLY, ...added, ...addedPush]),
		warnings,
	};
}

export function protectedBranchesFor(cwd: string): readonly string[] {
	return effectiveBranches(cwd).protectedBranches;
}
