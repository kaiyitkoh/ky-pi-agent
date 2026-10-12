/**
 * Scope drift for /review: changed paths come from git, never from a model. Pure except changedFilesSince, which
 * reads the committed diff only; uncommitted and untracked work is deliberately not covered.
 */
import { changedFiles, normalisePathForDrift } from "../execute/progress.ts";

export interface ScopeDriftReport {
	readonly declared: readonly string[];
	readonly changed: readonly string[];
	readonly drifted: readonly string[];
	readonly undelivered: readonly string[];
}

export interface ScopeDriftInput {
	readonly changed: readonly string[];
	readonly specExpectedFiles: readonly string[];
	readonly planFilesTouched: readonly string[];
}

const SHA = /^[0-9a-fA-F]{7,64}$/;

/** Paths changed between baseSha and HEAD. Throws on any git failure so an error never reads as "no drift". */
export function changedFilesSince(cwd: string, baseSha: string): readonly string[] {
	// A non-SHA could be parsed by git as an option.
	if (!SHA.test(baseSha)) {
		throw new Error(`scope drift: base must be a commit SHA, received "${baseSha}"`);
	}
	return changedFiles(cwd, baseSha, "HEAD");
}

/**
 * Compare in both directions: a SPEC can declare five files, deliver one, and look clean if only extras are
 * reported. An empty declaration makes every change drift.
 */
export function compareScope(input: ScopeDriftInput): ScopeDriftReport {
	const declared = [...new Set([...input.specExpectedFiles, ...input.planFilesTouched].map(normalisePathForDrift))].sort();
	const changed = [...new Set(input.changed.map(normalisePathForDrift))].sort();
	const declaredSet = new Set(declared);
	const changedSet = new Set(changed);
	return {
		declared,
		changed,
		drifted: changed.filter((p) => !declaredSet.has(p)),
		undelivered: declared.filter((p) => !changedSet.has(p)),
	};
}
