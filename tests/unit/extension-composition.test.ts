/**
 * EXT-05/EXT-06 -- the capability-to-evidence registry, both directions.
 *
 * WHY THIS FILE EXISTS. EXT-05 names eight capabilities (plan mode, todo
 * tracking, structured user questions, loop detection, background bash, LSP
 * diagnostics, web lookup, session search). EXT-06 adds that Pi's own bundled
 * examples are preferred wherever they cover the need. Both are claims about
 * COMPOSITION -- which of two mutually exclusive sources (a vendored file in
 * this repo, or a pinned `packages[]` entry) each capability resolves to --
 * and both are checkable offline, today, with no install and no credentials.
 * A row whose evidence checks `packages[]` for a capability that should have
 * been vendored (EXT-10's license gap, or EXT-06's caret-range gap) is the
 * exact regression this phase is named after ("composed extensions, pinned,
 * reviewed"), caught mechanically here rather than discovered by a user
 * hitting a duplicate command or an unreviewed second copy of the same code.
 *
 * THE ANALOG. `tests/unit/workflow-budgets.test.ts`'s `{ subject, value, why }`
 * row shape, its vacuity guards, and its two-direction completeness block are
 * the template for `CAPABILITY_SOURCES` below. `tests/unit/extension-pins.test.ts`
 * and `tests/unit/vendor-license-audit.test.ts` are the template for the
 * pin-vs-vendor mutual-exclusion checks (Direction 2/3) -- this file composes
 * both disciplines over the specific eight-capability registry EXT-05 names,
 * rather than re-deriving either from scratch.
 *
 * SCOPE. `pi-subagents` is not one of the eight capabilities -- it serves
 * EXT-01..EXT-04 (subagent isolation/background execution/steering), not one
 * of EXT-05's Claude Code-parity items. It is still the sixth entry in
 * `.pi/settings.json`'s... no, the FIFTH entry in `packages[]`, and Direction
 * 3 below names it as an explicit, commented exception rather than silently
 * filtering it out (`PI_SUBAGENTS_EXCEPTION` below).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";
import { isEntryPoint } from "./extension-layout.test.ts";

const SETTINGS_PATH = join(".pi", "settings.json");

/**
 * Mirrors `tests/unit/extension-layout.test.ts`'s own `FLAT`/`NESTED_INDEX`
 * shapes (not exported there -- that file's only exported symbol is the
 * discriminator `isEntryPoint`). Duplicated deliberately: this file needs the
 * SHAPE check, not the enumeration `extension-layout.test.ts` performs, and a
 * regex this small (two lines, unchanged since Phase 2) is cheaper to keep in
 * sync by inspection than to thread through a second export.
 */
const FLAT = /^\.pi\/extensions\/[^/]+\.ts$/;
const NESTED_INDEX = /^\.pi\/extensions\/[^/]+\/index\.ts$/;

/** A semver-shaped substring, e.g. "0.84.1" -- the Pi version marker in a vendoring header. */
const VERSION_PATTERN = /\b\d+\.\d+\.\d+\b/;

/** The literal upstream-path marker every Pi-bundled-example vendoring header carries. */
const UPSTREAM_PATH_MARKER = "examples/extensions/";

interface CapabilitySource {
	/** One of EXT-05's eight named capabilities, verbatim from the plan's `<capability_map>`. */
	capability: string;
	kind: "vendored" | "npm";
	/** Repo-relative path (vendored) or bare npm package name (npm). */
	evidence: string;
	/** For `"vendored"` rows only: the npm package that must NOT appear in packages[] instead. */
	npmAlternative?: string;
	/** The EXT-05/EXT-06 reason, one line. */
	why: string;
}

/**
 * THE REGISTRY. One row per EXT-05 capability, re-verified against this
 * phase's own waves 1-3 (07-06 loop-police, 07-07 plan-mode, 07-08
 * todo/questionnaire, 07-09 packages[]), never copied from a research
 * document without re-checking `.pi/settings.json` and the tracked
 * `.pi/extensions/` tree directly (both read live by the assertions below).
 */
const CAPABILITY_SOURCES: readonly CapabilitySource[] = [
	{
		capability: "plan mode",
		kind: "vendored",
		evidence: ".pi/extensions/plan-mode/index.ts",
		npmAlternative: "@narumitw/pi-plan-mode",
		why: "EXT-06 -- @narumitw/pi-plan-mode depends on @narumitw/pi-tui-kit@^0.49.1, a caret range isPinnedPackageSpec cannot see; Pi's own bundled examples/extensions/plan-mode/ has no such dependency",
	},
	{
		capability: "todo tracking",
		kind: "vendored",
		evidence: ".pi/extensions/todo.ts",
		npmAlternative: "@juicesharp/rpiv-todo",
		why: "EXT-06 -- @juicesharp/rpiv-todo depends on @juicesharp/rpiv-config@^2.5.2 and a second, uncontrolled typebox@^1.1.24; Pi's own bundled examples/extensions/todo.ts has no such dependency",
	},
	{
		capability: "structured user questions",
		kind: "vendored",
		evidence: ".pi/extensions/questionnaire.ts",
		npmAlternative: "@juicesharp/rpiv-ask-user-question",
		why: "EXT-06 -- @juicesharp/rpiv-ask-user-question carries the identical rpiv-config/typebox caret defect as rpiv-todo; Pi's own bundled examples/extensions/questionnaire.ts covers both single- and multi-question shapes",
	},
	{
		capability: "loop detection",
		kind: "vendored",
		evidence: ".pi/extensions/loop-police/index.ts",
		npmAlternative: "pi-loop-police",
		why: "EXT-10 -- pi-loop-police@1.14.1's package.json claims license:MIT but ships no LICENSE file in its tarball and GitHub reports license:null; vendored in source form, reviewed, never installed",
	},
	{
		capability: "background bash",
		kind: "npm",
		evidence: "pi-background-tasks",
		why: "EXT-05 -- no bundled Pi example covers background bash; packages[] pins pi-background-tasks@2.4.2 (bg_run/bg_status/bg_logs/bg_kill plus 7 unavoidable delegate/fusion tools, decision D-07-B)",
	},
	{
		capability: "LSP diagnostics",
		kind: "npm",
		evidence: "@narumitw/pi-lsp",
		why: "EXT-05 -- no bundled Pi example covers LSP diagnostics; packages[] pins @narumitw/pi-lsp@0.49.4 (lsp_diagnostics, lsp_fix)",
	},
	{
		capability: "web lookup",
		kind: "npm",
		evidence: "pi-web-access",
		why: "EXT-05 -- Pi's own docs state it intentionally ships no web tool at all; packages[] pins pi-web-access@0.22.0 (genuinely keyless: Exa, DuckDuckGo, Jina Reader, local unpdf)",
	},
	{
		capability: "session search",
		kind: "npm",
		evidence: "pi-session-finder",
		why: "EXT-05 -- no bundled Pi example covers cross-project session search; packages[] pins pi-session-finder@0.5.6 (/find, /find-back commands, zero model-facing tools)",
	},
];

/**
 * `pi-subagents` is the ONE `packages[]` entry that is not one of the eight
 * EXT-05 capabilities -- it serves EXT-01..EXT-04 (subagent isolation,
 * background execution, mid-run steering). Named here as a constant with a
 * comment, per Direction 3's own requirement, rather than filtered out
 * inline where a reader could mistake the filter for an oversight.
 */
const PI_SUBAGENTS_EXCEPTION = "pi-subagents";

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

/**
 * True when `spec` (a `packages[]` entry) names `packageName` -- as
 * `npm:<name>@<ref>` or `npm:<name>`. Boundary-matched so
 * `pi-loop-police-fork` cannot be mistaken for `pi-loop-police`, mirroring
 * `tests/unit/vendor-license-audit.test.ts`'s own `specNamesPackage`.
 */
function specNamesPackage(spec: string, packageName: string): boolean {
	const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^npm:${escaped}(@|$)`).test(spec);
}

/** Bare package name from an `npm:<name>@<version>` spec, scope-aware. */
function packageNameFromNpmSpec(spec: string): string | undefined {
	if (!spec.startsWith("npm:")) {
		return undefined;
	}
	const withoutPrefix = spec.slice("npm:".length);
	const atIndex = withoutPrefix.indexOf("@", withoutPrefix.startsWith("@") ? 1 : 0);
	return atIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, atIndex);
}

describe("EXT-05/EXT-06 -- vacuity guards", () => {
	it("CAPABILITY_SOURCES names at least eight capabilities", () => {
		expect(
			CAPABILITY_SOURCES.length,
			"fewer than eight rows -- without this guard every direction below would iterate almost " +
				"nothing and pass having checked almost nothing; EXT-05 names exactly eight",
		).toBeGreaterThanOrEqual(8);
	});

	it(".pi/settings.json packages[] is non-empty", () => {
		expect(
			readSettingsPackages().length,
			"an empty packages[] would make every npm-kind assertion below pass vacuously",
		).toBeGreaterThanOrEqual(1);
	});
});

describe("EXT-05 Direction 1 -- every capability resolves to a real, tracked source", () => {
	const vendoredRows = CAPABILITY_SOURCES.filter((row) => row.kind === "vendored");
	const npmRows = CAPABILITY_SOURCES.filter((row) => row.kind === "npm");

	it("collected at least one vendored and one npm row (non-vacuity)", () => {
		expect(vendoredRows.length, "no vendored rows -- Direction 1's vendored half would check nothing").toBeGreaterThanOrEqual(1);
		expect(npmRows.length, "no npm rows -- Direction 1's npm half would check nothing").toBeGreaterThanOrEqual(1);
	});

	it.each(vendoredRows)("vendored: $capability's evidence ($evidence) is TRACKED, not merely on disk", (row) => {
		expect(
			trackedFiles(row.evidence),
			`${row.evidence} is not in git's index -- an untracked scratch file must not satisfy this audit ` +
				"(trackedFiles, never existsSync alone)",
		).toEqual([row.evidence]);
	});

	it.each(vendoredRows)("vendored: $capability's evidence ($evidence), when an entry point, sits at an auto-discovered shape", (row) => {
		const text = readFileSync(join(repoRoot(), row.evidence), "utf-8");
		if (!isEntryPoint(text)) {
			// Not an entry point (e.g. a helper module) -- this row's shape
			// requirement does not apply; extension-layout.test.ts governs
			// non-entry-point placement separately.
			return;
		}
		expect(
			FLAT.test(row.evidence) || NESTED_INDEX.test(row.evidence),
			`${row.evidence} carries a default export (an entry point) but sits at neither the FLAT ` +
				"(.pi/extensions/<name>.ts) nor NESTED_INDEX (.pi/extensions/<dir>/index.ts) shape -- " +
				"/reload cannot hot-reload it",
		).toBe(true);
	});

	it.each(npmRows)("npm: $capability's evidence ($evidence) is pinned in packages[]", (row) => {
		const packages = readSettingsPackages();
		const offenders = packages.filter((spec) => spec.startsWith(`npm:${row.evidence}@`));
		expect(
			offenders.length,
			`no packages[] entry starts with "npm:${row.evidence}@" -- ${row.capability}'s npm evidence ` +
				"does not resolve to a real pinned entry",
		).toBeGreaterThanOrEqual(1);
	});
});

describe("EXT-06 Direction 2 -- the regression guard: a vendored capability's npm alternative is absent from packages[]", () => {
	const vendoredRows = CAPABILITY_SOURCES.filter((row) => row.kind === "vendored");

	it("every vendored row carries an npmAlternative (non-vacuity)", () => {
		const missing = vendoredRows.filter((row) => row.npmAlternative === undefined).map((row) => row.capability);
		expect(missing, "these vendored rows carry no npmAlternative -- Direction 2 cannot check them").toEqual([]);
	});

	it.each(vendoredRows)("packages[] names no entry for $capability's npmAlternative ($npmAlternative)", (row) => {
		const packages = readSettingsPackages();
		const offenders = packages.filter((spec) => specNamesPackage(spec, row.npmAlternative as string));
		expect(
			offenders,
			`packages[] names ${row.npmAlternative} (${offenders.join(", ")}), which duplicates ${row.evidence} -- ` +
				"a future contributor 'simplifying' by installing the package instead of keeping the vendored " +
				"copy must turn this red",
		).toEqual([]);
	});
});

describe("EXT-05/EXT-06 Direction 3 -- the converse: no npm packages[] entry is uncovered by the registry", () => {
	it("every npm: entry in packages[] is either a CAPABILITY_SOURCES npm row or the named pi-subagents exception", () => {
		const npmRowNames = new Set(CAPABILITY_SOURCES.filter((row) => row.kind === "npm").map((row) => row.evidence));
		const packages = readSettingsPackages();
		const offenders = packages
			.map((spec) => packageNameFromNpmSpec(spec))
			.filter((name): name is string => name !== undefined)
			.filter((name) => name !== PI_SUBAGENTS_EXCEPTION && !npmRowNames.has(name));
		expect(
			offenders,
			`packages[] names a package with no CAPABILITY_SOURCES row and no named exception (${offenders.join(", ")}) -- ` +
				"either add a row or extend the named exception with a comment; the registry must not silently shrink",
		).toEqual([]);
	});
});

describe("EXT-06 Direction 4 -- vendored provenance is recoverable", () => {
	const vendoredRows = CAPABILITY_SOURCES.filter((row) => row.kind === "vendored");

	function hasDirectoryProvenance(evidencePath: string): boolean {
		if (!NESTED_INDEX.test(evidencePath)) {
			return false;
		}
		const dir = evidencePath.slice(0, evidencePath.lastIndexOf("/"));
		return trackedFiles(dir).includes(`${dir}/PROVENANCE.md`);
	}

	function hasVendoringHeader(evidencePath: string): boolean {
		const text = readFileSync(join(repoRoot(), evidencePath), "utf-8");
		const header = text.split("\n").slice(0, 40).join("\n");
		return header.includes(UPSTREAM_PATH_MARKER) && VERSION_PATTERN.test(header);
	}

	it.each(vendoredRows)("$evidence carries a tracked PROVENANCE.md (npm-package case) or a vendoring header naming the upstream path and Pi version (bundled-example case)", (row) => {
		const viaProvenance = hasDirectoryProvenance(row.evidence);
		const viaHeader = hasVendoringHeader(row.evidence);
		expect(
			viaProvenance || viaHeader,
			`${row.evidence} has neither a tracked PROVENANCE.md in its directory nor a vendoring header ` +
				`naming "${UPSTREAM_PATH_MARKER}" and a version -- vendored code with no recorded upstream ` +
				"has no update path",
		).toBe(true);
	});
});
