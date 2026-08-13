/**
 * PROV-01 / Trap T1 — the shipped config templates survive a fresh clone, and
 * the two filenames that would NOT survive one are asserted to be swallowed.
 *
 * WHY THIS FILE EXISTS. `models.json` and `auth.json` are resolved only from the
 * agent directory [VERIFIED: pi 0.84.1 dist/config.js:423-425], so PROV-01's
 * "a fresh clone contains structurally complete templates" is satisfied by
 * `.pi/templates/*` plus an installer. That makes the FILENAME a hard constraint
 * rather than a preference: `.gitignore:46-47` matches `auth.json` AND
 * `auth.*.json` anywhere in the tree, so `.pi/templates/auth.json` or
 * `.pi/templates/auth.example.json` — the two names `.planning/research/
 * ARCHITECTURE.md` sketched — would produce a clone with no credential template
 * at all, while every other test in this repository stayed green. There is no
 * error message anywhere on that path. This file is the only thing that catches it.
 *
 * BOTH DIRECTIONS, DELIBERATELY. The positive half (the shipped names are
 * committable and tracked) would pass unchanged the day someone renamed the file
 * back to a swallowed name AND remembered to update this table. The negative half
 * pins the trap itself: it fails if `.gitignore` is ever loosened, which is the
 * change that would silently re-open the hole.
 *
 * TRACKED, NOT MERELY COMMITTABLE. "Not ignored" only says git WOULD accept the
 * file. A template sitting un-added on the author's disk is exactly the "absent
 * from every clone while every test passes" outcome this guards, so
 * {@link trackedFiles} is the half that does the real work. [threat T-03-02-04]
 *
 * THE ORACLE IS GIT, NEVER A `.gitignore` PARSER. `isIgnored` already carries
 * both `-q` and `--no-index`; the missing `--no-index` was one of Phase 1's two
 * vacuous passes and the executed evidence is in ../helpers/git.ts:19-31. This
 * file spawns no process of its own.
 *
 * [VERIFIED: executed 2026-08-13, `git check-ignore -v --no-index` over all four
 * names below — the two shipped names produced no matching rule, the two rejected
 * names matched `.gitignore:46:auth.json` and `.gitignore:47:auth.*.json`
 * respectively.]
 */
import { describe, expect, it } from "vitest";

import { isIgnored, trackedFiles } from "../helpers/git.ts";

/** The directory whose tracked contents the positive half is drawn from. */
const TEMPLATE_DIR = ".pi/templates";

/**
 * The names this phase actually ships. Both must be committable AND tracked:
 * `bin/bootstrap.sh` reads them out of the clone, so an absent one turns the
 * installer into a FATAL at best and a silently unconfigured provider at worst.
 */
const MUST_BE_SHIPPED = [
	".pi/templates/models-template.json",
	".pi/templates/auth-template.json",
] as const;

/**
 * The two names `ARCHITECTURE.md` sketched, each with the rule that eats it.
 * Asserting these is the whole point of the file: a rename to either one is a
 * one-word edit that no other test in the repository would notice.
 */
const MUST_BE_SWALLOWED = [
	{ path: ".pi/templates/auth.json", rule: ".gitignore:46 (`auth.json`)" },
	{ path: ".pi/templates/auth.example.json", rule: ".gitignore:47 (`auth.*.json`)" },
] as const;

describe("PROV-01 / Trap T1 — the shipped templates reach a clone", () => {
	it("asserts a meaningful number of paths in both directions", () => {
		expect(
			MUST_BE_SHIPPED.length,
			"both shipped templates must be listed; a table of one leaves the other free to be " +
				"renamed into a swallowed name with nothing to notice",
		).toBe(2);
		expect(
			MUST_BE_SWALLOWED.length,
			"both rejected names must be listed — they are eaten by two DIFFERENT rules " +
				"(`auth.json` and `auth.*.json`), and asserting one would let a tidy-up delete " +
				"the other while this file stayed green",
		).toBe(2);
	});

	it.each(MUST_BE_SHIPPED)("does not ignore %s", (path) => {
		expect(
			isIgnored(path),
			`${path} MUST be committable but git says it is ignored. A fresh clone would be missing ` +
				"the file bin/bootstrap.sh installs into ~/.pi/agent/, so the provider it defines would " +
				"simply not exist — with no error from git, from bootstrap or from Pi",
		).toBe(false);
	});

	it("finds a non-empty tracked file list for the template directory", () => {
		// Assert non-empty BEFORE the membership loop below: `[].includes(x)` is
		// false, so an empty list would turn the tracked half into a set of
		// failures for the right reason -- but a mis-scoped pathspec that returned
		// the WHOLE repo would turn it into a pass that verified nothing.
		const tracked = trackedFiles(TEMPLATE_DIR);
		expect(
			tracked.length,
			`git ls-files reported nothing under ${TEMPLATE_DIR}. Every assertion about tracked-ness ` +
				"reads this list, so an empty or mis-scoped one makes them meaningless",
		).toBeGreaterThan(0);
		expect(
			tracked.every((p) => p.startsWith(`${TEMPLATE_DIR}/`)),
			`git ls-files -- ${TEMPLATE_DIR} returned paths outside it (${tracked.join(", ")}), so the ` +
				"pathspec is not scoping anything and membership below proves less than it appears to",
		).toBe(true);
	});

	it.each(MUST_BE_SHIPPED)("tracks %s in the index, not merely on disk", (path) => {
		expect(
			trackedFiles(TEMPLATE_DIR),
			`${path} is not in git's index. This is the failure the "is it ignored?" question cannot ` +
				"see: the file exists on this machine, every test that reads it passes, and it is absent " +
				"from every clone anyone else makes. Run `git add " +
				path +
				"` and commit it",
		).toContain(path);
	});
});

describe("PROV-01 / Trap T1 — the rejected filenames really are swallowed", () => {
	it.each(MUST_BE_SWALLOWED)("ignores $path", ({ path, rule }) => {
		expect(
			isIgnored(path),
			`${path} is NOT ignored, so ${rule} no longer matches it. That rule is what makes the ` +
				"`-template.json` naming a requirement rather than a style choice; with it loosened, a " +
				"future rename to this name would ship a clone with no credential template while the " +
				"whole suite stayed green. If the loosening was deliberate, this test must be the same " +
				"commit that argues for it",
		).toBe(true);
	});

	it("says a normal source file is NOT ignored (the oracle is live)", () => {
		// Inverted from logs-gitignored.test.ts's control, on purpose. There the
		// risk was an `isIgnored` that returned true for everything; here the
		// negative half above is the one that would go vacuously green under
		// exactly that failure, so the control asserts the false direction.
		expect(
			isIgnored("README.md"),
			"git reported README.md as ignored. That cannot be right, so the oracle itself is broken " +
				"-- a wrong cwd, a misread exit code, a failed spawn -- and every `toBe(true)` above is " +
				"meaningless rather than reassuring",
		).toBe(false);
	});
});
