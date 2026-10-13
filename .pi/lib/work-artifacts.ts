/**
 * The ceremonial-workflow artifact set and the `.pi/work/<slug>/` paths, fixed as data.
 * Registers nothing and never reaches a model; the raw-source lints match this text, so bypass routes are not named here.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/** The four artifacts in the order /grill -> /plan -> /execute -> /review produces them; a file with no named consumer does not ship. */
export const ARTIFACT_FILES: readonly {
	readonly name: string;
	readonly consumer: string;
}[] = Object.freeze([
	Object.freeze({
		name: "SPEC.md",
		consumer: "/plan (pre-flight gate: SPEC.md must exist and have passed its own ambiguity gate) and /review (requirement verdicts read against SPEC §3/§4)",
	}),
	Object.freeze({
		name: "PLAN.md",
		consumer: "/execute (per-task self-contained handoff) and /review (the files-touched union is the drift baseline)",
	}),
	Object.freeze({
		name: "REVIEW.md",
		consumer: "the human reviewer and the MR (requirement verdicts, findings and the checked-and-cleared section)",
	}),
	Object.freeze({
		name: "PROGRESS.md",
		consumer: "/review's MR body (pasted verification evidence -- commit SHA, verification command, actual output -- per task)",
	}),
]);

/** A legal slug: 1-64 lowercase alphanumerics and hyphens, no separators and no dots, so `..` never gets as far as a traversal check. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The absolute `.pi/work/<slug>/` under `cwd`. Never creates it; THROWS (fail closed) on an illegal slug or a path outside the work root. */
export function workDir(cwd: string, slug: string): string {
	if (!SLUG_PATTERN.test(slug)) {
		throw new Error(
			`refusing to build a work directory for slug ${JSON.stringify(slug)}: it does not match SLUG_PATTERN ` +
				"(a bounded run of lowercase alphanumerics and hyphens, 1-64 characters, no path separators, no dots). " +
				"Fail closed -- an unclassified slug is refused, not defaulted through.",
		);
	}
	const root = resolve(join(cwd, ".pi", "work"));
	const full = resolve(join(root, slug));
	if (full !== root && !full.startsWith(root + sep)) {
		throw new Error(
			`refusing to build a work directory ${full}: it resolves outside the work root ${root}. ` +
				"Work-directory paths are built from cwd + \".pi\" + \"work\" + slug only.",
		);
	}
	return full;
}

/** `.pi/work/` subdirectory names, most recently modified first; with `file`, only those holding it. */
export function workSlugs(cwd: string, file?: string): string[] {
	const root = resolve(join(cwd, ".pi", "work"));
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter((e) => e.isDirectory() && (file === undefined || existsSync(join(root, e.name, file))))
		.map((e) => ({ name: e.name, mtime: statSync(join(root, e.name)).mtimeMs }))
		.sort((a, b) => b.mtime - a.mtime)
		.map((e) => e.name);
}
