/**
 * EXT-10 — vendoring and depending are mutually exclusive, checked in both
 * directions, with provenance required.
 *
 * WHY THIS FILE EXISTS. A vendored directory that merely EXISTS proves
 * nothing on its own: the trap this phase is built to close is a package
 * that is vendored (because it shipped no LICENSE file) while an earlier
 * draft's `.pi/settings.json` `packages[]` entry for the SAME package is
 * left in place. That silently defeats EXT-10 — the code runs from BOTH the
 * vendored copy and an npm install, and no other test in this repository
 * would notice. `tests/unit/npmrc-policy.test.ts`'s own methodology note is
 * the governing rule here too: check the EFFECT (is the package actually
 * absent from the dependency surface), never a file's mere presence.
 *
 * STRUCTURAL ANALOG. `tests/unit/template-tracked.test.ts`'s
 * `MUST_BE_SHIPPED` / `MUST_BE_SWALLOWED` two-table shape, and its "a
 * meaningful number of paths in both directions" vacuity guard, is copied
 * here as `MUST_BE_VENDORED` plus the converse enumeration in Direction 4.
 *
 * THE REGISTRY IS AUTHORITATIVE, NOT PROSE. `MUST_BE_VENDORED` below is the
 * single list this file and every future plan in this phase's wave append
 * rows to (the vendored bundled examples — `plan-mode/`, `todo.ts`,
 * `questionnaire.ts`, `git-checkpoint.ts` — land in later plans). A vendored
 * item that is not a row here is invisible to this audit; Direction 4 exists
 * specifically to catch that omission by enumerating the disk instead of
 * trusting the list to stay complete on its own.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";
import { readSettingsPackages, SETTINGS_PATH } from "../helpers/settings.ts";

const EXT_DIR = ".pi/extensions";

interface VendoredRow {
	/** Repo-relative directory the package's source files live under. */
	vendorPath: string;
	/** The npm package name this directory is a source-form copy of. */
	npmPackageName: string;
	/** Why it is vendored rather than installed. */
	why: string;
	/**
	 * Where this vendoring's `PROVENANCE.md` lives (WR-15).
	 *
	 * Was implicitly `${vendorPath}/PROVENANCE.md`. That assumption is why
	 * `todo.ts` and `questionnaire.ts` could not have rows at all: decision
	 * D-07-D puts vendored items FLAT under `.pi/extensions/`, so they have no
	 * directory to hold one. Explicit here, and their records are
	 * `<name>.PROVENANCE.md` siblings.
	 */
	provenancePath: string;
	/**
	 * Every tracked path that IS this vendoring — a directory pathspec for a
	 * directory vendoring, the file itself for a flat one. Fed to
	 * `trackedFiles()`, which takes a git pathspec, so both shapes work.
	 */
	sourcePath: string;
	/**
	 * npm packages that must NOT appear in `.pi/settings.json` `packages[]`
	 * because this vendoring exists instead of them (WR-15).
	 *
	 * The original registry checked only {@link npmPackageName}, which is the
	 * package the source was COPIED FROM. For the four bundled-example
	 * vendorings that is `@earendil-works/pi-coding-agent` — a devDependency
	 * nobody would put in `packages[]`, so the check would have been true and
	 * meaningless. The invariant that actually matters for them is the
	 * ALTERNATIVE they exist instead of: vendoring plan-mode and also installing
	 * `@narumitw/pi-plan-mode` would run the unreviewed copy alongside the
	 * reviewed one, which is the same failure EXT-10's license rule is about.
	 */
	mustNotBeInstalled: readonly string[];
}

/**
 * The authoritative vendoring registry — not prose, not `docs/EXTENSIONS.md`.
 * Add a row here in the SAME commit that adds the vendored directory; a
 * vendored package with no row is caught by Direction 4 below, not silently
 * accepted.
 */
const MUST_BE_VENDORED: readonly VendoredRow[] = [
	{
		vendorPath: ".pi/extensions/loop-police",
		sourcePath: ".pi/extensions/loop-police",
		provenancePath: ".pi/extensions/loop-police/PROVENANCE.md",
		npmPackageName: "pi-loop-police",
		mustNotBeInstalled: ["pi-loop-police"],
		why: "no LICENSE file in tarball; GitHub API reports license=NONE (EXT-10)",
	},
	{
		vendorPath: ".pi/extensions/background-tasks",
		sourcePath: ".pi/extensions/background-tasks",
		provenancePath: ".pi/extensions/background-tasks/PROVENANCE.md",
		npmPackageName: "pi-background-tasks",
		mustNotBeInstalled: ["pi-background-tasks"],
		why: "D-02 (08.1-05) -- pi-background-tasks@2.6.9 caps its Pi peers at ^0.84.0 so it cannot install on Pi 1.x; " +
			"vendored process-only (bg_run/bg_status/bg_logs/bg_kill), no fusion/delegate/attested/update-check",
	},
	// WR-15: the four rows below were promised by a comment ("Later plans in
	// this wave append rows here") and never appended. All four plans landed in
	// this phase, so four vendored items in the tool-execution path sat outside
	// EXT-10's own audit -- and Direction 4, which exists to catch precisely
	// that, could not fire because it discovered vendorings by scanning for
	// PROVENANCE.md and none of them shipped one. Both halves are fixed: the
	// records now exist, and Direction 4 discovers by HEADER MARKER instead.
	{
		vendorPath: ".pi/extensions/plan-mode",
		sourcePath: ".pi/extensions/plan-mode",
		provenancePath: ".pi/extensions/plan-mode/PROVENANCE.md",
		npmPackageName: "@earendil-works/pi-coding-agent",
		mustNotBeInstalled: ["@narumitw/pi-plan-mode"],
		why: "EXT-06 -- Pi's own bundled example instead of @narumitw/pi-plan-mode@0.49.3, whose " +
			"@narumitw/pi-tui-kit@^0.49.1 caret range this repo cannot exactly pin",
	},
	{
		vendorPath: ".pi/extensions/checkpoint",
		sourcePath: ".pi/extensions/checkpoint",
		provenancePath: ".pi/extensions/checkpoint/PROVENANCE.md",
		npmPackageName: "@earendil-works/pi-coding-agent",
		mustNotBeInstalled: ["@davideasden/pi-undo", "@pi-plugins/checkpoint", "pi-rewind", "@ayulab/pi-rewind"],
		why: "EXT-07 -- re-authored from Pi's bundled git-checkpoint.ts; every third-party " +
			"file-checkpointing candidate is unlicensed-in-metadata, beta-runtime-dependent, stale or archived",
	},
	{
		vendorPath: ".pi/extensions/todo.ts",
		sourcePath: ".pi/extensions/todo.ts",
		provenancePath: ".pi/extensions/todo.PROVENANCE.md",
		npmPackageName: "@earendil-works/pi-coding-agent",
		mustNotBeInstalled: ["@juicesharp/rpiv-todo"],
		why: "EXT-06 -- Pi's own bundled example instead of @juicesharp/rpiv-todo@2.5.2, whose " +
			"rpiv-config@^2.5.2 and typebox@^1.1.24 caret ranges would install a second typebox instance",
	},
	{
		vendorPath: ".pi/extensions/questionnaire.ts",
		sourcePath: ".pi/extensions/questionnaire.ts",
		provenancePath: ".pi/extensions/questionnaire.PROVENANCE.md",
		npmPackageName: "@earendil-works/pi-coding-agent",
		mustNotBeInstalled: ["@juicesharp/rpiv-ask-user-question"],
		why: "EXT-06 -- Pi's own bundled example instead of @juicesharp/rpiv-ask-user-question@2.5.2, " +
			"which carries the identical rpiv-config/typebox caret defect",
	},
];

/** A semver-shaped substring, e.g. "1.14.1". Loosely matched on purpose: this
 * test does not care which exact version is recorded, only that SOME version
 * is — pinning the exact string would make this file a second place a
 * version bump has to touch. */
const VERSION_PATTERN = /\b\d+\.\d+\.\d+\b/;

/** A hex integrity hash of at least SHA-1 length (40 hex chars); this repo's
 * own PROVENANCE.md files record SHA-256 (64 hex chars), but the pattern is
 * left loose enough to accept either without hardcoding an algorithm name. */
const HASH_PATTERN = /\b[0-9a-f]{40,}\b/i;

/**
 * True when `spec` (a `.pi/settings.json` packages[] entry) names
 * `npmPackageName` — as `npm:<name>@<ref>`, `npm:<name>`, or a git spec whose
 * final path segment is the package name. Matched with boundaries so
 * `pi-loop-police-fork` cannot be mistaken for `pi-loop-police`.
 */
function specNamesPackage(spec: string, npmPackageName: string): boolean {
	const escaped = npmPackageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|[:/])${escaped}(@|$)`).test(spec);
}

describe("EXT-10 — vendoring and depending are mutually exclusive", () => {
	it("asserts a meaningful number of vendored rows (guards against a vacuous pass)", () => {
		expect(
			MUST_BE_VENDORED.length,
			"MUST_BE_VENDORED is empty — every assertion below iterates this list, so an empty " +
				"registry would make the whole file pass having checked nothing",
		).toBeGreaterThanOrEqual(1);
	});

	describe("Direction 1 — the vendored copy is really there", () => {
		it.each(MUST_BE_VENDORED)("$vendorPath has tracked .ts source and a tracked PROVENANCE.md", (row) => {
			const tracked = trackedFiles(row.sourcePath);
			const tsFiles = tracked.filter((p) => p.endsWith(".ts"));
			expect(
				tsFiles.length,
				`no tracked .ts file under ${row.sourcePath} — a "vendored" package with no committed ` +
					"source is not actually vendored, it is a directory that does not exist in the clone " +
					"anyone else makes",
			).toBeGreaterThanOrEqual(1);

			expect(
				trackedFiles(row.provenancePath),
				`${row.provenancePath} is not tracked by git. Discovery here uses git's index ` +
					"(trackedFiles), never readdirSync, specifically so an untracked scratch directory " +
					"on this machine cannot satisfy the audit",
			).toContain(row.provenancePath);
		});
	});

	describe("Direction 2 — and neither it nor the alternative it replaces is an npm dependency", () => {
		it.each(MUST_BE_VENDORED)(
			"$vendorPath: nothing it must not be installed alongside appears in .pi/settings.json packages[]",
			(row) => {
				const packages = readSettingsPackages();
				// WR-15: `mustNotBeInstalled`, not `npmPackageName`. For the four
				// bundled-example vendorings the source package is
				// `@earendil-works/pi-coding-agent`, a devDependency nobody would put
				// in packages[] -- checking it would have been true and meaningless.
				// The invariant that matters is the ALTERNATIVE each exists instead of.
				const offenders = packages.filter((spec) =>
					row.mustNotBeInstalled.some((name) => specNamesPackage(spec, name)),
				);
				expect(
					offenders,
					`${SETTINGS_PATH} packages[] names ${offenders.join(", ")}, which ${row.vendorPath} ` +
						"is vendored INSTEAD OF. Installing it too means the unreviewed npm copy runs " +
						"alongside the reviewed one — vendoring and depending must be mutually exclusive",
				).toEqual([]);
			},
		);

		it("mustNotBeInstalled is non-empty on every row (guards a vacuous Direction 2)", () => {
			// A row with an empty list passes the case above having checked nothing.
			const empty = MUST_BE_VENDORED.filter((row) => row.mustNotBeInstalled.length === 0);
			expect(empty.map((r) => r.vendorPath), "a vendoring with no forbidden alternative is unaudited").toEqual([]);
		});
	});

	describe("Direction 3 — provenance is recoverable", () => {
		it.each(MUST_BE_VENDORED)("$provenancePath names the package, a version and a hash", (row) => {
			const provenance = readFileSync(join(repoRoot(), row.provenancePath), "utf-8");

			expect(
				provenance.includes(row.npmPackageName),
				`PROVENANCE.md at ${row.vendorPath} does not name ${row.npmPackageName} anywhere — a ` +
					"vendored file with no recorded upstream package name is code with no update path",
			).toBe(true);

			expect(
				VERSION_PATTERN.test(provenance),
				`PROVENANCE.md at ${row.vendorPath} carries no version-shaped string (expected ` +
					`${VERSION_PATTERN}) — without a recorded version, nobody can tell whether this ` +
					"copy is current or how far it has drifted from upstream",
			).toBe(true);

			expect(
				HASH_PATTERN.test(provenance),
				`PROVENANCE.md at ${row.vendorPath} carries no integrity-hash-shaped string (expected ` +
					`${HASH_PATTERN}) — without a recorded hash the exact bytes that were reviewed ` +
					"cannot be re-derived from the upstream tarball",
			).toBe(true);
		});
	});

	describe("Direction 4 — the converse: no vendored package silently drops out of the registry", () => {
		it("every tracked PROVENANCE.md under .pi/extensions/ has a matching MUST_BE_VENDORED row", () => {
			const provenanceFiles = trackedFiles(EXT_DIR).filter((p) => p.endsWith("PROVENANCE.md"));

			expect(
				provenanceFiles.length,
				`no tracked PROVENANCE.md found anywhere under ${EXT_DIR}/ — Direction 1 above already ` +
					"requires at least one to exist for every MUST_BE_VENDORED row, so this finding " +
					"nothing means the discovery pathspec itself is broken, not that nothing is vendored",
			).toBeGreaterThanOrEqual(1);

			const knownProvenance = new Set(MUST_BE_VENDORED.map((row) => row.provenancePath));
			const undeclared = provenanceFiles.filter((p) => !knownProvenance.has(p));

			expect(
				undeclared,
				"these files are a vendoring record (i.e. something was vendored) but have no row in " +
					"MUST_BE_VENDORED — exactly the present-but-undeclared failure shape " +
					"tests/unit/workflow-budgets.test.ts already guards in its own domain. Add a row for " +
					"each, or remove the file if it should not exist",
			).toEqual([]);
		});

		/**
		 * WR-15 — the discovery that can actually fire.
		 *
		 * The check above is necessary and was never sufficient: it discovers
		 * vendorings by the presence of a `PROVENANCE.md`, so a vendoring that
		 * ships none is invisible to it. That is not hypothetical — it is exactly
		 * what happened. Four bundled-example vendorings (plan-mode/, checkpoint/,
		 * todo.ts, questionnaire.ts) landed in this phase using inline headers
		 * instead, the registry comment promising rows for them was never acted
		 * on, and this file enumerated one directory, found one row, and passed.
		 * Structurally incapable of firing for the omission that occurred — the
		 * same shape as CR-04.
		 *
		 * Discovery is now "a tracked `.ts` under `.pi/extensions/` at an
		 * entry-point shape whose header carries a vendoring marker", which is
		 * what `tool-count-baseline.test.ts:discoverVendoredEntryPoints()` already
		 * implements. That predicate is duplicated here rather than imported for
		 * one reason, stated: importing a helper from another TEST file makes the
		 * two suites share a fixture, and a bug in the shared predicate then hides
		 * itself from both at once. The constants below are deliberately spelled
		 * out so a drift between the two is a visible diff.
		 */
		it("every tracked, vendored-MARKED entry point has a MUST_BE_VENDORED row", () => {
			/** `.pi/extensions/<name>.ts` — a flat entry point. */
			const FLAT = /^\.pi\/extensions\/[^/]+\.ts$/;
			/** `.pi/extensions/<dir>/index.ts` — a nested entry point. */
			const NESTED_INDEX = /^\.pi\/extensions\/[^/]+\/index\.ts$/;
			/** The header marker every vendoring in this repo carries, in either casing. */
			const VENDORED_MARKER = /VENDORED\b|vendored from|Re-authored from Pi's own bundled example/;

			const discovered = trackedFiles(EXT_DIR)
				.filter((p) => p.endsWith(".ts"))
				.filter((p) => FLAT.test(p) || NESTED_INDEX.test(p))
				.filter((p) => VENDORED_MARKER.test(readFileSync(join(repoRoot(), p), "utf-8")))
				.sort();

			expect(
				discovered.length,
				"the vendored-entry-point scan found nothing at all. This repository vendors at least five " +
					"items, so an empty result means the discovery predicate is broken, not that nothing is " +
					"vendored — and a broken predicate is how this direction failed to fire in the first place",
			).toBeGreaterThanOrEqual(5);

			// A row covers an entry point when the row's own source path IS it, or
			// is the directory holding it.
			const covered = new Set<string>();
			for (const row of MUST_BE_VENDORED) {
				covered.add(row.sourcePath);
				covered.add(`${row.sourcePath}/index.ts`);
			}
			const undeclared = discovered.filter((p) => !covered.has(p) && !covered.has(dirname(p)));

			expect(
				undeclared,
				"these files carry a vendoring marker in their own header but are not audited by EXT-10's " +
					"registry — no license check, no must-not-also-be-installed check, no recoverable " +
					"provenance. This is the direction that could not fire before WR-15: it discovered " +
					"vendorings by their PROVENANCE.md, and the four that had none were invisible to it",
			).toEqual([]);
		});
	});
});
