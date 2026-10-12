/**
 * The minimal-vs-full experiment core is pure; these tests pin the pre-registered constants and prove the
 * statistics against a published reference value before any live data can exist.
 */
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import type { SeededDefectExpectation } from "../../.pi/extensions/quality/calibration.ts";
import { REVIEWER_SYSTEM_PROMPT } from "../../.pi/extensions/quality/reviewer.ts";
import { SEEDED_DEFECTS } from "../fixtures/seeded-defects/index.ts";
import { measureFloor } from "../helpers/harness-session.ts";
import {
	ARMS,
	FULL_ARM_TOOLS,
	PAD_TOKENS,
	TRIAL_REQUIREMENT_IDS,
	armActiveTools,
	armArgs,
	buildTrialPrompt,
	padFileText,
	parseJsonModeOutput,
	scoreTrial,
	summarise,
	DEGRADE_POINTS,
	LOW_CATCH_RATE,
	MAX_EXCLUDED_SHARE,
	PROSE_RATE_THRESHOLD,
	REPEATS,
	Z_90,
	buildRunPlan,
	decide,
	decideArms,
	diffInterval,
	discriminate,
	isInfrastructureFailure,
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
		expect(REPEATS).toBe(10);
		expect(MAX_EXCLUDED_SHARE).toBe(0.05);
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
		excluded: 0,
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

	it("inconclusive when an arm's exclusions exceed the ceiling; at the ceiling the reading stands", () => {
		expect(discriminate(summary(50, 48, 20, 50, { F: { excluded: 3 } }))).toBe("harness-behaviour");
		expect(discriminate(summary(50, 48, 20, 50, { F: { excluded: 4 } }))).toBe("inconclusive");
		expect(discriminate(summary(50, 48, 20, 50, { C: { excluded: 10 } }))).toBe("inconclusive");
	});
});

describe("exclusions", () => {
	const done = parseJsonModeOutput(
		`${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "x" }], stopReason: "stop" } })}\n`,
	);
	const failed = (stopReason: string) =>
		parseJsonModeOutput(
			`${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason } })}\n`,
		);

	it("a non-zero exit, no assistant message, or an error/aborted stop is an infrastructure failure", () => {
		expect(isInfrastructureFailure(done, undefined)).toBe(false);
		expect(isInfrastructureFailure(done, 0)).toBe(false);
		expect(isInfrastructureFailure(done, 1)).toBe(true);
		expect(isInfrastructureFailure(parseJsonModeOutput(""), undefined)).toBe(true);
		expect(isInfrastructureFailure(failed("error"), undefined)).toBe(true);
		expect(isInfrastructureFailure(failed("aborted"), undefined)).toBe(true);
		expect(isInfrastructureFailure(failed("length"), undefined)).toBe(false);
	});

	it("an excluded trial is neither a catch nor a miss", () => {
		const result = summarise(
			[
				{ arm: "F", defect: "d1", repeat: 0, score: { caught: true, malformed: false, unmatchedFindings: 0 }, output: done },
				{ arm: "F", defect: "d2", repeat: 0, score: { caught: false, malformed: true, unmatchedFindings: 0 }, output: parseJsonModeOutput(""), excluded: true },
			],
			{ A: [], B: [], F: [], C: [] },
		);
		expect(result.F).toMatchObject({ trials: 1, excluded: 1, caught: 1, misses: 0, malformed: 0 });
	});

	it("decideArms refuses over the ceiling", () => {
		expect(decideArms(arm("F", 20), arm("A", 50))).toBe("DEGRADES");
		expect(decideArms(arm("F", 20, { excluded: 4 }), arm("A", 50))).toBe("INCONCLUSIVE");
		expect(decideArms(arm("F", 20), arm("A", 50, { excluded: 4 }))).toBe("INCONCLUSIVE");
	});
});

const EXPECTED: SeededDefectExpectation[] = SEEDED_DEFECTS.map((d) => ({ id: d.id, ...d.expected }));

function reviewBlock(findings: unknown[]): string {
	const review = {
		verdicts: [{ requirementId: TRIAL_REQUIREMENT_IDS[0], status: "Partial", evidence: "src/x.ts:1" }],
		findings,
		checkedAndCleared: "Read every touched file in full.",
		classification: "root-cause",
		classificationJustification: "Addresses the stated purpose.",
	};
	return `Here is my review.\n\n\`\`\`json\n${JSON.stringify(review)}\n\`\`\`\n`;
}

function catchingFinding(e: SeededDefectExpectation): unknown {
	return {
		severity: e.minimumSeverity,
		location: `${e.locationFile}:1`,
		concreteFailure: `This change ${e.mustMentionAny.slice(0, 2).join(" and ")}.`,
		suggestedFix: "Fix it.",
	};
}

describe("buildTrialPrompt", () => {
	const built = { diff: "+export const a = 1;", touchedFiles: [{ path: "src/a.ts", contents: "export const a = 1;" }] };

	it("carries the reviewer prompt, the contract context and the output instruction", () => {
		const prompt = buildTrialPrompt(built);
		expect(prompt).toContain(REVIEWER_SYSTEM_PROMPT);
		expect(prompt).toContain("export const a = 1;");
		expect(prompt).toContain("src/a.ts");
		expect(prompt).toContain("```json");
		expect(prompt).toContain("do not call a tool");
	});

	it("has no arm parameter, so every arm receives identical text", () => {
		expect(buildTrialPrompt.length).toBe(1);
		expect(buildTrialPrompt(built)).toBe(buildTrialPrompt(built));
	});
});

describe("parseJsonModeOutput", () => {
	const assistant = (text: string) => fauxAssistantMessage([fauxText(text)], { stopReason: "stop" });
	const line = (event: unknown) => JSON.stringify(event);

	it("assembles the final assistant message from a stream with noise", () => {
		const first = assistant("thinking aloud");
		const last = { ...assistant("final answer"), usage: { ...assistant("x").usage, input: 321, cacheRead: 100 } };
		const text = [
			line({ type: "session", version: 3 }),
			"",
			"not json at all",
			line({ type: "message_start", message: { role: "user", content: "hi" } }),
			line({ type: "message_end", message: first }),
			line({ type: "message_end", message: last }),
			line({ type: "agent_settled", aborted: false }),
			'{"type":"message_end","mess',
		].join("\n");
		const parsed = parseJsonModeOutput(text);
		expect(parsed.assistantMessages).toHaveLength(2);
		expect(parsed.finalText).toBe("final answer");
		expect(parsed.usage).toEqual({ input: 321, cacheRead: 100 });
		expect(parsed.stopReason).toBe("stop");
	});

	it("never throws on garbage, empty or oversized input", () => {
		for (const text of ["", "\n\n", "{", "[]", "null", "\u0000\u0001", "x".repeat(50_000_000)]) {
			const parsed = parseJsonModeOutput(text);
			expect(parsed.finalText).toBe("");
			expect(parsed.usage).toBeUndefined();
		}
	});
});

describe("scoreTrial", () => {
	for (const e of EXPECTED) {
		it(`catches ${e.id} with a specific answer and misses it with a generic one`, () => {
			expect(scoreTrial(reviewBlock([catchingFinding(e)]), e.id, EXPECTED)).toMatchObject({ caught: true, malformed: false });
			const generic = { severity: "BLOCKER", location: `${e.locationFile}:1`, concreteFailure: "Could be improved somehow.", suggestedFix: "Refactor." };
			expect(scoreTrial(reviewBlock([generic]), e.id, EXPECTED)).toMatchObject({ caught: false, malformed: false });
		});
	}

	it("blind control scores zero on every defect", () => {
		for (const e of EXPECTED) {
			expect(scoreTrial(reviewBlock([]), e.id, EXPECTED)).toMatchObject({ caught: false, malformed: false });
		}
	});

	it("shotgun control scores zero on every defect", () => {
		const shotgun = Array.from({ length: 20 }, (_unused, i) => ({
			severity: "BLOCKER",
			location: `${EXPECTED[i % EXPECTED.length]?.locationFile}:${i + 1}`,
			concreteFailure: "General code quality concern -- this area could probably be improved somehow.",
			suggestedFix: "Consider refactoring for clarity.",
		}));
		for (const e of EXPECTED) {
			const score = scoreTrial(reviewBlock(shotgun), e.id, EXPECTED);
			expect(score.caught).toBe(false);
			expect(score.malformed).toBe(false);
			expect(score.unmatchedFindings).toBe(20);
		}
	});

	it("counts malformed output without throwing", () => {
		const bad = [
			"",
			"no block here",
			"```json\n{not json}\n```",
			"```json\n[]\n```",
			'```json\n{"verdicts":[],"findings":[]}\n```',
			'```json\n{"verdicts":',
			"```json".repeat(50_000),
		];
		for (const text of bad) {
			expect(scoreTrial(text, EXPECTED[0]?.id ?? "", EXPECTED)).toMatchObject({ malformed: true, caught: false });
		}
	});

	it("uses the last json block", () => {
		const e = EXPECTED[0] as SeededDefectExpectation;
		const text = `${reviewBlock([])}\nCorrection:\n${reviewBlock([catchingFinding(e)])}`;
		expect(scoreTrial(text, e.id, EXPECTED).caught).toBe(true);
	});
});

describe("armArgs", () => {
	const NO_FLAGS = ["-ne", "-ns", "-nc", "-np"];

	it("A and C differ only by the append-system-prompt pair", () => {
		const a = armArgs("A", {});
		const c = armArgs("C", { padFile: "/tmp/pad.md" });
		expect(c).toEqual([...a, "--append-system-prompt", "/tmp/pad.md"]);
	});

	it("B and F differ only by the profile value", () => {
		const b = armArgs("B", {});
		const f = armArgs("F", {});
		expect(b.map((v) => (v === "implement" ? "full" : v))).toEqual(f);
		expect(b[b.indexOf("--ky-profile") + 1]).toBe("implement");
		expect(f[f.indexOf("--ky-profile") + 1]).toBe("full");
	});

	it("every arm runs one-shot JSON mode", () => {
		for (const id of ["A", "B", "F", "C"] as const) {
			const args = armArgs(id, { padFile: "p" });
			expect(args.join(" ")).toContain("--mode json");
			expect(args).toContain("-p");
		}
	});

	it("minimal arms strip everything and pin the four built-in tools; harness arms strip nothing", () => {
		for (const id of ["A", "C"] as const) {
			const args = armArgs(id, { padFile: "p" });
			for (const flag of NO_FLAGS) expect(args).toContain(flag);
			expect(args[args.indexOf("--tools") + 1]).toBe("read,bash,edit,write");
		}
		for (const id of ["B", "F"] as const) {
			const args = armArgs(id, {});
			for (const flag of NO_FLAGS) expect(args).not.toContain(flag);
			expect(args).not.toContain("--tools");
		}
	});

	it("the padded arm needs a pad file", () => {
		expect(() => armArgs("C", {})).toThrow();
	});
});

describe("padFileText", () => {
	const sources = ["alpha prose.", "beta prose that is a little longer.", "gamma."];

	it("returns exactly the requested size, deterministically, from the sources only", () => {
		const text = padFileText(1000, sources);
		expect(text).toHaveLength(1000);
		expect(padFileText(1000, sources)).toBe(text);
		const leftover = text.replace(/alpha prose\.|beta prose that is a little longer\.|gamma\.|\s/g, "");
		expect(leftover.length).toBeLessThanOrEqual(8);
	});

	it("scales linearly (negative control)", () => {
		expect(padFileText(2000, sources)).toHaveLength(2 * padFileText(1000, sources).length);
	});

	it("rejects empty sources", () => {
		expect(() => padFileText(10, [])).toThrow();
	});
});

describe("summarise", () => {
	const msg = (text: string) => fauxAssistantMessage([fauxText(text)], { stopReason: "stop" });
	const output = (...messages: ReturnType<typeof msg>[]) => ({
		finalText: "",
		assistantMessages: messages,
		usage: { input: 100, cacheRead: 40 },
		stopReason: "stop" as const,
	});
	const tools = { A: ["bash"], B: ["bash"], F: ["bash"], C: ["bash"] };

	it("counts catches, malformed output, prose trials and tokens per arm", () => {
		const result = summarise(
			[
				{ arm: "A", defect: "d1", repeat: 0, score: { caught: true, malformed: false, unmatchedFindings: 1 }, output: output(msg("done")) },
				{ arm: "A", defect: "d2", repeat: 0, score: { caught: false, malformed: true, unmatchedFindings: 0 }, output: output(msg("bash({ command: 'ls' })")) },
			],
			tools,
		);
		expect(result.A).toMatchObject({
			trials: 2,
			caught: 1,
			malformed: 1,
			proseMessages: 1,
			proseTrials: 1,
			misses: 1,
			missesInProseTrials: 1,
			unmatchedFindings: 1,
			inputTokens: 200,
			cacheReadTokens: 80,
		});
		expect(result.F).toBeUndefined();
	});
});

describe("per-arm tool lists", () => {
	it("FULL_ARM_TOOLS is what the full harness declares", async () => {
		const full = await measureFloor({ profile: "full", agentsMd: false });
		expect([...full.toolNames].sort()).toEqual([...FULL_ARM_TOOLS].sort());
	}, 90_000);

	it("each arm is judged against its own tools", () => {
		expect(armActiveTools("A")).toEqual(["read", "bash", "edit", "write"]);
		expect(armActiveTools("C")).toEqual(armActiveTools("A"));
		expect([...armActiveTools("B")].sort()).toEqual(["approve_ky_command", "bash", "consult_advisor", "edit", "read", "todo", "write"]);
		expect(armActiveTools("F")).toEqual(FULL_ARM_TOOLS);
	});

	it("a prose call to a harness-only tool counts in the harness arm", () => {
		const prose = fauxAssistantMessage([fauxText("todo({ action: 'add', text: 'x' })")], { stopReason: "stop" });
		const output = { finalText: "", assistantMessages: [prose], usage: undefined, stopReason: "stop" as const };
		const score = { caught: false, malformed: true, unmatchedFindings: 0 };
		const tools = { A: armActiveTools("A"), B: armActiveTools("B"), F: armActiveTools("F"), C: armActiveTools("C") };
		const result = summarise(
			[
				{ arm: "F", defect: "d1", repeat: 0, score, output },
				{ arm: "A", defect: "d1", repeat: 0, score, output },
			],
			tools,
		);
		expect(result.F?.proseMessages).toBe(1);
		expect(result.A?.proseMessages).toBe(0);
	});
});

describe("PAD_TOKENS", () => {
	it("equals the measured full-harness floor minus the bare floor", async () => {
		const full = await measureFloor({ profile: "full", agentsMd: false });
		const bare = await measureFloor({ entryPoints: [], agentsMd: false, skills: false });
		expect(PAD_TOKENS).toBe(full.budget.floor.estimatedTokens - bare.budget.floor.estimatedTokens);
	}, 90_000);
});
