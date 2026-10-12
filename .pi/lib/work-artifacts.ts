/**
 * The ceremonial-workflow artifact set, fixed as data: the one place that says what an artifact is and where it lives.
 * Four files, each with a named downstream consumer (`.planning/research/FEATURES.md` Part 2).
 *
 * Registers nothing and never spells the tool-registration call (contributing-boundary.test.ts matches it as a substring).
 * Never reaches a model; chokepoint-lint.test.ts matches raw source text, so the bypass routes are not named even here.
 * Pure: {@link workDir} computes a path and never creates it; the caller that writes the artifacts owns the I/O.
 *
 * {@link workDir} confines a model-supplied `slug` twice, because each layer catches inputs the other misses:
 * {@link SLUG_PATTERN} admits only a bounded run of lowercase alphanumerics and hyphens, and the resolved path must
 * sit inside `resolve(cwd, ".pi", "work")`. It THROWS on either failure (fail closed).
 */

import { join, resolve, sep } from "node:path";

/**
 * The four ceremonial-workflow artifacts, in the order `/grill -> /plan ->
 * /execute -> /review` produces and consumes them. Exactly four, and
 * `tests/unit/work-artifacts.test.ts` asserts the count directly
 * so a fifth cannot be added silently.
 *
 * `consumer` names the downstream reader per FEATURES.md Part 2's own design
 * rule ("every artifact section must have a named consumer"): a file with no
 * named consumer does not ship.
 */
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

/**
 * A legal `.pi/work/<slug>/` slug: a bounded run of lowercase alphanumerics
 * and hyphens, starting with an alphanumeric. No path separators (`/`, `\`),
 * no `.` of any kind (so `..` is rejected before it can even be considered a
 * traversal attempt, not merely caught as one), and no empty string.
 *
 * Anchored at both ends (`^`...`$`, no `g`/`m` flags) so `.test()` reports a
 * FULL match, never a substring hit.
 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * The absolute path of `.pi/work/<slug>/` under `cwd`, for a slug that has
 * passed both layers of the confinement described in this module's own
 * docstring. Throws, rather than returning a fallback, on either failure --
 * fail closed.
 *
 * Never creates the directory. Never reads or writes anything. `cwd` is
 * joined with the literal `".pi"` and `"work"` segments via `node:path.join`
 * only, matching this repo's own path-discipline rule (never a hardcoded
 * `.pi` string-concatenated with a separator, never a manual `/`/`\` join).
 */
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
