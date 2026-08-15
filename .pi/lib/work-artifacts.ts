/**
 * FLOW-10 -- the ceremonial-workflow artifact set, fixed as data.
 *
 * PURPOSE. `.planning/research/FEATURES.md` Part 2 names exactly four
 * artifacts across the whole `/grill -> /plan -> /execute -> /review` chain:
 * `SPEC.md` (written by `/grill`), `PLAN.md` (written by `/plan`), `REVIEW.md`
 * (written by `/review`) and a `PROGRESS.md` append (written by `/execute`).
 * FOUR files, each with a named downstream consumer -- a section, and a file,
 * with no named consumer does not ship (FEATURES.md Part 2's own design
 * rule). Before this plan there was no single place that answered "what is
 * an artifact and where does it live" -- each of the four future ceremonial
 * commands would otherwise have had to invent its own answer, and four
 * independently-invented answers is how they drift apart. This module is
 * that one place. It is a plan-09-03 precondition for plans 09-08/10/13/15,
 * which build the commands that read and write these names.
 *
 * `.pi/lib/` is deliberately NOT under `.pi/extensions/`: `package.json`'s
 * `pi.extensions` is `["./.pi/extensions"]` only, so Pi never tries to
 * auto-discover this directory as an extension, and
 * `tests/unit/extension-layout.test.ts`'s BOOT-05 shape assertion never has
 * to be scoped around it -- the same precedent `.pi/lib/jsonl.ts` set in
 * Phase 2/4.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (BOOT-10)
 * ---------------------------------------------------------------------------
 * This module registers nothing. It does not spell the tool-registration
 * call, in code or in prose -- `tests/unit/contributing-boundary.test.ts`
 * matches that call's name as a plain substring across every tracked source
 * under `.pi/extensions/`, comments included, and grants this directory no
 * exemption. Nothing in this file calls a registration API of any kind.
 *
 * ---------------------------------------------------------------------------
 * CHOKEPOINT HYGIENE (DIAG-03 / QUAL-02's structural claim)
 * ---------------------------------------------------------------------------
 * This file never reaches a model. It does not spell, even in a comment, the
 * documented direct-completion method on the model registry, its
 * simple-options or streaming siblings, the method that hands back a raw
 * provider object, the other route to a raw provider object, a deep import
 * under the pi-ai package's adapter path, or the model runtime class name --
 * the same six-plus-one bypass routes `tests/unit/chokepoint-lint.test.ts`
 * enumerates for DIAG-03. Describing them here in the abstract, rather than
 * naming them, is deliberate: `chokepoint-lint.test.ts` matches raw source
 * text, comments included, and grants this module no exemption.
 *
 * ---------------------------------------------------------------------------
 * PURE, NO I/O
 * ---------------------------------------------------------------------------
 * This module reads no file and writes nothing. {@link workDir} computes a
 * path string; it never creates the directory it names. The future caller
 * that actually writes `SPEC.md`/`PLAN.md`/`REVIEW.md`/`PROGRESS.md` under
 * that path owns `mkdirSync`/`writeFileSync`, not this module.
 *
 * ---------------------------------------------------------------------------
 * Path discipline: two-layer confinement, not one
 * ---------------------------------------------------------------------------
 * `.pi/lib/jsonl.ts`'s own module docstring records the falsification result
 * that motivates this: a character allowlist on the untrusted segment and a
 * resolved-path containment assertion each catch inputs the other does not
 * -- `..` slips past containment when the allowlist is loosened, and
 * `wire/../../evil`-shaped input slips past an allowlist alone if containment
 * is skipped. {@link workDir} carries both, independently, over a
 * model-supplied `slug` [threat T-09-03-02]:
 *   1. {@link SLUG_PATTERN} rejects anything that is not a bounded run of
 *      lowercase alphanumerics and hyphens -- no `/`, no `\`, no `..`, no
 *      leading dot, before `join` ever sees the value.
 *   2. The resolved path is asserted to sit inside
 *      `resolve(cwd, ".pi", "work")` before it is ever returned.
 * `workDir` THROWS on either failure -- fail closed, the same posture
 * `.pi/extensions/safety/git.ts:462-465` states for an unclassified `glab`
 * form: an untrusted input that cannot be positively classified as safe is
 * refused, not defaulted through.
 */

import { join, resolve, sep } from "node:path";

/**
 * The four ceremonial-workflow artifacts, in the order `/grill -> /plan ->
 * /execute -> /review` produces and consumes them. Exactly four -- FLOW-10's
 * cap -- and `tests/unit/work-artifacts.test.ts` asserts the count directly
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
