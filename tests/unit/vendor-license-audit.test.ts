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

const EXT_DIR = ".pi/extensions";
const SETTINGS_PATH = join(".pi", "settings.json");

interface VendoredRow {
	/** Repo-relative directory the package's source files live under. */
	vendorPath: string;
	/** The npm package name this directory is a source-form copy of. */
	npmPackageName: string;
	/** Why it is vendored rather than installed. */
	why: string;
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
		npmPackageName: "pi-loop-police",
		why: "no LICENSE file in tarball; GitHub API reports license=NONE (EXT-10)",
	},
	// Later plans in this wave append rows here for the vendored bundled
	// examples (plan-mode/, todo.ts, questionnaire.ts, git-checkpoint.ts).
	// This registry — not docs/EXTENSIONS.md's prose table — is what this
	// audit actually enforces.
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

function readSettingsPackages(): string[] {
	const raw = JSON.parse(readFileSync(join(repoRoot(), SETTINGS_PATH), "utf-8")) as {
		packages?: unknown;
	};
	if (raw.packages === undefined) {
		// Correct before plan 07-09 lands: Plan 01 created `.pi/settings.json`
		// as `{}`, and an absent key must read as "no packages", never as a
		// vacuous pass over `undefined`.
		return [];
	}
	if (!Array.isArray(raw.packages)) {
		throw new Error(`${SETTINGS_PATH} "packages" is present but not an array`);
	}
	return raw.packages as string[];
}

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
			const tracked = trackedFiles(row.vendorPath);
			const tsFiles = tracked.filter((p) => p.endsWith(".ts"));
			expect(
				tsFiles.length,
				`no tracked .ts file under ${row.vendorPath} — a "vendored" package with no committed ` +
					"source is not actually vendored, it is a directory that does not exist in the clone " +
					"anyone else makes",
			).toBeGreaterThanOrEqual(1);

			const provenancePath = `${row.vendorPath}/PROVENANCE.md`;
			expect(
				tracked,
				`${provenancePath} is not tracked by git. Discovery here uses git's index ` +
					"(trackedFiles), never readdirSync, specifically so an untracked scratch directory " +
					"on this machine cannot satisfy the audit",
			).toContain(provenancePath);
		});
	});

	describe("Direction 2 — and it is NOT also an npm dependency", () => {
		it.each(MUST_BE_VENDORED)(
			"$npmPackageName does not appear in .pi/settings.json packages[]",
			(row) => {
				const packages = readSettingsPackages();
				const offenders = packages.filter((spec) => specNamesPackage(spec, row.npmPackageName));
				expect(
					offenders,
					`${SETTINGS_PATH} packages[] names ${row.npmPackageName} (${offenders.join(", ")}), ` +
						`which is also vendored at ${row.vendorPath}. Vendoring exists because this ` +
						"package fails the license check; installing it too means the unreviewed npm " +
						"copy runs alongside the reviewed one — vendoring and depending must be mutually " +
						"exclusive",
				).toEqual([]);
			},
		);
	});

	describe("Direction 3 — provenance is recoverable", () => {
		it.each(MUST_BE_VENDORED)("$vendorPath/PROVENANCE.md names the package, a version and a hash", (row) => {
			const provenance = readFileSync(join(repoRoot(), row.vendorPath, "PROVENANCE.md"), "utf-8");

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
			const provenanceFiles = trackedFiles(EXT_DIR).filter((p) => p.endsWith("/PROVENANCE.md"));

			expect(
				provenanceFiles.length,
				`no tracked PROVENANCE.md found anywhere under ${EXT_DIR}/ — Direction 1 above already ` +
					"requires at least one to exist for every MUST_BE_VENDORED row, so this finding " +
					"nothing means the discovery pathspec itself is broken, not that nothing is vendored",
			).toBeGreaterThanOrEqual(1);

			const knownPaths = new Set(MUST_BE_VENDORED.map((row) => row.vendorPath));
			const undeclared = provenanceFiles
				.map((p) => dirname(p))
				.filter((dir) => !knownPaths.has(dir));

			expect(
				undeclared,
				"these directories carry a PROVENANCE.md (i.e. something was vendored there) but have " +
					"no row in MUST_BE_VENDORED — exactly the present-but-undeclared failure shape " +
					"tests/unit/workflow-budgets.test.ts already guards in its own domain. Add a row for " +
					"each, or remove the directory if it should not exist",
			).toEqual([]);
		});
	});
});
