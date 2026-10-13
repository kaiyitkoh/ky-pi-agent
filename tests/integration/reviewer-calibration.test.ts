/**
 * The seeded-defect calibration run with its negative controls. A: the six fixtures are each invisible to the
 * deterministic stage, so the catch rate measures the model reviewer. B: one combined contract is reviewed by six
 * scripted reviewers (a known subset, blind, shotgun and three answer-key-gaming shapes). C: two independent builds
 * must score identically. Faux reviewers only: this measures the scorer and wiring, never a real model.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { scoreCalibration, type CalibrationResult, type SeededDefectExpectation } from "../../.pi/extensions/quality/calibration.ts";
import { buildImportGraph, runReview, type ReviewerContractInput } from "../../.pi/extensions/quality/reviewer.ts";
import { runAntiPatternRules, type QualitySource } from "../../.pi/extensions/quality/rules.ts";
import { getModeState, setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";
import { wrapFauxWithPayload } from "../helpers/faux.ts";
import { makeTempRepo } from "../helpers/git.ts";
import { createFauxSession, waitForConfiguredAuth } from "../helpers/session.ts";
import { DEFECT_CLASSES, SEEDED_DEFECTS } from "../fixtures/seeded-defects/index.ts";

// -----------------------------------------------------------------------------
// A -- corpus integrity
// -----------------------------------------------------------------------------

describe("GATE-08 corpus integrity", () => {
	it("SEEDED_DEFECTS has exactly six entries, one per DEFECT_CLASSES id, no duplicates", () => {
		expect(SEEDED_DEFECTS).toHaveLength(6);
		const ids = SEEDED_DEFECTS.map((defect) => defect.id);
		expect(new Set(ids).size, `duplicate defect id(s) in SEEDED_DEFECTS: ${JSON.stringify(ids)}`).toBe(6);
		for (const classId of DEFECT_CLASSES) {
			expect(ids, `DEFECT_CLASSES id "${classId}" has no corresponding SEEDED_DEFECTS entry`).toContain(classId);
		}
	});

	it("every entry's incident names a phase number and the real incident", () => {
		for (const defect of SEEDED_DEFECTS) {
			expect(defect.incident, `defect "${defect.id}" has no incident text`).toMatch(/Phase \d+/);
		}
	});

	/**
	 * Two needles in one expectation must be independent: neither a substring of the other nor bridged by a shared word.
	 * Sound but not complete; the exploit-string controls below cover the pairs no string check can see.
	 */
	function needlesOverlap(a: string, b: string): boolean {
		if (a === b) return false;
		if (a.includes(b) || b.includes(a)) return true;
		const aWords = a.split(" ");
		const bWords = b.split(" ");
		const maxOverlap = Math.min(aWords.length, bWords.length);
		for (let k = 1; k <= maxOverlap; k++) {
			if (aWords.slice(-k).join(" ") === bWords.slice(0, k).join(" ")) return true; // a's tail bridges into b's head
			if (bWords.slice(-k).join(" ") === aWords.slice(0, k).join(" ")) return true; // b's tail bridges into a's head
		}
		return false;
	}

	it("MUTATION CHECK -- needlesOverlap is not vacuously false: it flags the real pre-fix CR3C-01 pair", () => {
		expect(needlesOverlap("cannot fail", "structurally cannot")).toBe(true);
		expect(needlesOverlap("structurally cannot", "cannot fail")).toBe(true); // order-independent
		expect(needlesOverlap("performs none", "hardcoded return")).toBe(false); // a genuinely independent pair stays false
	});

	it("no two needles within one expectation are jointly satisfiable by a shared word or substring containment, corpus-wide", () => {
		for (const defect of SEEDED_DEFECTS) {
			const needles = defect.expected.mustMentionAny;
			for (let i = 0; i < needles.length; i++) {
				for (let j = i + 1; j < needles.length; j++) {
					expect(
						needlesOverlap(needles[i], needles[j]),
						`"${needles[i]}" and "${needles[j]}" (${defect.id}) are not independent needles -- ` +
							"a shared word or substring containment lets one contiguous phrase satisfy both (CR3C-01)",
					).toBe(false);
				}
			}
		}
	});

	afterEach(() => {
		vi.doUnmock("node:fs");
		vi.resetModules();
	});

	it("importing the corpus module performs no file-system write (proven against a mocked node:fs)", async () => {
		vi.resetModules();
		const writeFileSyncMock = vi.fn();
		const mkdirSyncMock = vi.fn();
		vi.doMock("node:fs", async () => {
			const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
			return { ...actual, writeFileSync: writeFileSyncMock, mkdirSync: mkdirSyncMock };
		});

		await import("../fixtures/seeded-defects/index.ts");

		expect(
			writeFileSyncMock,
			"importing tests/fixtures/seeded-defects/index.ts called writeFileSync -- import-time side effects are not allowed",
		).not.toHaveBeenCalled();
		expect(
			mkdirSyncMock,
			"importing tests/fixtures/seeded-defects/index.ts called mkdirSync -- import-time side effects are not allowed",
		).not.toHaveBeenCalled();
	});

	describe("every fixture is invisible to the deterministic stage, by construction", () => {
		for (const defect of SEEDED_DEFECTS) {
			it(`${defect.id}: runAntiPatternRules reports zero ERROR-tier findings`, () => {
				const repo = makeTempRepo(`kypi-seeded-defect-${defect.id}-`);
				const { touchedFiles } = defect.build(repo);
				expect(touchedFiles.length, `defect "${defect.id}" built zero touched files`).toBeGreaterThan(0);

				const sources: QualitySource[] = touchedFiles.map((path) => ({
					path,
					text: readFileSync(join(repo, path), "utf-8"),
				}));
				const findings = runAntiPatternRules(sources);
				const errorFindings = findings.filter((f) => f.tier === "error");

				expect(
					errorFindings,
					`defect "${defect.id}" was caught by the deterministic stage (${JSON.stringify(errorFindings)}) -- ` +
						"it belongs in plan 08-02's rule tests, not this calibration corpus",
				).toHaveLength(0);
			});
		}
	});
});

// -----------------------------------------------------------------------------
// B/C -- the calibration group, driven through runReview, plus reproducibility
// -----------------------------------------------------------------------------

const REQUIREMENT_ID = "GATE-08";

/**
 * The classes the known-subset reviewer's unmodified text catches: 2 of 6. Its text is deliberately not extended to
 * clear the two-needle bar; the catch rate is a measurement, not a target.
 */
const KNOWN_SUBSET_CAUGHT: readonly string[] = ["fabricated-evidence", "absent-guard"];

/** Builds ALL six defects into ONE fresh temp repo and assembles the combined review contract. */
function buildCombinedFixture(prefix: string): { contract: ReviewerContractInput; requirementIds: string[] } {
	const repo = makeTempRepo(prefix);

	const touchedPaths: string[] = [];
	const diffs: string[] = [];
	for (const defect of SEEDED_DEFECTS) {
		const built = defect.build(repo);
		touchedPaths.push(...built.touchedFiles);
		diffs.push(built.diff);
	}

	const touchedFiles = touchedPaths.map((path) => ({ path, contents: readFileSync(join(repo, path), "utf-8") }));

	const contract: ReviewerContractInput = {
		diff: diffs.join("\n"),
		touchedFiles,
		gateReport: "typecheck: PASS\nlint: PASS\nlsp: UNAVAILABLE (RB-08-02)\nanti-pattern: PASS",
		requirements: [{ id: REQUIREMENT_ID, text: "GATE-08 seeded-defect calibration corpus review." }],
		filesTouchedUnion: touchedPaths,
		importGraph: buildImportGraph(touchedFiles.map((f) => ({ path: f.path, text: f.contents }))),
	};

	return { contract, requirementIds: [REQUIREMENT_ID] };
}

function verdictFor(status: "Implemented" | "Partial" | "Missing", evidence: string) {
	return { requirementId: REQUIREMENT_ID, status, evidence };
}

/** The known-subset reviewer's submit_review arguments, unmodified text (see {@link KNOWN_SUBSET_CAUGHT}). */
const KNOWN_SUBSET_ARGS = {
	verdicts: [verdictFor("Partial", "src/evidence-claim.ts:1")],
	findings: [
		{
			severity: "BLOCKER",
			location: "src/evidence-claim.ts:5",
			concreteFailure: "markMigrationComplete claims verification occurred but performs none -- it is a hardcoded return.",
			suggestedFix: "Actually run and check the migration before reporting success.",
		},
		{
			severity: "BLOCKER",
			location: "src/dispatch-real.ts:4",
			concreteFailure: "dispatchCommand never calls isGuardedCommand before executing -- the guard is unit-tested but not wired in.",
			suggestedFix: "Call isGuardedCommand(command) and refuse before execSync.",
		},
		{
			severity: "BLOCKER",
			location: "src/parser-mutation-claim.test.ts:3",
			// One needle only ("regardless of input"), so it does not catch; deliberately left that way.
			concreteFailure: "Comment claims MUTATION-VERIFIED but parseCommand always returns true regardless of input.",
			suggestedFix: "Remove the false claim or make the test actually exercise parseCommand's logic.",
		},
	],
	checkedAndCleared:
		"Reviewed all six touched areas. Found the three issues above; the router test, the settings-persistence " +
		"test, and the rate limiter change looked fine on this pass.",
	classification: "symptomatic",
	classificationJustification: "The three flagged issues patch around missing checks rather than fixing behavior.",
};

/** The blind reviewer's submit_review arguments: zero findings, everything approved. THE NEGATIVE CONTROL. */
const BLIND_REVIEWER_ARGS = {
	verdicts: [verdictFor("Implemented", "src/evidence-claim.ts:1")],
	findings: [],
	checkedAndCleared: "Reviewed everything in this change; all six touched areas look correct and complete.",
	classification: "root-cause",
	classificationJustification: "The change addresses its stated purpose directly.",
};

/**
 * Twenty vague findings over the real touched files: with every location correct, only the missing needles keep
 * them from catching, so vagueness alone is what is tested.
 */
const SHOTGUN_FINDING_COUNT = 20;
const SHOTGUN_LOCATION_FILES = [
	"src/evidence-claim.ts",
	"src/router-wire-proof.test.ts",
	"tests/settings-persistence.test.ts",
	"src/dispatch-real.ts",
	"src/rate-limiter.ts",
	"src/parser-mutation-claim.test.ts",
];
const SHOTGUN_REVIEWER_ARGS = {
	verdicts: [verdictFor("Partial", "src/evidence-claim.ts:1")],
	findings: Array.from({ length: SHOTGUN_FINDING_COUNT }, (_unused, index) => ({
		severity: "BLOCKER" as const,
		location: `${SHOTGUN_LOCATION_FILES[index % SHOTGUN_LOCATION_FILES.length]}:${index + 1}`,
		concreteFailure: "General code quality concern -- this area could probably be improved somehow.",
		suggestedFix: "Consider refactoring for clarity.",
	})),
	checkedAndCleared: "Skimmed the change broadly; general concerns noted above cover most of it.",
	classification: "symptomatic",
	classificationJustification: "Could not pin down a single root cause across this many files.",
};

/**
 * Names each file's conspicuous symbol with no defect description, derivable from the input alone. Naming a symbol
 * is not identifying a defect, so this must score 0.
 */
const SHOTGUN_NAME_DROP_SYMBOLS = ["markMigrationComplete", "configuredHead", "homedir()", "isGuardedCommand", "isWithinRateLimit", "MUTATION-VERIFIED"];
const SHOTGUN_NAME_DROP_ARGS = {
	verdicts: [verdictFor("Partial", "src/evidence-claim.ts:1")],
	findings: SHOTGUN_LOCATION_FILES.map((file, index) => ({
		severity: "BLOCKER" as const,
		location: `${file}:${index + 1}`,
		concreteFailure: `${SHOTGUN_NAME_DROP_SYMBOLS[index]} in this file could use a closer look.`,
		suggestedFix: "Take a closer look at this.",
	})),
	checkedAndCleared: "Named the most notable symbol in each of the six touched files.",
	classification: "symptomatic",
	classificationJustification: "Named a symbol per file without diagnosing a specific defect in any of them.",
};

/**
 * One boilerplate sentence reused for all six files, carrying exactly one needle per class (built from the answer
 * key). Must score 0: a catch needs two independent needles.
 */
const SHOTGUN_KITCHEN_SINK_CONCRETE_FAILURE =
	"This code cannot fail; it performs none of the verification it claims, writes into the real home directory, " +
	"never calls isGuardedCommand, and always returns true regardless of input.";
const SHOTGUN_KITCHEN_SINK_ARGS = {
	verdicts: [verdictFor("Partial", "src/evidence-claim.ts:1")],
	findings: SHOTGUN_LOCATION_FILES.map((file, index) => ({
		severity: "BLOCKER" as const,
		location: `${file}:${index + 1}`,
		concreteFailure: SHOTGUN_KITCHEN_SINK_CONCRETE_FAILURE,
		suggestedFix: "Fix it.",
	})),
	checkedAndCleared: "Applied the same general-purpose finding template to each of the six touched files.",
	classification: "symptomatic",
	classificationJustification: "The template names failure modes generically without diagnosing any one file's actual defect.",
};

/**
 * The same boilerplate with two near-synonym needles per class. Must score 0: a finding that also clears another
 * expectation's bar is rejected.
 */
const TWO_NEEDLE_KITCHEN_SINK_CONCRETE_FAILURE =
	"This code structurally cannot be trusted and cannot fail; it performs none of the verification it claims and " +
	"offers no actual verification; it writes into the real home directory and escapes the test sandbox; it never " +
	"calls isGuardedCommand and is simply not wired in; it always returns true, unconditionally true; and it does " +
	"the same regardless of input, so the label survived its own mutation.";
const TWO_NEEDLE_KITCHEN_SINK_ARGS = {
	verdicts: [verdictFor("Partial", "src/evidence-claim.ts:1")],
	findings: SHOTGUN_LOCATION_FILES.map((file, index) => ({
		severity: "BLOCKER" as const,
		location: `${file}:${index + 1}`,
		concreteFailure: TWO_NEEDLE_KITCHEN_SINK_CONCRETE_FAILURE,
		suggestedFix: "Fix it.",
	})),
	checkedAndCleared: "Applied the same general-purpose finding template, now with two phrases per class, to each of the six touched files.",
	classification: "symptomatic",
	classificationJustification: "The template names two failure-mode phrases per class generically without diagnosing any one file's actual defect.",
};

interface CalibrationSuiteResult {
	knownSubset: CalibrationResult;
	blind: CalibrationResult;
	shotgun: CalibrationResult;
	shotgunNameDrop: CalibrationResult;
	shotgunKitchenSink: CalibrationResult;
	twoNeedleKitchenSink: CalibrationResult;
}

/** Drives the combined corpus through runReview once per scripted reviewer in a fresh repo and session, and scores each. */
async function runCalibrationSuite(prefix: string): Promise<CalibrationSuiteResult> {
	setMode("cheap");
	setEscalated(false);
	expect(getModeState().mode, "test setup did not reset the mode slot to cheap").toBe("cheap");

	const { contract, requirementIds } = buildCombinedFixture(prefix);

	const handle = await createFauxSession({ responses: [fauxAssistantMessage("warm", { stopReason: "stop" })] });

	try {
		const deepseekFaux = fauxProvider({
			provider: "deepseek",
			models: [
				{
					id: "deepseek-flash",
					reasoning: true,
					input: ["text"],
					cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 },
				},
			],
		});

		deepseekFaux.setResponses([
			() => fauxAssistantMessage(fauxToolCall("submit_review", KNOWN_SUBSET_ARGS), { stopReason: "toolUse" }),
			() => fauxAssistantMessage(fauxToolCall("submit_review", BLIND_REVIEWER_ARGS), { stopReason: "toolUse" }),
			() => fauxAssistantMessage(fauxToolCall("submit_review", SHOTGUN_REVIEWER_ARGS), { stopReason: "toolUse" }),
			() => fauxAssistantMessage(fauxToolCall("submit_review", SHOTGUN_NAME_DROP_ARGS), { stopReason: "toolUse" }),
			() => fauxAssistantMessage(fauxToolCall("submit_review", SHOTGUN_KITCHEN_SINK_ARGS), { stopReason: "toolUse" }),
			() => fauxAssistantMessage(fauxToolCall("submit_review", TWO_NEEDLE_KITCHEN_SINK_ARGS), { stopReason: "toolUse" }),
		]);

		handle.modelRuntime.registerNativeProvider(wrapFauxWithPayload(deepseekFaux, undefined));
		await handle.modelRuntime.setRuntimeApiKey("deepseek", "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, "deepseek");

		await handle.session.prompt("warm up");
		const ctx = handle.session.extensionRunner.createCommandContext();

		const knownSubsetResult = await runReview(ctx, { contract, requirementIds });
		const blindResult = await runReview(ctx, { contract, requirementIds });
		const shotgunResult = await runReview(ctx, { contract, requirementIds });
		const shotgunNameDropResult = await runReview(ctx, { contract, requirementIds });
		const shotgunKitchenSinkResult = await runReview(ctx, { contract, requirementIds });
		const twoNeedleKitchenSinkResult = await runReview(ctx, { contract, requirementIds });

		if (!knownSubsetResult.ok) {
			throw new Error(`known-subset runReview was rejected: ${knownSubsetResult.reason}`);
		}
		if (!blindResult.ok) {
			throw new Error(`blind runReview was rejected: ${blindResult.reason}`);
		}
		if (!shotgunResult.ok) {
			throw new Error(`shotgun runReview was rejected: ${shotgunResult.reason}`);
		}
		if (!shotgunNameDropResult.ok) {
			throw new Error(`shotgun name-drop runReview was rejected: ${shotgunNameDropResult.reason}`);
		}
		if (!shotgunKitchenSinkResult.ok) {
			throw new Error(`shotgun kitchen-sink runReview was rejected: ${shotgunKitchenSinkResult.reason}`);
		}
		if (!twoNeedleKitchenSinkResult.ok) {
			throw new Error(`two-needle kitchen-sink runReview was rejected: ${twoNeedleKitchenSinkResult.reason}`);
		}

		const expected: SeededDefectExpectation[] = SEEDED_DEFECTS.map((defect) => ({
			id: defect.id,
			locationFile: defect.expected.locationFile,
			mustMentionAny: defect.expected.mustMentionAny,
			minimumSeverity: defect.expected.minimumSeverity,
		}));

		return {
			knownSubset: scoreCalibration(expected, knownSubsetResult.review.findings),
			blind: scoreCalibration(expected, blindResult.review.findings),
			shotgun: scoreCalibration(expected, shotgunResult.review.findings),
			shotgunNameDrop: scoreCalibration(expected, shotgunNameDropResult.review.findings),
			shotgunKitchenSink: scoreCalibration(expected, shotgunKitchenSinkResult.review.findings),
			twoNeedleKitchenSink: scoreCalibration(expected, twoNeedleKitchenSinkResult.review.findings),
		};
	} finally {
		await handle.dispose();
	}
}

let run1: CalibrationSuiteResult;
let run2: CalibrationSuiteResult;

describe("GATE-08 calibration -- the full corpus driven through runReview", () => {
	beforeAll(async () => {
		run1 = await runCalibrationSuite("kypi-calibration-run1-");
		run2 = await runCalibrationSuite("kypi-calibration-run2-");
	}, 60_000);

	it(
		"WR3-02 -- known-subset: caught === 2, total === 6, catchRate === 2/6 (0.333...), exactly the two classes " +
			"whose findings genuinely clear today's matcher unedited. This fixture was originally scripted to catch " +
			"3 of 6; the false-label finding's text was extended in bb2a67c to keep clearing a bar raised in that " +
			"same commit, which held the reported number at 0.5 by construction, not by measurement. Reverted to " +
			"its unmodified text: see KNOWN_SUBSET_CAUGHT's own docstring for the full disclosure.",
		() => {
			expect(run1.knownSubset.caught).toBe(2);
			expect(run1.knownSubset.total).toBe(6);
			expect(run1.knownSubset.catchRate).toBe(2 / 6);
			for (const id of DEFECT_CLASSES) {
				expect(run1.knownSubset.perDefectClass[id], `perDefectClass["${id}"]`).toBe(KNOWN_SUBSET_CAUGHT.includes(id));
			}
		},
	);

	it("THE NEGATIVE CONTROL -- a deliberately blind reviewer (zero findings, approves everything) scores catchRate === 0", () => {
		expect(run1.blind.caught).toBe(0);
		expect(run1.blind.catchRate).toBe(0);
		for (const id of DEFECT_CLASSES) {
			expect(run1.blind.perDefectClass[id], `perDefectClass["${id}"] must be false for the blind reviewer`).toBe(false);
		}
	});

	it("shotgun: twenty vague findings score catchRate === 0 and unmatchedFindings === 20 -- vagueness does not score", () => {
		expect(run1.shotgun.catchRate).toBe(0);
		expect(run1.shotgun.unmatchedFindings).toBe(SHOTGUN_FINDING_COUNT);
	});

	it(
		"WR-03 -- THE NAME-DROPPING SHOTGUN, a third control: naming each touched file's own most conspicuous " +
			"symbol, with no description of what is wrong, scores catchRate === 0 -- naming a symbol is not " +
			"identifying a defect. Before WR-03's fix this exact fixture scored 1.0 (6/6) having caught nothing.",
		() => {
			expect(run1.shotgunNameDrop.catchRate).toBe(0);
			expect(run1.shotgunNameDrop.unmatchedFindings).toBe(SHOTGUN_LOCATION_FILES.length);
			for (const id of DEFECT_CLASSES) {
				expect(run1.shotgunNameDrop.perDefectClass[id], `perDefectClass["${id}"] must be false for the name-dropping shotgun`).toBe(false);
			}
		},
	);

	it(
		"WR2-05 -- THE BOILERPLATE KITCHEN SINK, a fourth permanent control: one reused sentence containing " +
			"exactly one needle per defect class scores catchRate === 0 -- MIN_DISTINCT_NEEDLES now requires TWO. " +
			"Before this fix this exact fixture scored 1.0 (6/6) having identified zero real defects, and it is " +
			"NOT derivable from the input alone (constructing it requires the corpus's own answer key), so it is " +
			"a strictly weaker exploit than WR-03's name-drop -- still a real one, and now permanently measured.",
		() => {
			expect(run1.shotgunKitchenSink.catchRate).toBe(0);
			expect(run1.shotgunKitchenSink.unmatchedFindings).toBe(SHOTGUN_LOCATION_FILES.length);
			for (const id of DEFECT_CLASSES) {
				expect(run1.shotgunKitchenSink.perDefectClass[id], `perDefectClass["${id}"] must be false for the boilerplate kitchen sink`).toBe(false);
			}
		},
	);

	it(
		"WR3-01 -- THE TWO-NEEDLE KITCHEN SINK, a fifth permanent control: one reused sentence containing " +
			"exactly TWO needles per defect class scores catchRate === 0 -- findingCatches now also rejects a " +
			"finding that independently clears a DIFFERENT, unrelated expectation's own needle bar. Before this " +
			"fix this exact fixture scored 1.0 (6/6) having identified zero real defects, proving " +
			"MIN_DISTINCT_NEEDLES alone (WR2-05) was not sufficient -- see docs/QUALITY.md and calibration.ts's " +
			"own findingCatches docstring for why this is 'one measured data point, not a ceiling'.",
		() => {
			expect(run1.twoNeedleKitchenSink.catchRate).toBe(0);
			expect(run1.twoNeedleKitchenSink.unmatchedFindings).toBe(SHOTGUN_LOCATION_FILES.length);
			for (const id of DEFECT_CLASSES) {
				expect(run1.twoNeedleKitchenSink.perDefectClass[id], `perDefectClass["${id}"] must be false for the two-needle kitchen sink`).toBe(false);
			}
		},
	);

	it("reproducibility: two independently-built runs produce identical CalibrationResult values", () => {
		expect(run2.knownSubset).toEqual(run1.knownSubset);
		expect(run2.blind).toEqual(run1.blind);
		expect(run2.shotgun).toEqual(run1.shotgun);
		expect(run2.shotgunNameDrop).toEqual(run1.shotgunNameDrop);
		expect(run2.shotgunKitchenSink).toEqual(run1.shotgunKitchenSink);
		expect(run2.twoNeedleKitchenSink).toEqual(run1.twoNeedleKitchenSink);
	});
});

// -----------------------------------------------------------------------------
// Corpus and scorer properties, driven directly through scoreCalibration
// -----------------------------------------------------------------------------

describe("CR3C-01 -- the sixth control (a generic derivable phrase) and the false-rejection regression", () => {
	const cr3c01Expected: SeededDefectExpectation[] = SEEDED_DEFECTS.map((defect) => ({
		id: defect.id,
		locationFile: defect.expected.locationFile,
		mustMentionAny: defect.expected.mustMentionAny,
		minimumSeverity: defect.expected.minimumSeverity,
	}));

	/** A generic phrase derivable from the input alone, reused across all six files, must catch nothing. */
	const GENERIC_DERIVABLE_PHRASES = [
		"This test structurally cannot fail.", // pre-fix: 1/6 via tautological-test
		"It writes into the real developer's own home directory.", // pre-fix: 1/6 via escaped-side-effect
	];

	for (const phrase of GENERIC_DERIVABLE_PHRASES) {
		it(`SIXTH CONTROL -- "${phrase}" reused across all six files scores catchRate === 0`, () => {
			const findings = SHOTGUN_LOCATION_FILES.map((file, index) => ({
				severity: "BLOCKER" as const,
				location: `${file}:${index + 1}`,
				concreteFailure: phrase,
			}));
			const result = scoreCalibration(cr3c01Expected, findings);
			expect(result.catchRate, JSON.stringify(result.perDefectClass)).toBe(0);
		});
	}

	it("MUTATION CHECK -- the sixth control is not vacuously green: under the OLD (pre-fix) needle sets it scored non-zero", () => {
		// The old needle arrays, inlined, to show the current ones moved the number.
		const preFixExpected: SeededDefectExpectation[] = cr3c01Expected.map((e) =>
			e.id === "tautological-test"
				? { ...e, mustMentionAny: ["compares it to itself", "cannot fail", "identical to what it is compared against", "structurally cannot"] }
				: e.id === "escaped-side-effect"
					? { ...e, mustMentionAny: ["writes into the real", "outside the temp repo", "escapes the test", "developer's own home directory"] }
					: e,
		);
		const tautologicalFinding = [
			{ severity: "BLOCKER" as const, location: "src/router-wire-proof.test.ts:1", concreteFailure: GENERIC_DERIVABLE_PHRASES[0] },
		];
		const escapedFinding = [
			{ severity: "BLOCKER" as const, location: "tests/settings-persistence.test.ts:1", concreteFailure: GENERIC_DERIVABLE_PHRASES[1] },
		];
		expect(scoreCalibration(preFixExpected, tautologicalFinding).catchRate).toBeGreaterThan(0);
		expect(scoreCalibration(preFixExpected, escapedFinding).catchRate).toBeGreaterThan(0);
	});

	/**
	 * A genuine, correctly located finding that also uses the house phrase "structurally cannot fail" must still catch:
	 * a real reviewer is more likely to write it than avoid it.
	 */
	it("REGRESSION -- a genuine finding is not rejected merely for using this project's own house vocabulary", () => {
		const finding = [
			{
				severity: "BLOCKER" as const,
				location: "src/parser-mutation-claim.test.ts:3",
				concreteFailure:
					"MUTATION-VERIFIED is false: parseCommand returns true regardless of input, so the test " +
					"structurally cannot fail and the label survived its own mutation.",
			},
		];
		const result = scoreCalibration(cr3c01Expected, finding);
		expect(result.perDefectClass["false-label"], JSON.stringify(result.perDefectClass)).toBe(true);
		expect(result.caught).toBe(1);
	});

	it("MUTATION CHECK -- the regression case genuinely failed before the needle fix (not a test that was always green)", () => {
		const preFixExpected: SeededDefectExpectation[] = cr3c01Expected.map((e) =>
			e.id === "tautological-test"
				? { ...e, mustMentionAny: ["compares it to itself", "cannot fail", "identical to what it is compared against", "structurally cannot"] }
				: e,
		);
		const finding = [
			{
				severity: "BLOCKER" as const,
				location: "src/parser-mutation-claim.test.ts:3",
				concreteFailure:
					"MUTATION-VERIFIED is false: parseCommand returns true regardless of input, so the test " +
					"structurally cannot fail and the label survived its own mutation.",
			},
		];
		expect(scoreCalibration(preFixExpected, finding).perDefectClass["false-label"]).toBe(false);
	});
});

// -----------------------------------------------------------------------------
// scoreCalibration -- direct unit-level proof (no session, no runReview)
// -----------------------------------------------------------------------------

describe("scoreCalibration -- direct proof, independent of runReview", () => {
	const expected: SeededDefectExpectation[] = [
		{ id: "a", locationFile: "src/a.ts", mustMentionAny: ["needle-a"], minimumSeverity: "BLOCKER" },
		{ id: "b", locationFile: "src/b.ts", mustMentionAny: ["needle-b"], minimumSeverity: "WARNING" },
	];

	it("a matching finding at BLOCKER catches a BLOCKER-minimum expectation", () => {
		const result = scoreCalibration(expected, [
			{ severity: "BLOCKER", location: "src/a.ts:1", concreteFailure: "contains needle-a here" },
		]);
		expect(result.caught).toBe(1);
		expect(result.perDefectClass.a).toBe(true);
		expect(result.perDefectClass.b).toBe(false);
		expect(result.unmatchedFindings).toBe(0);
	});

	it("a finding below the minimum severity does not catch, and counts as unmatched", () => {
		const result = scoreCalibration(expected, [
			{ severity: "NIT", location: "src/a.ts:1", concreteFailure: "contains needle-a here" },
		]);
		expect(result.caught).toBe(0);
		expect(result.unmatchedFindings).toBe(1);
	});

	it("a finding naming the right file without the needle does not catch", () => {
		const result = scoreCalibration(expected, [
			{ severity: "BLOCKER", location: "src/a.ts:1", concreteFailure: "this looks risky, generally" },
		]);
		expect(result.caught).toBe(0);
		expect(result.unmatchedFindings).toBe(1);
	});

	it("total === 0 yields catchRate === 0, never NaN or a divide-by-zero", () => {
		const result = scoreCalibration([], []);
		expect(result.total).toBe(0);
		expect(result.catchRate).toBe(0);
		expect(result.caught).toBe(0);
	});
});
