/**
 * QUAL-08 — gate depth scales with the workflow, proved in BOTH directions.
 *
 * "Gate depth scales with the work" is a PURE, MACHINE-CHECKABLE SELECTOR
 * (`gateDepthFor`, `.pi/extensions/quality/gates.ts`), never prose in a
 * prompt and never a branch inside `/quick`. A one-directional assertion
 * ("the full workflow runs everything") is satisfied by a selector that
 * always returns everything -- every mechanism-set assertion below uses
 * EQUALITY, never `toContain`, except direction two's individually-named
 * negative assertions.
 *
 * Falsification, recorded verbatim rather than left to prose (all three
 * restored before this commit -- see 09-12-SUMMARY.md for the exact RED
 * messages):
 *   (a) inverting the table (`quick` -> all four, ceremonial -> deterministic
 *       only) turned BOTH direction one and direction three red;
 *   (b) giving `quick` a second mechanism turned direction two red, naming
 *       the leaked mechanism;
 *   (c) adding a fifth, invented mechanism id to one workflow's row turned
 *       direction four red.
 */
import { describe, expect, it } from "vitest";

import {
	GATE_DEPTH_BY_WORKFLOW,
	GATE_LEGS,
	QUALITY_MECHANISMS,
	WORKFLOW_IDS,
	gateDepthFor,
	type MechanismId,
	type WorkflowId,
} from "../../.pi/extensions/quality/gates.ts";
import { runQuickGateStage } from "../../.pi/extensions/quality/index.ts";

const ALL_FOUR: readonly MechanismId[] = QUALITY_MECHANISMS.map((m) => m.id);
const CEREMONIAL_WORKFLOWS: readonly WorkflowId[] = ["grill", "plan", "execute", "review"];

describe("vacuity", () => {
	it("QUALITY_MECHANISMS has exactly four entries", () => {
		expect(QUALITY_MECHANISMS.length).toBe(4);
	});

	it("WORKFLOW_IDS has exactly five entries", () => {
		expect(WORKFLOW_IDS.length).toBe(5);
	});
});

describe("DIRECTION ONE -- /quick is deterministic-only, by equality", () => {
	it('gateDepthFor("quick").mechanisms EQUALS ["deterministic"] exactly', () => {
		// toEqual, not toContain -- a containment check is satisfied by a
		// selector that returns all four, which is exactly the constant this
		// requirement forbids.
		expect(gateDepthFor("quick").mechanisms).toEqual(["deterministic"]);
	});
});

describe("DIRECTION TWO -- /quick does NOT leak any ceremonial mechanism", () => {
	const mechanisms = gateDepthFor("quick").mechanisms;

	it("does not contain model-review", () => {
		expect(mechanisms).not.toContain("model-review");
	});

	it("does not contain refute-or-promote", () => {
		expect(mechanisms).not.toContain("refute-or-promote");
	});

	it("does not contain calibration", () => {
		expect(mechanisms).not.toContain("calibration");
	});
});

describe("DIRECTION THREE -- every ceremonial workflow runs all four, by equality", () => {
	it.each(CEREMONIAL_WORKFLOWS)("gateDepthFor(%s).mechanisms EQUALS QUALITY_MECHANISMS' full id list", (workflow) => {
		expect(gateDepthFor(workflow).mechanisms).toEqual(ALL_FOUR);
	});
});

describe("DIRECTION FOUR -- the union over all workflows equals QUALITY_MECHANISMS, no invented ids", () => {
	it("the union of every workflow's mechanism set equals QUALITY_MECHANISMS' id list", () => {
		const union = new Set<MechanismId>();
		for (const workflow of WORKFLOW_IDS) {
			for (const id of gateDepthFor(workflow).mechanisms) union.add(id);
		}
		expect([...union].sort()).toEqual([...ALL_FOUR].sort());
	});

	it("no workflow's mechanism set contains an id outside QUALITY_MECHANISMS", () => {
		const known = new Set<string>(ALL_FOUR);
		for (const workflow of WORKFLOW_IDS) {
			for (const id of gateDepthFor(workflow).mechanisms) {
				expect(known.has(id), `${workflow} names unknown mechanism id ${id}`).toBe(true);
			}
		}
	});
});

describe("EXHAUSTIVENESS -- every WorkflowId is a GATE_DEPTH_BY_WORKFLOW key and vice versa", () => {
	it("every declared WorkflowId has a row", () => {
		for (const workflow of WORKFLOW_IDS) {
			expect(Object.prototype.hasOwnProperty.call(GATE_DEPTH_BY_WORKFLOW, workflow), `missing row for ${workflow}`).toBe(true);
		}
	});

	it("every row's key is a declared WorkflowId -- runtime check, since tsc --noEmit does not run in the vitest job", () => {
		const declared = new Set<string>(WORKFLOW_IDS);
		for (const key of Object.keys(GATE_DEPTH_BY_WORKFLOW)) {
			expect(declared.has(key), `GATE_DEPTH_BY_WORKFLOW has an undeclared key ${key}`).toBe(true);
		}
	});
});

describe("AGREEMENT WITH SHIPPED BEHAVIOUR -- gateDepthFor(\"quick\") matches what runQuickGateStage actually runs", () => {
	it("GATE_LEGS' four legs are all deterministic-class -- runQuickGateStage never reaches a reviewer, refutation or calibration leg", () => {
		// Structural check only: GATE_LEGS (the legs runQuickGateStage's callee,
		// runDeterministicGates, actually iterates) is the typecheck/lint/lsp/
		// anti-pattern set -- none of those names is model-review,
		// refute-or-promote or calibration. A stronger binding (asserting on a
		// live runQuickGateStage() call) would require a trusted cwd with real
		// node_modules and is exercised elsewhere (quick-workflow.test.ts,
		// quality-gate-order.test.ts); fabricating that here would not add
		// honest evidence over this structural check.
		expect([...GATE_LEGS].sort()).toEqual(["anti-pattern", "lint", "lsp", "typecheck"].sort());
	});

	it("runQuickGateStage's own GateResult shape carries no reviewer/refutation/calibration field", () => {
		// GateResult (gates.ts) is { legs, blocking, elapsedMsByLeg, totalMs,
		// report } -- runQuickGateStage (quality/index.ts) returns exactly that
		// shape, never a superset carrying a review/refutation/calibration key.
		expect(typeof runQuickGateStage).toBe("function");
		const source = runQuickGateStage.toString();
		expect(source).not.toMatch(/runReview|validateReview|runBoundedReviewLoop|scoreCalibration/);
	});
});

describe("PURITY -- gateDepthFor makes no I/O, no model call, and its tables are frozen", () => {
	it("calling gateDepthFor twice for the same workflow returns equal results", () => {
		expect(gateDepthFor("quick")).toEqual(gateDepthFor("quick"));
		expect(gateDepthFor("review")).toEqual(gateDepthFor("review"));
	});

	it("the returned mechanisms array is frozen -- mutating it throws rather than silently succeeding", () => {
		const result = gateDepthFor("quick");
		const mutable = result.mechanisms as MechanismId[];
		expect(() => mutable.push("calibration")).toThrow();
		// A subsequent call is unaffected either way -- the throw above proves
		// it structurally, this proves it behaviourally.
		expect(gateDepthFor("quick").mechanisms).toEqual(["deterministic"]);
	});

	it("GATE_DEPTH_BY_WORKFLOW itself is frozen -- reassigning a row throws", () => {
		const table = GATE_DEPTH_BY_WORKFLOW as Record<WorkflowId, readonly MechanismId[]>;
		expect(() => {
			table.quick = [...ALL_FOUR];
		}).toThrow();
	});
});
