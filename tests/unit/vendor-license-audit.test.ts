/**
 * Vendoring and depending are mutually exclusive, both directions, with provenance required: a package vendored for a
 * missing LICENSE must not also be installed via packages[], or its code runs twice. MUST_BE_VENDORED is authoritative,
 * and the converse direction enumerates the disk so a vendoring without a row is still caught.
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
	/** Where its PROVENANCE.md lives: flat vendorings under `.pi/extensions/` use a `<name>.PROVENANCE.md` sibling. */
	provenancePath: string;
	/** Every tracked path that is this vendoring: a directory pathspec, or the flat file itself. */
	sourcePath: string;
	/**
	 * npm packages that must not appear in packages[] because this vendoring replaces them. For a bundled Pi example the
	 * source package is pi-coding-agent itself, so the alternative it replaces is what matters.
	 */
	mustNotBeInstalled: readonly string[];
}

/** The authoritative vendoring registry: add a row in the same commit as the vendored code. */
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
	// The bundled-example vendorings carry inline headers, not a PROVENANCE.md directory, so the converse direction
	// discovers by header marker.
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

/** A semver-shaped substring, loosely matched: some version must be recorded, not a particular one. */
const VERSION_PATTERN = /\b\d+\.\d+\.\d+\b/;

/** A hex integrity hash of at least SHA-1 length, so SHA-256 records pass without naming an algorithm. */
const HASH_PATTERN = /\b[0-9a-f]{40,}\b/i;

/** True when a packages[] spec names `npmPackageName` (npm or git form), boundary-matched against look-alike names. */
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
				// mustNotBeInstalled, not npmPackageName: the replaced alternative is the invariant that matters.
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
		 * Discovery by entry-point shape plus vendoring header marker, so a vendoring that ships no PROVENANCE.md is still
		 * found. Duplicated from tool-count-baseline.test.ts rather than imported, so a bug in one predicate cannot hide in both.
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

			// A row covers an entry point that is its source path or sits inside its directory.
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
