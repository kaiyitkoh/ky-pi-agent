/**
 * `.pi/settings.json` packages[] is the lockfile (`pi list` reads it, docs/packages.md:30), diffed both ways against a
 * committed expectation: exact set, pin shape (isPinnedPackageSpec, imported never reimplemented), no package that is
 * also vendored, and nothing installed but undeclared (asserted absent, not skipped, on a fresh clone). pi-subagents
 * reads its own config file, so its worktree hook wiring is asserted in bin/bootstrap.sh instead.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";
import { readSettings, readSettingsPackages } from "../helpers/settings.ts";
import { isPinnedPackageSpec } from "./pinning.test.ts";

const EXT_DIR = ".pi/extensions";

interface ExpectedPackage {
	/** Exact `.pi/settings.json` packages[] entry, `npm:<name>@<version>` form. */
	readonly spec: string;
	/** One line naming the capability this package provides. */
	readonly why: string;
}

/** The committed expectation: each spec's live-resolved version from docs/EXTENSIONS.md's installed-packages table. */
const EXPECTED_PACKAGES: readonly ExpectedPackage[] = [
	{
		spec: "npm:pi-subagents@0.76.1",
		why: "subagent isolation, worktree spawning, background execution, contact_supervisor escalation",
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
	/** Proven live on fixtures first: a bare npm spec and an unrefed URL rejected, an exact npm pin accepted. */
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
	 * Not a duplicate of isPinnedPackageSpec, which accepts any non-empty git ref: this also rejects a range-shaped ref
	 * such as `@v1.x` or `@>=1.0`.
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

	/** No packages[] entry may name a package vendored under `.pi/extensions/`, found from each tracked PROVENANCE.md. */
	it("no packages[] entry names a package whose vendored copy exists under .pi/extensions/", () => {
		const provenanceTexts = provenanceFiles.map((path) => readFileSync(join(repoRoot(), path), "utf-8"));

		// String slicing, not a regex: this extracts a package name, not a spec shape.
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
			// Confirmed absent, not skipped: a fresh clone has no `.pi/npm` (gitignored, never installed).
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
		// Every expected entry is npm-form, so anything here is undeclared; enumerated so a failure names it.
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
	// pi-subagents reads <agentDir>/extensions/subagent/config.json, not .pi/settings.json (src/extension/config.ts:90-92),
	// so the wiring lives in bin/bootstrap.sh's merge_subagent_config().
	const bootstrapSource = readFileSync(join(repoRoot(), "bin", "bootstrap.sh"), "utf-8");
	const stepsSource = readFileSync(join(repoRoot(), "bin", "bootstrap.mjs"), "utf-8");

	it("bin/bootstrap.sh and its JSON steps are tracked", () => {
		expect(trackedFiles("bin")).toEqual(expect.arrayContaining(["bin/bootstrap.mjs", "bin/bootstrap.sh"]));
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
		const hookRef = /hookPath = slashes\(`\$\{ROOT\}\/([^`]+)`\)/.exec(stepsSource);
		expect(hookRef, "hookPath assignment not found in bin/bootstrap.mjs").not.toBeNull();
		const relativeHookPath = hookRef![1]!;
		expect(relativeHookPath).toBe(".pi/scripts/worktree-setup-hook.mjs");
		expect(trackedFiles(relativeHookPath)).toEqual([relativeHookPath]);
		expect(existsSync(join(repoRoot(), relativeHookPath))).toBe(true);
	});

	it("agentScope is deliberately absent from .pi/settings.json -- pi-subagents@0.76.1 has no such config key", () => {
		// agentScope is a per-invocation tool parameter defaulting to "both" (pi-subagents src/agents/agent-scope.js:1-5),
		// not a settings key: writing one would be dead configuration.
		expect(
			Object.prototype.hasOwnProperty.call(readSettings(), "agentScope"),
			"agentScope must not appear as a top-level .pi/settings.json key -- nothing in " +
				"pi-subagents@0.76.1 reads it from there",
		).toBe(false);
	});
});
