/**
 * The capability-to-evidence registry, both directions: each of the eight Claude-Code-parity capabilities resolves to
 * exactly one source, a vendored file or a pinned packages[] entry, never both, and Pi's own bundled examples win where
 * they cover the need. pi-subagents is the one packages[] entry outside the eight, named as an explicit exception.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";
import { packageNameFromNpmSpec, readSettingsPackages } from "../helpers/settings.ts";
import { isEntryPoint } from "./extension-layout.test.ts";

/** The auto-discovered entry-point shapes, kept in sync with extension-layout.test.ts by inspection (too small to export). */
const FLAT = /^\.pi\/extensions\/[^/]+\.ts$/;
const NESTED_INDEX = /^\.pi\/extensions\/[^/]+\/index\.ts$/;

/** A semver-shaped substring: the Pi version marker in a vendoring header. */
const VERSION_PATTERN = /\b\d+\.\d+\.\d+\b/;

/** The literal upstream-path marker every Pi-bundled-example vendoring header carries. */
const UPSTREAM_PATH_MARKER = "examples/extensions/";

interface CapabilitySource {
	/** One of the eight named capabilities. */
	capability: string;
	kind: "vendored" | "npm";
	/** Repo-relative path (vendored) or bare npm package name (npm). */
	evidence: string;
	/** For `"vendored"` rows only: the npm package that must NOT appear in packages[] instead. */
	npmAlternative?: string;
	/** The reason, one line. */
	why: string;
}

/** One row per capability, checked live against `.pi/settings.json` and the tracked `.pi/extensions/` tree. */
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
		kind: "vendored",
		evidence: ".pi/extensions/background-tasks/index.ts",
		npmAlternative: "pi-background-tasks",
		why: "EXT-05 -- no bundled Pi example covers background bash; pi-background-tasks@2.6.9 is vendored process-only (D-02, 08.1-05): bg_run/bg_status/bg_logs/bg_kill, no delegate/fusion/attested tools",
	},
	{
		capability: "LSP diagnostics",
		kind: "npm",
		evidence: "@narumitw/pi-lsp",
		why: "EXT-05 -- no bundled Pi example covers LSP diagnostics; packages[] pins @narumitw/pi-lsp@0.49.9 (lsp_diagnostics, lsp_fix)",
	},
	{
		capability: "web lookup",
		kind: "npm",
		evidence: "pi-web-access",
		why: "EXT-05 -- Pi's own docs state it intentionally ships no web tool at all; packages[] pins pi-web-access@0.38.0 (genuinely keyless: Exa, DuckDuckGo, Jina Reader, local unpdf)",
	},
	{
		capability: "session search",
		kind: "npm",
		evidence: "pi-session-finder",
		why: "EXT-05 -- no bundled Pi example covers cross-project session search; packages[] pins pi-session-finder@0.5.6 (/find, /find-back commands, zero model-facing tools)",
	},
];

/** The one packages[] entry outside the eight (it serves subagents), named so the exclusion is not mistaken for an oversight. */
const PI_SUBAGENTS_EXCEPTION = "pi-subagents";

/** True when a packages[] spec names `packageName`, boundary-matched so `pi-loop-police-fork` is not `pi-loop-police`. */
function specNamesPackage(spec: string, packageName: string): boolean {
	const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^npm:${escaped}(@|$)`).test(spec);
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
			// Not an entry point (a helper module): extension-layout.test.ts governs its placement.
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
