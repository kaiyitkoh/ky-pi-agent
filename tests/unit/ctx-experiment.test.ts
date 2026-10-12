/**
 * The minimal-vs-full experiment core is pure; these tests pin the pre-registered constants and prove the
 * statistics against a published reference value before any live data can exist.
 */
import { describe, expect, it } from "vitest";

import {
	ARMS,
	DEGRADE_POINTS,
	FIRST_STAGE_REPEATS,
	LOW_CATCH_RATE,
	PROSE_RATE_THRESHOLD,
	SECOND_STAGE_REPEATS,
	Z_90,
	buildRunPlan,
	decide,
	diffInterval,
	discriminate,
	type ArmId,
	type ArmSummary,
	type ExperimentSummary,
} from "../../scripts/ctx-experiment-core.ts";

const ARM_IDS: readonly ArmId[] = ARMS.map((arm) => arm.id);
const DEFECTS = ["d1", "d2", "d3", "d4", "d5", "d6"];

describe("pre-registered constants", () => {
	it("are pinned", () => {
		expect(DEGRADE_POINTS).toBe(0.15);
		expect(Z_90).toBe(1.6449);
		expect(PROSE_RATE_THRESHOLD).toBe(0.1);
		expect(FIRST_STAGE_REPEATS).toBe(10);
		expect(SECOND_STAGE_REPEATS).toBe(20);
		expect(ARM_IDS).toEqual(["A", "B", "F", "C"]);
	});
});

describe("buildRunPlan", () => {
	const plan = buildRunPlan(42, DEFECTS, 10, ARM_IDS);

	it("is balanced: every arm x defect x repeat exactly once", () => {
		expect(plan).toHaveLength(ARM_IDS.length * DEFECTS.length * 10);
		const keys = new Set(plan.map((t) => `${t.arm}|${t.defect}|${t.repeat}`));
		expect(keys.size).toBe(plan.length);
		expect(new Set(plan.map((t) => t.id)).size).toBe(plan.length);
	});

	it("is deterministic per seed and differs across seeds", () => {
		expect(buildRunPlan(42, DEFECTS, 10, ARM_IDS).map((t) => t.id)).toEqual(plan.map((t) => t.id));
		expect(buildRunPlan(43, DEFECTS, 10, ARM_IDS).map((t) => t.id)).not.toEqual(plan.map((t) => t.id));
	});

	it("keeps all arms of one (defect, repeat) contiguous", () => {
		for (let start = 0; start < plan.length; start += ARM_IDS.length) {
			const block = plan.slice(start, start + ARM_IDS.length);
			expect(new Set(block.map((t) => `${t.defect}|${t.repeat}`)).size).toBe(1);
			expect(new Set(block.map((t) => t.arm)).size).toBe(ARM_IDS.length);
		}
	});

	it("does not put arms in a fixed order", () => {
		const orders = new Set<string>();
		for (let start = 0; start < plan.length; start += ARM_IDS.length) {
			orders.add(plan.slice(start, start + ARM_IDS.length).map((t) => t.arm).join(""));
		}
		expect(orders.size).toBeGreaterThan(1);
	});
});

describe("diffInterval", () => {
	it("reproduces Newcombe (1998) method 10: 56/70 vs 48/80 at 95%", () => {
		const [lower, upper] = diffInterval({ caught: 56, n: 70 }, { caught: 48, n: 80 }, 1.96);
		expect(lower).toBeCloseTo(0.0524, 4);
		expect(upper).toBeCloseTo(0.3339, 4);
	});

	it("handles the 0 and n boundaries without NaN", () => {
		for (const [a, b] of [
			[{ caught: 0, n: 60 }, { caught: 0, n: 60 }],
			[{ caught: 60, n: 60 }, { caught: 60, n: 60 }],
			[{ caught: 0, n: 60 }, { caught: 60, n: 60 }],
		] as const) {
			const [lower, upper] = diffInterval(a, b, Z_90);
			expect(Number.isFinite(lower)).toBe(true);
			expect(Number.isFinite(upper)).toBe(true);
			expect(lower).toBeLessThanOrEqual(upper);
		}
	});

	it("is oriented first minus second", () => {
		const [lower, upper] = diffInterval({ caught: 10, n: 60 }, { caught: 50, n: 60 }, Z_90);
		expect(upper).toBeLessThan(0);
		expect(lower).toBeLessThan(upper);
	});
});

describe("decide", () => {
	const cases: [string, { caught: number; n: number }, { caught: number; n: number }, string][] = [
		["clear degradation", { caught: 10, n: 60 }, { caught: 50, n: 60 }, "DEGRADES"],
		["clear degradation at small n", { caught: 0, n: 60 }, { caught: 60, n: 60 }, "DEGRADES"],
		// d = -0.15 exactly; the 90% interval still sits wholly below zero.
		["d exactly at the threshold", { caught: 6, n: 60 }, { caught: 15, n: 60 }, "DEGRADES"],
		["wide interval straddling", { caught: 25, n: 30 }, { caught: 27, n: 30 }, "INCONCLUSIVE"],
		// 30/60 vs 30/60: Wilson half-width 0.10386 each, lower = -sqrt(2) * 0.10386 = -0.1469 > -0.15.
		["equal rates at n=60", { caught: 30, n: 60 }, { caught: 30, n: 60 }, "NO_DETECTABLE_EFFECT"],
		["identical extremes", { caught: 60, n: 60 }, { caught: 60, n: 60 }, "NO_DETECTABLE_EFFECT"],
		["improvement", { caught: 55, n: 60 }, { caught: 20, n: 60 }, "NO_DETECTABLE_EFFECT"],
		["small effect, small n", { caught: 20, n: 30 }, { caught: 24, n: 30 }, "INCONCLUSIVE"],
		["n=0", { caught: 0, n: 0 }, { caught: 0, n: 0 }, "INCONCLUSIVE"],
		["one side empty", { caught: 0, n: 0 }, { caught: 30, n: 60 }, "INCONCLUSIVE"],
	];
	for (const [name, first, second, expected] of cases) {
		it(name, () => {
			expect(decide(first, second)).toBe(expected);
		});
	}
});

function arm(id: ArmId, caught: number, extra: Partial<ArmSummary> = {}): ArmSummary {
	return {
		arm: id,
		trials: 60,
		caught,
		malformed: 0,
		assistantMessages: 60,
		proseMessages: 0,
		proseTrials: 0,
		misses: 60 - caught,
		missesInProseTrials: 0,
		unmatchedFindings: 0,
		inputTokens: 0,
		cacheReadTokens: 0,
		...extra,
	};
}

function summary(a: number, b: number, f: number, c: number, extra: Partial<Record<ArmId, Partial<ArmSummary>>> = {}): ExperimentSummary {
	return {
		A: arm("A", a, extra.A),
		B: arm("B", b, extra.B),
		F: arm("F", f, extra.F),
		C: arm("C", c, extra.C),
	};
}

describe("discriminate", () => {
	it("harness-behaviour: F below A, padded-minimal equal to A", () => {
		expect(discriminate(summary(50, 48, 20, 50))).toBe("harness-behaviour");
	});

	it("context-pollution: F and C both below A", () => {
		expect(discriminate(summary(50, 30, 20, 22))).toBe("context-pollution");
	});

	it("neither: no arm differs and the catch rate is low", () => {
		expect(LOW_CATCH_RATE).toBeGreaterThan(0);
		expect(discriminate(summary(6, 6, 6, 6))).toBe("neither");
	});

	it("prose-tool-calls: prose rate over threshold and misses concentrated in prose trials", () => {
		const prose = { proseMessages: 20, proseTrials: 20, missesInProseTrials: 20 };
		expect(discriminate(summary(40, 40, 40, 40, { F: { ...prose, misses: 20, caught: 40 } }))).toBe("prose-tool-calls");
	});

	it("inconclusive: no clear difference and a healthy catch rate", () => {
		expect(discriminate(summary(50, 50, 50, 50))).toBe("inconclusive");
	});

	it("inconclusive when the arms needed are missing", () => {
		expect(discriminate({ A: arm("A", 30) })).toBe("inconclusive");
	});

	it("provider-misconfiguration: low catch on the primary route, healthy on a second route", () => {
		const second = arm("A", 54);
		expect(discriminate(summary(6, 6, 6, 6), second)).toBe("provider-misconfiguration");
	});
});
