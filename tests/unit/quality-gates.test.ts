/**
 * The deterministic gate legs: the three-state table (a missing check is UNAVAILABLE, never PASS), the
 * structural claim that gates.ts never reaches the model tier, the measured anti-pattern budget, and the
 * design-review predicate. The change gate itself is exercised in quality-production-exec.test.ts.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";
import {
	DESIGN_REVIEW_FILE_SPAN,
	GATE_LEGS,
	type ExecRunner,
	probeLspAvailability,
	runAntiPatternLeg,
	runTypecheckLeg,
	shouldRunDesignReview,
} from "../../.pi/extensions/quality/gates.ts";
import type { QualitySource } from "../../.pi/extensions/quality/rules.ts";

const GATES_FILE = ".pi/extensions/quality/gates.ts";

// ---------------------------------------------------------------------------
// GATE-01 — the three-state table
// ---------------------------------------------------------------------------

describe("GATE-01 — per-leg three-state table", () => {
	it("probeLspAvailability([]) is unavailable, naming both missing tool names", () => {
		const result = probeLspAvailability([]);
		expect(result.status).toBe("unavailable");
		expect(result.status === "unavailable" && result.reason).toContain("lsp_diagnostics");
		expect(result.status === "unavailable" && result.reason).toContain("lsp_fix");
	});

	it("probeLspAvailability with only lsp_diagnostics present is unavailable, naming lsp_fix specifically", () => {
		const result = probeLspAvailability(["lsp_diagnostics"]);
		expect(result.status).toBe("unavailable");
		expect(result.status === "unavailable" && result.reason).toContain("lsp_fix");
		expect(result.status === "unavailable" && result.reason).not.toContain("lsp_diagnostics,");
	});

	it("probeLspAvailability with both tools present is still unavailable: registered is not run", () => {
		const result = probeLspAvailability(["lsp_diagnostics", "lsp_fix"]);
		expect(result.status).toBe("unavailable");
		expect(result.reason).toContain("registered but not run");
	});

	it("an ERROR-tier anti-pattern finding fails the anti-pattern leg; warnings alone do not", () => {
		const offending: QualitySource = {
			path: "src/dup.ts",
			text: ["function catcher(): void {", "\ttry {", "\t\tdoWork();", "\t} catch (err) {", "\t}", "}", ""].join("\n"),
		};
		expect(runAntiPatternLeg([offending]).status).toBe("fail");
		expect(runAntiPatternLeg([{ path: "src/ok.ts", text: "export const ok = 1;\n" }]).status).toBe("pass");
	});

	it("typecheck leg: exit 2 with compiler text -> fail carrying the text", () => {
		const exec: ExecRunner = () => ({ code: 2, stdout: "src/x.ts(3,5): error TS2322: bad type", stderr: "" });
		const result = runTypecheckLeg(repoRoot(), exec);
		expect(result.status).toBe("fail");
		expect(result.status === "fail" && result.findings.join("\n")).toContain("TS2322");
	});

	it("typecheck leg: exit 0 -> pass", () => {
		const exec: ExecRunner = () => ({ code: 0, stdout: "", stderr: "" });
		expect(runTypecheckLeg(repoRoot(), exec)).toEqual({ status: "pass" });
	});

	it("typecheck leg: a throwing runner -> unavailable, explicitly NOT pass", () => {
		const exec: ExecRunner = () => {
			throw new Error("ENOENT: npx not found");
		};
		const result = runTypecheckLeg(repoRoot(), exec);
		expect(result.status).toBe("unavailable");
		expect(result.status).not.toBe("pass");
	});

});

// ---------------------------------------------------------------------------
// QUAL-02 — structural (no model round trip) + measured (wall clock)
// ---------------------------------------------------------------------------

/** `from "..."` / `from '...'` specifiers, matched against raw source. */
function importSpecifiers(text: string): string[] {
	const specifiers: string[] = [];
	const re = /from\s+["']([^"']+)["']/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		specifiers.push(match[1]);
	}
	return specifiers;
}

/**
 * Resolve `entryAbsPath`'s import graph transitively, following only
 * relative (`./`/`../`) specifiers — a package import like
 * `@earendil-works/pi-ai` or `typescript` is not a local module this repo
 * controls and cannot be walked further. Returns the absolute paths of every
 * local module reached, INCLUDING the entry point itself.
 */
function resolveImportGraph(entryAbsPath: string): string[] {
	const visited = new Set<string>();
	const stack = [entryAbsPath];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined || visited.has(current)) {
			continue;
		}
		visited.add(current);
		const text = readFileSync(current, "utf-8");
		for (const spec of importSpecifiers(text)) {
			if (!spec.startsWith(".")) {
				continue;
			}
			const resolved = resolve(dirname(current), spec);
			if (!visited.has(resolved)) {
				stack.push(resolved);
			}
		}
	}
	return Array.from(visited);
}

/**
 * The three forbidden modules — the ONLY routes out of `quality/` that reach
 * the model tier, per `08-06-PLAN.md`'s interfaces section. Named as
 * repo-relative path SUFFIXES so the check is independent of where in the
 * tree the walk started.
 */
const FORBIDDEN_MODULE_SUFFIXES = [
	".pi/extensions/diagnostics/call-model.ts",
	".pi/extensions/routing/modes.ts",
	".pi/extensions/providers/fallback.ts",
] as const;

describe("QUAL-02 — no model round trip and a measured wall-clock budget", () => {
	it("STRUCTURAL: gates.ts's transitive import graph is non-empty (guards against a vacuous pass)", () => {
		const entry = join(repoRoot(), GATES_FILE);
		const graph = resolveImportGraph(entry);
		expect(graph.length).toBeGreaterThanOrEqual(1);
	});

	it("STRUCTURAL: gates.ts's transitive import graph never reaches call-model.ts, routing/modes.ts or providers/fallback.ts", () => {
		const entry = join(repoRoot(), GATES_FILE);
		const graph = resolveImportGraph(entry).map((p) => p.split("\\").join("/"));
		const offenders = graph.filter((p) => FORBIDDEN_MODULE_SUFFIXES.some((suffix) => p.endsWith(suffix)));
		expect(
			offenders,
			"gates.ts (directly or transitively) imports a module that reaches the model tier, which the deterministic stage must not do",
		).toEqual([]);
	});

	/**
	 * MEASURED, per QUAL-02's second claim. Measured 2026-08-15 on this
	 * machine: running `runAntiPatternLeg` over every tracked `.ts` under
	 * `.pi/extensions/` (46 files at measurement time) five times in a row
	 * inside one vitest process gave 383.54, 308.61, 302.13, 299.02,
	 * 303.98ms — cold-start (first `ts.createSourceFile` call, jiti/vitest
	 * transform warm-up) accounts for the first figure being highest; the
	 * steady state is ~300ms. The budget below is set at roughly 4x the
	 * worst measured figure (390ms) — generous enough not to flake on a
	 * loaded CI runner, tight enough that an order-of-magnitude regression
	 * (a rule that stops being syntax-only, an accidental O(n^2) walk)
	 * still trips it. A budget with no recorded measurement behind it is a
	 * guess; this one is not.
	 */
	const ANTI_PATTERN_BUDGET_MS = 1600;

	it(`MEASURED: runAntiPatternLeg over every tracked .pi/extensions/*.ts file stays under ${ANTI_PATTERN_BUDGET_MS}ms`, () => {
		const paths = trackedFiles(".pi/extensions").filter((p) => p.endsWith(".ts"));
		expect(paths.length, "no tracked .ts under .pi/extensions/ — the measurement below would be over an empty set").toBeGreaterThanOrEqual(1);
		const sources: QualitySource[] = paths.map((path) => ({ path, text: readFileSync(join(repoRoot(), path), "utf-8") }));

		const start = process.hrtime.bigint();
		runAntiPatternLeg(sources);
		const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;

		expect(
			elapsedMs,
			`runAntiPatternLeg took ${elapsedMs.toFixed(2)}ms over ${sources.length} files, over the ` +
				`${ANTI_PATTERN_BUDGET_MS}ms budget — QUAL-02's "no measurable wall-clock" claim is now false`,
		).toBeLessThan(ANTI_PATTERN_BUDGET_MS);
	});
});

// ---------------------------------------------------------------------------
// QUAL-07 — the design-review predicate
// ---------------------------------------------------------------------------

describe("QUAL-07 — shouldRunDesignReview fires on signals or escalation, never by default", () => {
	const allFalse = {
		filesTouched: 0,
		loopWrapsQuery: false,
		dataModelChanged: false,
		publicInterfaceChanged: false,
		escalateRequested: false,
	};

	it("all-false signals -> false (QUAL-07's own negative half: never on every task)", () => {
		expect(shouldRunDesignReview(allFalse)).toBe(false);
	});

	it("escalateRequested alone -> true", () => {
		expect(shouldRunDesignReview({ ...allFalse, escalateRequested: true })).toBe(true);
	});

	it("loopWrapsQuery alone -> true", () => {
		expect(shouldRunDesignReview({ ...allFalse, loopWrapsQuery: true })).toBe(true);
	});

	it("dataModelChanged alone -> true", () => {
		expect(shouldRunDesignReview({ ...allFalse, dataModelChanged: true })).toBe(true);
	});

	it("publicInterfaceChanged alone -> true", () => {
		expect(shouldRunDesignReview({ ...allFalse, publicInterfaceChanged: true })).toBe(true);
	});

	it("filesTouched one below DESIGN_REVIEW_FILE_SPAN -> false", () => {
		expect(shouldRunDesignReview({ ...allFalse, filesTouched: DESIGN_REVIEW_FILE_SPAN - 1 })).toBe(false);
	});

	it("filesTouched exactly DESIGN_REVIEW_FILE_SPAN -> true (the boundary itself is inclusive)", () => {
		expect(shouldRunDesignReview({ ...allFalse, filesTouched: DESIGN_REVIEW_FILE_SPAN })).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// vacuity
// ---------------------------------------------------------------------------

describe("vacuity", () => {
	it("GATE_LEGS still has all four legs", () => {
		expect(GATE_LEGS).toEqual(["typecheck", "lint", "lsp", "anti-pattern"]);
	});

	it("the tracked .pi/extensions/ source set used by the measured sweep is non-empty", () => {
		expect(trackedFiles(".pi/extensions").filter((p) => p.endsWith(".ts")).length).toBeGreaterThanOrEqual(1);
	});
});
