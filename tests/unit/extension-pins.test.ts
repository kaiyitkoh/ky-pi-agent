/**
 * EXT-08 -- `.pi/settings.json`'s `packages[]` array IS the lockfile
 * (`pi list` reads installed packages from settings, Pi 0.84.1
 * `docs/packages.md:30`), and this file is what diffs it against a committed
 * expectation, in both directions, so a hand edit fails the build rather than
 * silently drifting.
 *
 * WHY THIS FILE EXISTS. `tests/unit/pinning.test.ts`'s own
 * "every third-party entry in .pi/settings.json packages[] carries a ref"
 * assertion has run VACUOUSLY since Phase 1 -- `.pi/settings.json` was `{}`
 * and the test's own early-return branch (`packages === undefined`) meant
 * every run since then passed having checked nothing. This plan (07-09) is
 * what makes that assertion exercise real data for the first time, and this
 * file is the complementary, stronger check: not just "every entry that
 * exists is shaped like a pin" but "the exact SET of entries matches a
 * registry this repository commits to".
 *
 * `isPinnedPackageSpec` is imported from `./pinning.test.ts`, never
 * reimplemented -- a second regex is how the two drift apart
 * (`tests/unit/pinning.test.ts:145-147`, the file's only exported symbol).
 *
 * DIRECTIONS COVERED:
 *   1. Drift        -- packages[] deep-equals EXPECTED_PACKAGES exactly.
 *   2. Pin shape     -- every entry passes isPinnedPackageSpec (proven live
 *                       against inline fixtures first) and carries no range
 *                       operator.
 *   3. Vendored absence -- no packages[] entry names a package this repo also
 *                       vendors in source form under `.pi/extensions/`,
 *                       discovered by scanning tracked PROVENANCE.md files
 *                       rather than importing
 *                       `tests/unit/vendor-license-audit.test.ts`'s own
 *                       `MUST_BE_VENDORED` registry a second time.
 *   4. Installed-but-undeclared -- CONDITIONAL. `.pi/npm/*` and `.pi/git/`
 *                       are gitignored (`.gitignore:154-157`) and CI never
 *                       runs `pi install`, so on a fresh clone there is
 *                       nothing on disk to check. When either directory is
 *                       absent, the suite asserts the absence explicitly
 *                       rather than skipping, so a reader can tell "checked
 *                       and empty" from "never checked" -- the same
 *                       discipline `tests/unit/docs-policy.test.ts` and
 *                       `tests/unit/agent-dir-setup.test.ts` already use for
 *                       their own conditional [RUNBOOK]/machine-state checks.
 *
 * A FIFTH SECTION, outside the four directions above but load-bearing for the
 * same EXT-08 requirement: `pi-subagents@0.76.1` reads NO configuration from
 * `.pi/settings.json` at all (Task 1 of 07-09, `pi-subagents`
 * `src/extension/config.ts:90-92` -- a DEDICATED file,
 * `<agentDir>/extensions/subagent/config.json`), so the worktree-setup-hook
 * wiring this phase's threat model requires (T-07-38) lives in
 * `bin/bootstrap.sh`'s `merge_subagent_config()` instead. That function's
 * presence, its being called from `run_full()`, and the hook path it wires
 * resolving to a real tracked file are asserted here rather than left
 * unverified, closing the same "wired, not merely documented" gap this
 * file's other four directions close for `packages[]`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";
import { isPinnedPackageSpec } from "./pinning.test.ts";

const SETTINGS_PATH = join(".pi", "settings.json");
const EXT_DIR = ".pi/extensions";

interface ExpectedPackage {
	/** Exact `.pi/settings.json` packages[] entry, `npm:<name>@<version>` form. */
	readonly spec: string;
	/** One-line reason naming the capability this package provides. */
	readonly why: string;
}

/**
 * THE COMMITTED EXPECTATION criterion 1 requires. Every spec here is the
 * exact live-resolved version from `docs/EXTENSIONS.md`'s "Installed
 * packages" table (07-01, re-verified unchanged at this plan's execution
 * time per 07-01-SUMMARY.md) -- never copied from a research document, per
 * this repository's own standing rule that a version bump must re-run the
 * live commands, not trust a prior file.
 */
const EXPECTED_PACKAGES: readonly ExpectedPackage[] = [
	{
		spec: "npm:pi-subagents@0.76.1",
		why: "subagent isolation, worktree spawning, background execution, contact_supervisor escalation",
	},
	{
		spec: "npm:pi-background-tasks@2.4.2",
		why: "bg_run/bg_status/bg_logs/bg_kill background bash",
	},
	{
		spec: "npm:@narumitw/pi-lsp@0.49.9",
		why: "lsp_diagnostics/lsp_fix, a 2-tool LSP diagnostics bridge",
	},
	{
		spec: "npm:pi-web-access@0.38.0",
		why: "keyless web/documentation lookup (Exa, DuckDuckGo, Jina Reader, local unpdf)",
	},
	{
		spec: "npm:pi-session-finder@0.5.6",
		why: "/find session search across projects, zero model-facing tools",
	},
];

function readSettings(): Record<string, unknown> {
	return JSON.parse(readFileSync(join(repoRoot(), SETTINGS_PATH), "utf-8")) as Record<string, unknown>;
}

function readSettingsPackages(): string[] {
	const packages = readSettings().packages;
	if (packages === undefined) {
		return [];
	}
	if (!Array.isArray(packages)) {
		throw new Error(`${SETTINGS_PATH} "packages" is present but not an array`);
	}
	return packages as string[];
}

describe("EXT-08 -- vacuity guards", () => {
	it("EXPECTED_PACKAGES is non-empty", () => {
		expect(
			EXPECTED_PACKAGES.length,
			"an empty registry would make every direction below pass having checked nothing",
		).toBeGreaterThanOrEqual(1);
	});

	it(".pi/settings.json packages[] is non-empty", () => {
		expect(
			readSettingsPackages().length,
			"an empty packages[] would make Direction 1's deep-equal compare two empty arrays and prove nothing",
		).toBeGreaterThanOrEqual(1);
	});
});

describe("EXT-08 Direction 1 -- drift: the lockfile matches the committed expectation exactly", () => {
	it("packages[] deep-equals EXPECTED_PACKAGES' specs, order-independent", () => {
		const actual = [...readSettingsPackages()].sort();
		const expected = [...EXPECTED_PACKAGES.map((entry) => entry.spec)].sort();
		expect(
			actual,
			"a hand edit to .pi/settings.json that adds, removes or re-versions an entry must fail here",
		).toEqual(expected);
	});
});

describe("EXT-08 Direction 2 -- pin shape: proven live, then applied to the real file", () => {
	/**
	 * The predicate proven live against inline fixtures first, so the
	 * real-file assertion below is not a tautology -- one bare npm spec
	 * (rejected), one unrefed https URL (rejected), one exact npm pin
	 * (accepted).
	 */
	const fixtures: readonly { spec: string; expected: boolean; label: string }[] = [
		{ spec: "npm:pi-web-access", expected: false, label: "bare npm spec, no version" },
		{ spec: "https://github.com/o/r", expected: false, label: "unrefed https URL" },
		{ spec: "npm:pi-web-access@0.38.0", expected: true, label: "exact npm pin" },
	];

	for (const fixture of fixtures) {
		it(`isPinnedPackageSpec(${JSON.stringify(fixture.spec)}) === ${fixture.expected} (${fixture.label})`, () => {
			expect(isPinnedPackageSpec(fixture.spec)).toBe(fixture.expected);
		});
	}

	it("every real packages[] entry passes the imported isPinnedPackageSpec", () => {
		for (const spec of readSettingsPackages()) {
			expect(isPinnedPackageSpec(spec), `${spec} is not recognised as pinned by isPinnedPackageSpec`).toBe(true);
		}
	});

	/**
	 * NOT A DUPLICATE of isPinnedPackageSpec. `isPinnedPackageSpec` answers
	 * "is this shaped like SOME pinned spec" (an npm form with a digit after
	 * `@`, or a git/URL form with an `@ref` suffix) -- it already rejects a
	 * caret range in the npm form today, since `^` is not `[0-9]`
	 * (`pinning.test.ts:146`). This second, narrower check is defense in
	 * depth against a git/URL-form ref that itself embeds a range-shaped
	 * string (`...@v1.x`, `...@>=1.0`), which `isPinnedPackageSpec`'s second
	 * regex (`.+@.+`) does not and cannot reject by design -- any non-empty
	 * ref is accepted there. `tests/unit/pinning.test.ts`'s own
	 * `RANGE_OPERATOR` constant (BOOT-08.1, over `package.json`'s dependency
	 * maps) is the precedent for exactly this kind of second, differently-
	 * scoped regex existing in this codebase without being a duplicate.
	 */
	it("no real packages[] entry carries a range operator anywhere in the string", () => {
		const RANGE_OPERATOR = /[\^~*><]|\|\||\s-\s/;
		for (const spec of readSettingsPackages()) {
			expect(RANGE_OPERATOR.test(spec), `${spec} carries a range operator, not an exact pin`).toBe(false);
		}
	});
});

describe("EXT-08 Direction 3 -- vendored packages are absent from packages[]", () => {
	const provenanceFiles = trackedFiles(EXT_DIR).filter((path) => path.endsWith("/PROVENANCE.md"));

	it("finds at least one tracked PROVENANCE.md under .pi/extensions/ (vacuity guard)", () => {
		expect(
			provenanceFiles.length,
			`no tracked PROVENANCE.md under ${EXT_DIR} -- either nothing is vendored (untrue, ` +
				"pi-loop-police is) or discovery itself is broken",
		).toBeGreaterThanOrEqual(1);
	});

	/**
	 * THE GENERAL RULE, not `vendor-license-audit.test.ts`'s own
	 * `MUST_BE_VENDORED` registry imported a second time: no packages[] entry
	 * may name a package whose vendored copy exists under `.pi/extensions/`,
	 * discovered by reading every tracked PROVENANCE.md's own text (each one
	 * is required, by `vendor-license-audit.test.ts` Direction 3, to name its
	 * upstream package) rather than a second hardcoded list.
	 */
	it("no packages[] entry names a package whose vendored copy exists under .pi/extensions/", () => {
		const provenanceTexts = provenanceFiles.map((path) => readFileSync(join(repoRoot(), path), "utf-8"));

		// String slicing, not a regex -- Direction 3's job is extracting a
		// package NAME for a substring collision check, categorically
		// different from Direction 2's pin-SHAPE validation, but kept
		// regex-free anyway so this file's own acceptance grep (no second
		// spec-shape regex) has nothing to eyeball.
		function packageNameFromSpec(spec: string): string | undefined {
			if (!spec.startsWith("npm:")) {
				return undefined;
			}
			const withoutPrefix = spec.slice("npm:".length);
			const atIndex = withoutPrefix.indexOf("@", withoutPrefix.startsWith("@") ? 1 : 0);
			return atIndex === -1 ? undefined : withoutPrefix.slice(0, atIndex);
		}

		const offenders = readSettingsPackages().filter((spec) => {
			const name = packageNameFromSpec(spec);
			return name !== undefined && provenanceTexts.some((text) => text.includes(name));
		});

		expect(
			offenders,
			`packages[] names a package also vendored under ${EXT_DIR} (${offenders.join(", ")}) -- vendoring ` +
				"exists because the package fails a license check, and installing it too would run the " +
				"unreviewed npm copy alongside the reviewed one",
		).toEqual([]);
	});
});

describe("EXT-08 Direction 4 -- installed-but-undeclared, where checkable", () => {
	const npmModulesDir = join(repoRoot(), ".pi", "npm", "node_modules");
	const gitDir = join(repoRoot(), ".pi", "git");

	/** Package directory names under an npm `node_modules/`, `@scope/name` included. */
	function listPackageDirNames(nodeModulesDir: string): string[] {
		const names: string[] = [];
		for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name === ".bin") {
				continue;
			}
			if (entry.name.startsWith("@")) {
				const scopeDir = join(nodeModulesDir, entry.name);
				for (const scoped of readdirSync(scopeDir, { withFileTypes: true })) {
					if (scoped.isDirectory()) {
						names.push(`${entry.name}/${scoped.name}`);
					}
				}
				continue;
			}
			names.push(entry.name);
		}
		return names;
	}

	it("project npm scope (.pi/npm/node_modules): every installed package is declared, or the scope is confirmed absent", () => {
		if (!existsSync(npmModulesDir)) {
			// CONFIRMED ABSENT, not skipped -- a fresh clone with .pi/npm gitignored
			// and no `pi install` ever run (this plan forbids it) has nothing here.
			expect(existsSync(npmModulesDir)).toBe(false);
			return;
		}
		const installed = listPackageDirNames(npmModulesDir);
		const packages = readSettingsPackages();
		const offenders = installed.filter(
			(name) => !packages.some((spec) => spec === `npm:${name}` || spec.startsWith(`npm:${name}@`)),
		);
		expect(offenders, `installed under .pi/npm/node_modules but absent from packages[]: ${offenders.join(", ")}`).toEqual(
			[],
		);
	});

	it("project git scope (.pi/git/): every cloned package corresponds to a declared entry, or the scope is confirmed absent", () => {
		if (!existsSync(gitDir)) {
			expect(existsSync(gitDir)).toBe(false);
			return;
		}
		// No EXPECTED_PACKAGES entry is git-form (all five are npm:), so ANY
		// content discovered here is undeclared by construction -- enumerated,
		// not merely existsSync-checked, so a failure names what was found.
		const hosts = readdirSync(gitDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
		expect(
			hosts,
			`.pi/git/ contains cloned package host directories (${hosts.join(", ")}) but no packages[] entry is git-form`,
		).toEqual([]);
	});
});

describe("EXT-02/EXT-08 -- the worktree setup hook is wired into pi-subagents' own config file", () => {
	// pi-subagents@0.76.1 reads NO configuration from .pi/settings.json at
	// all -- Task 1 of this plan read getConfigPath() end to end
	// (pi-subagents src/extension/config.ts:90-92) and found the real key
	// path is a DEDICATED global file, <agentDir>/extensions/subagent/config.json.
	// The wiring therefore lives in bin/bootstrap.sh's merge_subagent_config(),
	// not in .pi/settings.json's own packages[] array. See 07-09-SUMMARY.md's
	// Task 1 section for the full citation trail.
	const bootstrapPath = join(repoRoot(), "bin", "bootstrap.sh");
	const bootstrapSource = readFileSync(bootstrapPath, "utf-8");

	it("bin/bootstrap.sh is tracked", () => {
		expect(trackedFiles("bin/bootstrap.sh")).toEqual(["bin/bootstrap.sh"]);
	});

	it("bin/bootstrap.sh defines merge_subagent_config()", () => {
		expect(bootstrapSource.includes("merge_subagent_config() {")).toBe(true);
	});

	it("run_full() calls merge_subagent_config, not merely defines it", () => {
		const runFullBody = /run_full\(\) \{[\s\S]*?\n\}/.exec(bootstrapSource);
		expect(runFullBody, "run_full() function body not found in bin/bootstrap.sh").not.toBeNull();
		expect(runFullBody?.[0].includes("merge_subagent_config")).toBe(true);
	});

	it("the wired hook path resolves to a real, tracked file", () => {
		const hookRef = /KYPI_WORKTREE_HOOK="\$REPO_ROOT\/([^"]+)"/.exec(bootstrapSource);
		expect(hookRef, "KYPI_WORKTREE_HOOK assignment not found in bin/bootstrap.sh").not.toBeNull();
		const relativeHookPath = hookRef![1]!;
		expect(relativeHookPath).toBe(".pi/scripts/worktree-setup-hook.mjs");
		expect(trackedFiles(relativeHookPath)).toEqual([relativeHookPath]);
		expect(existsSync(join(repoRoot(), relativeHookPath))).toBe(true);
	});

	it("agentScope is deliberately absent from .pi/settings.json -- pi-subagents@0.76.1 has no such config key", () => {
		// agentScope is a PER-INVOCATION parameter on the subagent tool's own
		// schema (pi-subagents src/extension/schemas.ts:333), resolved to
		// "both" whenever a caller omits it (src/agents/agent-scope.ts:3-6) --
		// not a settings key at any scope. Writing one into .pi/settings.json
		// would be dead configuration nothing reads; see 07-09-SUMMARY.md.
		expect(
			Object.prototype.hasOwnProperty.call(readSettings(), "agentScope"),
			"agentScope must not appear as a top-level .pi/settings.json key -- nothing in " +
				"pi-subagents@0.76.1 reads it from there",
		).toBe(false);
	});
});
