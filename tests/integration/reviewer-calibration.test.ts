/**
 * GATE-08 — the seeded-defect calibration run, including its negative
 * controls.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE PROVES, AND IN WHAT ORDER
 * ---------------------------------------------------------------------------
 *   A. Corpus integrity — `SEEDED_DEFECTS` has exactly six entries, one per
 *      `DEFECT_CLASSES` id, importing it performs no file-system write, and
 *      EVERY fixture is invisible to the deterministic stage
 *      (`runAntiPatternRules` reports zero ERROR-tier findings against it).
 *      This last point is what makes "the model reviewer earns its cost" a
 *      MEASURED claim: if a fixture were caught deterministically, GATE-08
 *      would be measuring the wrong layer.
 *   B. Calibration — the full corpus, as ONE combined review contract, driven
 *      through `runReview` FOUR times with four differently-scripted faux
 *      reviewers: a KNOWN-SUBSET reviewer (catches exactly 3 of 6, proving
 *      `scoreCalibration` reports a real, non-trivial number), a BLIND
 *      reviewer (approves everything, zero findings — the negative control
 *      that proves the scorer can report a bad number), a SHOTGUN reviewer
 *      (twenty vague findings — the control that proves quantity does not
 *      substitute for specificity), and (WR-03) a NAME-DROPPING SHOTGUN
 *      reviewer (one finding per touched file, naming only that file's own
 *      conspicuous symbol with no defect description — the control that
 *      proves naming a symbol is not identifying a defect; before WR-03's
 *      fix this exact shape scored catchRate === 1.0 having caught nothing).
 *   C. Reproducibility — the whole calibration group is run TWICE, against
 *      two independently-built temp repos and faux sessions, and the
 *      resulting `CalibrationResult` objects are asserted identical
 *      pairwise. A catch rate that is not reproducible is not a measurement.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE COMBINED CONTRACT, NOT SIX SEPARATE runReview CALLS
 * ---------------------------------------------------------------------------
 * A real review pass reviews a change once and reports however many
 * findings it finds, covering however many of the change's defects it
 * catches (or misses). Building six defects into ONE temp repo and driving
 * ONE `runReview` call per scenario mirrors that shape — `scoreCalibration`
 * grades one reviewer pass's findings against all six expectations at once,
 * exactly as it would against a real multi-file change.
 *
 * ---------------------------------------------------------------------------
 * NO LIVE REVIEWER, NO LIVE PROVIDER CALL
 * ---------------------------------------------------------------------------
 * Every reviewer here is a scripted `fauxProvider` response, per the
 * autonomous-run rules. The numbers this file produces measure the SCORER
 * and the WIRING, never a real model's judgement — see `calibration.ts`'s
 * own "WHAT THIS DOES NOT PROVE" section. The live run is `RB-08-03`,
 * OUTSTANDING.
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
import { createFauxSession, type FauxSessionHandle } from "../helpers/session.ts";
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

/** The three defect classes the "known subset" scripted reviewer catches. Exactly 3 of 6, per the plan. */
const KNOWN_SUBSET_CAUGHT: readonly string[] = ["fabricated-evidence", "absent-guard", "false-label"];

async function waitForConfiguredAuth(
	modelRuntime: FauxSessionHandle["modelRuntime"],
	providerId: string,
	timeoutMs = 2000,
): Promise<void> {
	const start = Date.now();
	while (!modelRuntime.hasConfiguredAuth(providerId)) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`waitForConfiguredAuth: ${providerId} never reported configured auth within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

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

/** The known-subset reviewer's submit_review arguments: exactly 3 of 6 defects caught, each with a specific finding. */
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
			// WR2-05: two INDEPENDENT needles ("regardless of input" and "survived
			// its own mutation"), not one -- see calibration.ts's own
			// MIN_DISTINCT_NEEDLES docstring for why a real, thorough finding
			// naturally clears this bar while a single boilerplate phrase does not.
			concreteFailure:
				"Comment claims MUTATION-VERIFIED but parseCommand always returns true regardless of input, " +
				"meaning the label survived its own mutation.",
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
 * The shotgun reviewer's submit_review arguments: twenty generic findings.
 *
 * Deliberately cycles through the SIX REAL touched files (`locationFile` of
 * every seeded defect) rather than an unrelated path — a vague finding that
 * also names the wrong file would pass this corpus's scorer for the wrong
 * reason (location mismatch, not vagueness), which would make the "vagueness
 * does not score" claim untested. With `location` genuinely correct, only
 * the ABSENCE of any `mustMentionAny` needle in `concreteFailure` is what
 * must keep these findings from catching anything — exactly the property
 * Falsification F1 (see this plan's SUMMARY) proves is load-bearing by
 * dropping the `mustMentionAny` check and watching this case turn red.
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
 * WR-03 -- THE NAME-DROPPING SHOTGUN, a THIRD control.
 *
 * This is the EXACT mutation the code review used to prove the pre-fix
 * matcher was gameable: instead of `SHOTGUN_REVIEWER_ARGS`'s uniformly vague
 * `concreteFailure`, each finding here names the touched file's own most
 * conspicuous SYMBOL (the same six identifiers the pre-fix `mustMentionAny`
 * arrays used verbatim: `markMigrationComplete`, `configuredHead`,
 * `homedir()`, `isGuardedCommand`, `isWithinRateLimit`, `MUTATION-VERIFIED`)
 * with no description of what is actually WRONG with it -- "X could use a
 * closer look" identifies nothing. Five of six fixture files contain exactly
 * one function, so naming "the file's only function" is trivially derivable
 * from the input alone, without having understood the defect. Before WR-03's
 * fix (bare-symbol needles), this control scored `catchRate === 1.0` --
 * 6/6 -- having caught nothing. After the fix (behavior-describing needles),
 * it must score `catchRate === 0`, proving the matcher now requires
 * identifying the DEFECT, not merely the symbol.
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
 * WR2-05 (`08-REVIEW.md` iteration 2) -- THE BOILERPLATE KITCHEN SINK, a
 * FOURTH permanent control.
 *
 * One BLOCKER per touched file, correct `location`, and ONE boilerplate
 * `concreteFailure` reused VERBATIM for all six -- deliberately crafted so
 * that each of the six defect classes' `mustMentionAny` set has EXACTLY one
 * matching phrase inside it (`fabricated-evidence` <- "performs none";
 * `tautological-test` <- "cannot fail"; `escaped-side-effect` <- "writes
 * into the real"; `absent-guard` <- "never calls isGuardedCommand";
 * `symptomatic-fix` <- "always returns true"; `false-label` <- "regardless
 * of input"). Before WR2-05's `MIN_DISTINCT_NEEDLES` fix
 * (`calibration.ts`), this single boilerplate sentence scored
 * `catchRate === 1.0` -- 6/6 -- having identified zero actual defects; it is
 * NOT derivable from the input the way WR-03's name-drop control is
 * (constructing it requires the ANSWER KEY, i.e. reading this corpus's own
 * `mustMentionAny` arrays), which is why it was a Warning and not a repeat
 * Critical, but it is strictly more dangerous than the name-drop control:
 * it looks like genuine analysis prose, not a bare symbol name. After the
 * fix, it must score `catchRate === 0`, proving the matcher now requires
 * TWO independent needles, not merely one boilerplate phrase reused six
 * times.
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
 * WR3-01 (`08-REVIEW.md` iteration 3) -- THE TWO-NEEDLE KITCHEN SINK, a
 * FIFTH permanent control.
 *
 * Raising `MIN_DISTINCT_NEEDLES` to 2 (WR2-05) only raised the exploit's
 * price, it did not close it: one boilerplate sentence, reused verbatim as
 * the `concreteFailure` of a finding for every one of the six touched
 * files, engineered to contain exactly TWO matching phrases per defect
 * class (constructing it still requires the corpus's own answer key, same
 * as WR2-05's control), scored `catchRate === 1.0` -- 6/6 -- having
 * identified zero actual defects, because the needles within each defect
 * class's own `mustMentionAny` set are near-synonyms, not independent
 * facts ("cannot fail" / "structurally cannot", "performs none" / "no
 * actual verification", "always returns true" / "unconditionally true",
 * "writes into the real" / "escapes the test"). `findingCatches` now also
 * rejects a finding whose text independently clears a DIFFERENT, unrelated
 * expectation's own needle bar -- which this sentence, by construction,
 * does for every one of the other five classes simultaneously, however
 * many of ITS OWN class's needles it also carries. After that fix, this
 * control must score `catchRate === 0`.
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

/**
 * Builds a fresh temp repo + faux session, drives the combined corpus through
 * `runReview` SIX times (known-subset, blind, shotgun, WR-03's name-dropping
 * shotgun, WR2-05's boilerplate kitchen sink, WR3-01's two-needle kitchen
 * sink), and scores each result against the corpus's own expectations. A
 * fresh session per call is what makes the reproducibility check in group C
 * meaningful -- two INDEPENDENT builds, not one build read twice.
 */
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
					id: "deepseek-v4-flash",
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

	it("known-subset: caught === 3, total === 6, catchRate === 0.5, exactly the three scripted classes true", () => {
		expect(run1.knownSubset.caught).toBe(3);
		expect(run1.knownSubset.total).toBe(6);
		expect(run1.knownSubset.catchRate).toBe(0.5);
		for (const id of DEFECT_CLASSES) {
			expect(run1.knownSubset.perDefectClass[id], `perDefectClass["${id}"]`).toBe(KNOWN_SUBSET_CAUGHT.includes(id));
		}
	});

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
