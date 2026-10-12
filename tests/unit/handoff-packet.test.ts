/**
 * FLOW-09 -- `.pi/extensions/execute/handoff.ts`, proved: the subagent probe
 * refuses to say "available" when it is not, the packet is proved
 * self-contained (presence AND absence), and the token delta is a recorded
 * measurement, never an asserted sign.
 *
 * `09-VALIDATION.md` line 52's own falsification: "with no subagent tool
 * registered the probe must NOT return available; a packet carrying the
 * whole SPEC must fail the self-containment/size assertion." This file
 * mirrors `quality-gates.test.ts`'s own three-state-probe shape
 * (`probeLspAvailability`) for the positive control / partial / empty
 * triple, and adds `buildHandoffPacket`'s own presence-and-absence pair --
 * presence alone would pass on a builder that includes everything.
 */
import { describe, expect, it } from "vitest";

import {
	SUBAGENT_TOOL_NAMES,
	buildHandoffPacket,
	measurePacketDelta,
	probeSubagentAvailability,
	renderHandoffPacket,
} from "../../.pi/extensions/execute/handoff.ts";
import { estimateTokensFromChars } from "../../.pi/extensions/diagnostics/budget.ts";
import { renderSpecMarkdown, validateSpec, type SpecArtifact } from "../../.pi/extensions/grill/spec-schema.ts";
import { parseTaskLine, renderPlanMarkdown, validatePlan, type ParsedTask } from "../../.pi/extensions/plan-ceremony/plan-schema.ts";
import { extractSpecRequirementIds, parseRequirementEntries, requirementIdsWithoutEntry } from "../../.pi/extensions/plan-ceremony/requirement-ids.ts";

// ---------------------------------------------------------------------------
// probeSubagentAvailability -- the three-state table, mirroring gates.ts's
// own probeLspAvailability tests
// ---------------------------------------------------------------------------

describe("FLOW-09 -- probeSubagentAvailability: honest degradation, never a silent pass", () => {
	it("empty list -> unavailable, reason names both missing tools, pi-subagents, RB-07-02 and RB-09-03", () => {
		const result = probeSubagentAvailability([]);
		expect(result.status).toBe("unavailable");
		if (result.status !== "unavailable") throw new Error("unreachable");
		expect(result.reason).toContain("subagent");
		expect(result.reason).toContain("bg_wait");
		expect(result.reason).toContain("pi-subagents");
		expect(result.reason).toContain("RB-07-02");
		expect(result.reason).toContain("RB-09-03");
	});

	it("partial (only 'subagent' present) -> unavailable, reason names the ONE still-missing tool", () => {
		const result = probeSubagentAvailability(["subagent"]);
		expect(result.status).toBe("unavailable");
		if (result.status !== "unavailable") throw new Error("unreachable");
		expect(result.reason).toContain("bg_wait");
		// A partial install must not read as available, and the reason must not
		// re-name the tool that IS present as though it too were missing.
		expect(result.reason.includes("missing tools")).toBe(false);
	});

	it("positive control: both SUBAGENT_TOOL_NAMES present -> pass", () => {
		// Without this positive control, probeSubagentAvailability could be
		// `() => ({status: "unavailable", ...})` unconditionally and every case
		// above would still pass.
		expect(probeSubagentAvailability([...SUBAGENT_TOOL_NAMES])).toEqual({ status: "pass" });
	});

	it("extra tools present alongside both required ones -> still pass", () => {
		expect(probeSubagentAvailability([...SUBAGENT_TOOL_NAMES, "subagent_supervisor", "intercom"])).toEqual({
			status: "pass",
		});
	});

	it("ignores settings entirely: a fixture object shaped like a settings file declaring the package changes nothing -- the function takes no settings input at all", () => {
		// Deliberately NOT a real .pi/settings.json and never written to disk --
		// the point is that probeSubagentAvailability's own signature has no
		// parameter this object could even be passed through. Declaring the
		// package here and then calling the probe with an EMPTY registered-tool
		// list proves the probe answers only from the list it was given.
		const settingsShapedFixture = { packages: ["npm:pi-subagents@0.76.1"] };
		expect(Object.keys(settingsShapedFixture)).toContain("packages"); // vacuity guard on the fixture itself
		const result = probeSubagentAvailability([]);
		expect(result.status).toBe("unavailable");
	});
});

// ---------------------------------------------------------------------------
// Fixtures shared by the packet-builder tests below
// ---------------------------------------------------------------------------

/** claim text deliberately embedded verbatim inside R2's and R4's excerpt text, so selectReferencedFacts has something real to find. */
const R2_REFERENCED_CLAIM = "the session store lives at src/auth/session.ts";
const R4_REFERENCED_CLAIM = "tokens expire after 30 days today";
const UNREFERENCED_CLAIM = "an unrelated fact about the checkpoint store";

const FIVE_REQUIREMENT_SPEC: SpecArtifact = {
	goal: "Add refresh-token rotation to the session store.",
	verifiedFacts: [
		{ claim: R2_REFERENCED_CLAIM, evidence: "src/auth/session.ts:1", howVerified: "read the file" },
		{ claim: R4_REFERENCED_CLAIM, evidence: "src/auth/session.ts:44", howVerified: "read the file" },
		{ claim: UNREFERENCED_CLAIM, evidence: ".pi/extensions/checkpoint/store.ts:1", howVerified: "read the file" },
	],
	requirementsBody:
		"R1: rotate refresh tokens on use.\n\n" +
		`R2: ${R2_REFERENCED_CLAIM}, so rotation must not break an existing session.\n\n` +
		"R3: log every rotation for audit purposes.\n\n" +
		`R4: ${R4_REFERENCED_CLAIM}, and rotation must preserve that window.\n\n` +
		"R5: document the rotation flow for future maintainers.",
	errorBehaviours: [
		"IF a token is reused THEN THE SYSTEM SHALL reject the request",
		"IF the store is unreachable THEN THE SYSTEM SHALL fail closed",
		"IF a token expires THEN THE SYSTEM SHALL require re-authentication",
	],
	scopePin: {
		inScope: ["token rotation"],
		outOfScope: [{ item: "password reset", reason: "unrelated to token rotation" }],
		expectedFiles: ["src/auth/session.ts"],
	},
	clarificationsBody: "- Q: none -> A: none",
	assumptionsBody: "none",
	scorecardBody: "Overall: 0.1",
};

const SPEC_REQUIREMENT_IDS = extractSpecRequirementIds(FIVE_REQUIREMENT_SPEC.requirementsBody);

/** T001, citing [R2,R4] only. */
function parseTaskOrThrow(line: string): ParsedTask {
	const parsed = parseTaskLine(line);
	if ("malformed" in parsed) {
		throw new Error(`fixture task line is malformed, the fixture itself is broken: ${parsed.malformed}`);
	}
	return parsed;
}

const TASK_CITING_R2_R4 = parseTaskOrThrow(
	"- [ ] T001 [R2,R4] Add refresh-token rotation to src/auth/session.ts | verify: npm test",
);

// ---------------------------------------------------------------------------
// buildHandoffPacket -- self-containment proved both ways
// ---------------------------------------------------------------------------

describe("FLOW-09 -- buildHandoffPacket: presence AND absence, never 'all of them'", () => {
	it("packet contains the R2 and R4 excerpts", () => {
		const packet = buildHandoffPacket({ spec: FIVE_REQUIREMENT_SPEC, task: TASK_CITING_R2_R4 });
		expect(packet.requirementExcerpts.some((e) => e.startsWith("R2:"))).toBe(true);
		expect(packet.requirementExcerpts.some((e) => e.startsWith("R4:"))).toBe(true);
	});

	it("packet does NOT contain the R1, R3 or R5 excerpts -- presence alone would pass on a builder that includes everything", () => {
		const packet = buildHandoffPacket({ spec: FIVE_REQUIREMENT_SPEC, task: TASK_CITING_R2_R4 });
		expect(packet.requirementExcerpts.some((e) => e.startsWith("R1:"))).toBe(false);
		expect(packet.requirementExcerpts.some((e) => e.startsWith("R3:"))).toBe(false);
		expect(packet.requirementExcerpts.some((e) => e.startsWith("R5:"))).toBe(false);
	});

	it("verifiedFacts includes the facts referenced by R2/R4's excerpt text and excludes the unreferenced one", () => {
		const packet = buildHandoffPacket({ spec: FIVE_REQUIREMENT_SPEC, task: TASK_CITING_R2_R4 });
		const claims = packet.verifiedFacts.map((f) => f.claim);
		expect(claims).toContain(R2_REFERENCED_CLAIM);
		expect(claims).toContain(R4_REFERENCED_CLAIM);
		expect(claims).not.toContain(UNREFERENCED_CLAIM);
	});

	it("filePaths and verificationCommand come from the task, unchanged", () => {
		const packet = buildHandoffPacket({ spec: FIVE_REQUIREMENT_SPEC, task: TASK_CITING_R2_R4 });
		expect(packet.filePaths).toEqual(["src/auth/session.ts"]);
		expect(packet.verificationCommand).toBe("npm test");
		expect(packet.taskId).toBe("T001");
	});

	it("the rendered packet text carries no §3 entry for an unreferenced requirement, and no conversation marker", () => {
		const packet = buildHandoffPacket({ spec: FIVE_REQUIREMENT_SPEC, task: TASK_CITING_R2_R4 });
		const rendered = renderHandoffPacket(packet);
		expect(rendered).not.toContain("R1:");
		expect(rendered).not.toContain("R3:");
		expect(rendered).not.toContain("R5:");
		expect(rendered).not.toContain(UNREFERENCED_CLAIM);
		// No conversation marker: this packet is built entirely from the SPEC
		// artifact and the task, never from session messages, so there is
		// nothing shaped like a transcript to find.
		expect(rendered.toLowerCase()).not.toContain("user:");
		expect(rendered.toLowerCase()).not.toContain("assistant:");
	});

	it("throws when the task cites a requirement id the SPEC declares nowhere in §3", () => {
		const taskCitingUndeclaredId = parseTaskOrThrow(
			"- [ ] T002 [R9] Do something unrelated in src/b.ts | verify: npm test",
		);
		expect(() => buildHandoffPacket({ spec: FIVE_REQUIREMENT_SPEC, task: taskCitingUndeclaredId })).toThrow(
			/R9/,
		);
	});

	it("reads the same entries validatePlan's ids come from: bold, dotted and long final entries all resolve", () => {
		const longTail = "x".repeat(3000);
		const spec = { ...FIVE_REQUIREMENT_SPEC, requirementsBody: `- **R1** - rotate tokens.\nR2. expire them.\nR4: ${longTail}` };
		const packet = buildHandoffPacket({ spec, task: TASK_CITING_R2_R4 });
		expect(packet.requirementExcerpts[0]).toBe("R2. expire them.");
		expect(packet.requirementExcerpts[1]).toContain(longTail);
		expect(parseRequirementEntries(spec.requirementsBody).map((e) => e.id)).toEqual(["R1", "R2", "R4"]);
	});

	it("a §3 that mentions an id with no entry of its own is reported", () => {
		expect(requirementIdsWithoutEntry("R1: rotate tokens, unlike R7.")).toEqual(["R7"]);
	});

	it("a §2 fact tagged [R#] for one of the task's ids travels with the packet", () => {
		const spec = {
			...FIVE_REQUIREMENT_SPEC,
			verifiedFacts: [...FIVE_REQUIREMENT_SPEC.verifiedFacts, { claim: "[R4] tokens live in redis", evidence: "src/a.ts:1", howVerified: "read" }],
		};
		expect(buildHandoffPacket({ spec, task: TASK_CITING_R2_R4 }).verifiedFacts.map((f) => f.claim)).toContain("[R4] tokens live in redis");
	});
});

// ---------------------------------------------------------------------------
// measurePacketDelta -- arithmetic asserted, sign never asserted
// ---------------------------------------------------------------------------

describe("FLOW-09 -- measurePacketDelta: a measurement, never an assertion", () => {
	it("returns packetTokens/parentTokens computed via estimateTokensFromChars, and deltaTokens = packetTokens - parentTokens", () => {
		const packetText = "a short packet";
		const parentContextText = "a much, much longer parent context string that stands in for everything this packet replaces";
		const result = measurePacketDelta({ packetText, parentContextText });
		expect(result.packetTokens).toBe(estimateTokensFromChars(packetText.length));
		expect(result.parentTokens).toBe(estimateTokensFromChars(parentContextText.length));
		expect(result.deltaTokens).toBe(result.packetTokens - result.parentTokens);
		expect(result.method.length).toBeGreaterThan(0);
	});

	// Criterion 5's "negative tokens" is MEASURED and RECORDED, never
	// asserted -- asserting the sign here would convert a measurement into a
	// target and invite tuning the fixture until it reads negative. This file
	// deliberately contains no assertion on the SIGN of deltaTokens anywhere;
	// see the acceptance grep this plan runs against this exact file.
	it("does not assert the sign of deltaTokens -- both a shrinking and a growing packet are legitimate, recordable outcomes", () => {
		const shrinking = measurePacketDelta({ packetText: "x", parentContextText: "x".repeat(10_000) });
		const growing = measurePacketDelta({ packetText: "x".repeat(10_000), parentContextText: "x" });
		// Both are recorded as plain numbers -- neither is asserted to be
		// negative or positive; only that the arithmetic holds for both shapes.
		expect(shrinking.deltaTokens).toBe(shrinking.packetTokens - shrinking.parentTokens);
		expect(growing.deltaTokens).toBe(growing.packetTokens - growing.parentTokens);
	});
});

// ---------------------------------------------------------------------------
// The realistic-fixture measurement -- run once, recorded in 09-11-SUMMARY.md
// ---------------------------------------------------------------------------

describe("FLOW-09 -- the recorded realistic-fixture measurement", () => {
	it("measures a real packet against a real SPEC.md + PLAN.md parent-context string, and the arithmetic holds", () => {
		const specMarkdown = renderSpecMarkdown(FIVE_REQUIREMENT_SPEC);
		const specVerdict = validateSpec(specMarkdown);
		if (!specVerdict.ok) {
			throw new Error(`fixture SPEC does not validate, the fixture itself is broken: ${specVerdict.reason}`);
		}

		const planMarkdown =
			"- [ ] T001 [R2,R4] Add refresh-token rotation to src/auth/session.ts | verify: npm test\n" +
			"- [ ] T002 [R1] Reject reused tokens in src/auth/session.ts | verify: npm test\n" +
			"- [ ] T003 [R3] Log every rotation in src/auth/session.ts | verify: npm test\n" +
			"- [ ] T004 [R5] Document the flow in docs/AUTH.md | verify: npx tsc --noEmit\n";
		const planVerdict = validatePlan(planMarkdown, SPEC_REQUIREMENT_IDS);
		if (!planVerdict.ok) {
			throw new Error(`fixture PLAN does not validate, the fixture itself is broken: ${planVerdict.reason}`);
		}
		const planRendered = renderPlanMarkdown(planVerdict.plan);

		const task = planVerdict.plan.tasks.find((t) => t.id === "T001");
		if (task === undefined) {
			throw new Error("fixture PLAN lost T001, the fixture itself is broken");
		}

		const packet = buildHandoffPacket({ spec: specVerdict.spec, task });
		const packetText = renderHandoffPacket(packet);
		const parentContextText = `${specMarkdown}\n\n${planRendered}`;

		const measurement = measurePacketDelta({ packetText, parentContextText });

		// The arithmetic, asserted -- the SIGN is not, per this file's own
		// discipline above. Printed so a real run's numbers are visible in the
		// test transcript and can be copied into 09-11-SUMMARY.md verbatim.
		console.log(
			`[FLOW-09 recorded measurement] packetTokens=${measurement.packetTokens} ` +
				`parentTokens=${measurement.parentTokens} deltaTokens=${measurement.deltaTokens} ` +
				`packetChars=${packetText.length} parentChars=${parentContextText.length} method=${measurement.method}`,
		);

		expect(measurement.packetTokens).toBe(estimateTokensFromChars(packetText.length));
		expect(measurement.parentTokens).toBe(estimateTokensFromChars(parentContextText.length));
		expect(measurement.deltaTokens).toBe(measurement.packetTokens - measurement.parentTokens);
	});
});
