/**
 * Scope drift for /review: changed paths come from git, never from a model. Pure except the git and file readers,
 * which read the committed diff only, so callers must first refuse a working tree that is not HEAD.
 */
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { changedFiles, normalisePathForDrift } from "../execute/progress.ts";
import type { TouchedFile } from "../quality/reviewer.ts";

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

export type BaseRef = { readonly ok: true; readonly ref: string } | { readonly ok: false; readonly reason: string };

function gitOut(cwd: string, args: string[]): { status: number | null; out: string } {
	const r = spawnSync("git", args, { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	return { status: r.status, out: (r.stdout ?? "").trim() };
}

/**
 * The ref an MR into `target` is measured against: the remote-tracking branch when it exists (a local copy can be
 * stale and hide drift), else the local branch, else a refusal that says how to get it.
 */
export function resolveBaseRef(cwd: string, target: string): BaseRef {
	const branch = gitOut(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]).out;
	const remote = (branch !== "" ? gitOut(cwd, ["config", "--get", `branch.${branch}.remote`]).out : "") || "origin";
	const candidates = [`refs/remotes/${remote}/${target}`, `refs/heads/${target}`];
	for (const ref of candidates) {
		if (gitOut(cwd, ["rev-parse", "--verify", "--quiet", ref]).status === 0) return { ok: true, ref };
	}
	return { ok: false, reason: `no "${target}" branch found (looked for ${candidates.join(" and ")}) -- fetch it first: git fetch ${remote} ${target}` };
}

export const LOCKFILE_NAMES: ReadonlySet<string> = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "poetry.lock"]);
export const MAX_TOUCHED_FILE_BYTES = 200_000;
const BINARY_SNIFF_BYTES = 8_000;

/** Full contents of each changed file for the reviewer; deleted, binary and lockfile entries carry a note instead of bytes, and large files are cut. */
export function readTouchedFiles(cwd: string, changed: readonly string[]): TouchedFile[] {
	return changed.map((path) => {
		const abs = join(cwd, path);
		if (!existsSync(abs) || !statSync(abs).isFile()) return { path, contents: "(deleted in this change)" };
		const size = statSync(abs).size;
		if (LOCKFILE_NAMES.has(basename(path))) return { path, contents: `(content omitted: lockfile, ${size} bytes)` };
		const buf = Buffer.alloc(Math.min(size, MAX_TOUCHED_FILE_BYTES));
		const fd = openSync(abs, "r");
		try {
			readSync(fd, buf, 0, buf.length, 0);
		} finally {
			closeSync(fd);
		}
		if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { path, contents: `(content omitted: binary, ${size} bytes)` };
		const text = buf.toString("utf-8");
		return { path, contents: size > MAX_TOUCHED_FILE_BYTES ? `${text}
(truncated: first ${MAX_TOUCHED_FILE_BYTES} of ${size} bytes)` : text };
	});
}
