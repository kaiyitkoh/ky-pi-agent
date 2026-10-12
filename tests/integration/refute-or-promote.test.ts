/**
 * GATE-06 / QUAL-05 — both refutation outcomes, the BLOCKER-only scope, the
 * fail-safe direction, the QUAL-05 stop, and the bounded loop's stall
 * detection, each proved by a case that would fail if the mechanism under
 * test were removed.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE SHARED FAUX PROVIDER, RESPONSES CONSUMED IN A FIXED ORDER
 * ---------------------------------------------------------------------------
 * Mirrors `tests/integration/reviewer-contract.test.ts`'s own house style: one
 * `deepseekFaux` provider, one scripted `setResponses` array consumed in the
 * EXACT order the cases below call `runRefuteOrPromote`/`runBoundedReviewLoop`
 * (case 1, case 2, case 3, case 4a, case 4b, case 6's two iterations — seven
 * calls total). `deepseekFaux.state.callCount` is therefore a running total
 * across the whole file, so every call-count assertion below reads a DELTA
 * (before/after around the specific call under test), never the raw total —
 * the same discipline `advisor-consult.test.ts` and `reviewer-contract.test.ts`
 * both already use for this exact reason.
 *
 * ---------------------------------------------------------------------------
 * WHY `decideWorkflowStop` IS TESTED AGAINST HAND-BUILT ARTIFACTS, NOT
 * `validateReview`'s OUTPUT
 * ---------------------------------------------------------------------------
 * `decideWorkflowStop` and `detectStall` are PURE — their contract is "given
 * this `ReviewArtifact` shape, decide". Whether that shape came from a real
 * reviewer's validated tool call (`review-schema.ts`'s `validateReview`, plan
 * 08-03) or a hand-built fixture makes no difference to the predicate; using
 * hand-built fixtures here keeps this file's REFUTATION proof and its STOP-
 * PREDICATE proof independently readable, matching the module-under-test's
 * own PURE/IMPURE split.
 */
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";

import { beforeAll, describe, expect, it } from "vitest";

import {
	decideWorkflowStop,
	MAX_REVIEW_ITERATIONS,
	runBoundedReviewLoop,
	runRefuteOrPromote,
	type BoundedReviewLoopResult,
	type RefuteOrPromoteResult,
} from "../../.pi/extensions/quality/verdict.ts";
import type { ReviewArtifact, ReviewFinding } from "../../.pi/extensions/quality/review-schema.ts";
import type { ReviewerContractInput } from "../../.pi/extensions/quality/reviewer.ts";
import { getModeState, setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";
import { createFauxSession, type FauxSessionHandle } from "../helpers/session.ts";

// -----------------------------------------------------------------------------
// Fixture builders — plain data, no model involved.
// -----------------------------------------------------------------------------

const MINIMAL_CONTRACT: ReviewerContractInput = {
	diff: "--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\n-old\n+new\n",
	touchedFiles: [{ path: "src/x.ts", contents: "export const x = 1;\n" }],
	gateReport: "typecheck: PASS\nlint: PASS",
	requirements: [{ id: "GATE-06", text: "A BLOCKER cannot stop work until it has survived one refutation pass." }],
	filesTouchedUnion: ["src/x.ts"],
	importGraph: [{ from: "src/x.ts", to: [] }],
};

function blockerFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
	return {
		severity: "BLOCKER",
		location: "src/x.ts:10",
		concreteFailure: "off-by-one error in the loop bound",
		suggestedFix: "use < instead of <=",
		...overrides,
	};
}

function warningFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
	return {
		severity: "WARNING",
		location: "src/x.ts:20",
		concreteFailure: "no test covers this branch",
		suggestedFix: "add a case for the empty-input path",
		...overrides,
	};
}

function nitFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
	return {
		severity: "NIT",
		location: "src/x.ts:30",
		concreteFailure: "inconsistent variable naming",
		suggestedFix: "rename to match the surrounding style",
		...overrides,
	};
}

function reviewWithFindings(findings: readonly ReviewFinding[], overrides: Partial<ReviewArtifact> = {}): ReviewArtifact {
	return {
		verdicts: [],
		findings,
		checkedAndCleared: "Checked the surrounding logic end to end.",
		classification: "root-cause",
		classificationJustification: "Fixes the actual defect, not a symptom of it.",
		...overrides,
	};
}

/** The same post-refutation reconstruction `runBoundedReviewLoop` uses internally — replicated here for cases that call `runRefuteOrPromote` directly. */
function reviewAfterRefutation(review: ReviewArtifact, promoted: readonly ReviewFinding[]): ReviewArtifact {
	const nonBlockers = review.findings.filter((finding) => finding.severity !== "BLOCKER");
	return { ...review, findings: [...nonBlockers, ...promoted] };
}

// -----------------------------------------------------------------------------
// Session/faux plumbing — mirrors tests/integration/reviewer-contract.test.ts
// and tests/integration/advisor-consult.test.ts.
// -----------------------------------------------------------------------------

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

interface Run {
	// case 1
	withdrawnResult: RefuteOrPromoteResult;
	withdrawnPostRefutationStop: ReturnType<typeof decideWorkflowStop>;
	// case 2
	upheldResult: RefuteOrPromoteResult;
	upheldPostRefutationStop: ReturnType<typeof decideWorkflowStop>;
	// case 3
	scopeCallDelta: number;
	// case 4
	failSafeNoToolCallResult: RefuteOrPromoteResult;
	failSafeInvalidEnumResult: RefuteOrPromoteResult;
	// case 5 (pure — recorded here only to prove zero provider calls around it)
	qual05CallDelta: number;
	symptomaticZeroFindingsStop: ReturnType<typeof decideWorkflowStop>;
	workaroundStop: ReturnType<typeof decideWorkflowStop>;
	rootCauseWarningsOnlyStop: ReturnType<typeof decideWorkflowStop>;
	// case 6
	boundedResult: BoundedReviewLoopResult;
	boundedCallDelta: number;
}

async function runFixture(): Promise<Run> {
	// Deterministic starting state — STATE-SLOT HAZARD, modes.ts's own docstring.
	setMode("cheap");
	setEscalated(false);
	expect(getModeState().mode, "test setup did not reset the mode slot to cheap").toBe("cheap");

	const handle = await createFauxSession({
		responses: [fauxAssistantMessage("warm", { stopReason: "stop" })],
	});

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

		// Consumed in the EXACT call order the cases below run in — see this
		// file's own header for why.
		deepseekFaux.setResponses([
			// 1 — case 1: WITHDRAWN.
			() =>
				fauxAssistantMessage(
					fauxToolCall("refute_finding", {
						outcome: "withdrawn",
						rationale: "Re-reading the loop bound: the array is 0-indexed and the bound is exclusive, so no off-by-one occurs.",
					}),
					{ stopReason: "toolUse" },
				),
			// 2 — case 2: UPHELD.
			() =>
				fauxAssistantMessage(
					fauxToolCall("refute_finding", {
						outcome: "upheld",
						rationale: "The recursion genuinely has no base case for a negative input.",
					}),
					{ stopReason: "toolUse" },
				),
			// 3 — case 3: SCOPE. Content is irrelevant; only the call COUNT matters.
			() =>
				fauxAssistantMessage(fauxToolCall("refute_finding", { outcome: "upheld", rationale: "Still holds." }), {
					stopReason: "toolUse",
				}),
			// 4 — case 4a: FAIL-SAFE, no tool call at all.
			() => fauxAssistantMessage("I looked again and I think it is fine.", { stopReason: "stop" }),
			// 5 — case 4b: FAIL-SAFE, an outcome value outside the two-member enum.
			() =>
				fauxAssistantMessage(
					fauxToolCall("refute_finding", { outcome: "maybe", rationale: "Not sure either way." }),
					{ stopReason: "toolUse" },
				),
			// 6 — case 6, iteration 1: upheld.
			() =>
				fauxAssistantMessage(
					fauxToolCall("refute_finding", { outcome: "upheld", rationale: "Still fails the same way." }),
					{ stopReason: "toolUse" },
				),
			// 7 — case 6, iteration 2: upheld again, IDENTICAL rationale/outcome —
			// this is what drives the stall.
			() =>
				fauxAssistantMessage(
					fauxToolCall("refute_finding", { outcome: "upheld", rationale: "Still fails the same way." }),
					{ stopReason: "toolUse" },
				),
		]);

		handle.modelRuntime.registerNativeProvider(deepseekFaux.provider);
		await handle.modelRuntime.setRuntimeApiKey("deepseek", "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, "deepseek");

		await handle.session.prompt("warm up");
		const ctx = handle.session.extensionRunner.createCommandContext();

		// ---- case 1: WITHDRAWN ------------------------------------------------
		const withdrawnReview = reviewWithFindings([blockerFinding({ location: "src/a.ts:10" })]);
		const withdrawnResult = await runRefuteOrPromote(ctx, withdrawnReview, MINIMAL_CONTRACT);
		const withdrawnPostRefutationStop = decideWorkflowStop(
			reviewAfterRefutation(withdrawnReview, withdrawnResult.promoted),
		);

		// ---- case 2: UPHELD -----------------------------------------------------
		const upheldReview = reviewWithFindings([blockerFinding({ location: "src/b.ts:20", concreteFailure: "unbounded recursion" })]);
		const upheldResult = await runRefuteOrPromote(ctx, upheldReview, MINIMAL_CONTRACT);
		const upheldPostRefutationStop = decideWorkflowStop(reviewAfterRefutation(upheldReview, upheldResult.promoted));

		// ---- case 3: SCOPE — 1 BLOCKER, 3 WARNINGs, 2 NITs -> exactly 1 call ----
		const scopeReview = reviewWithFindings([
			blockerFinding({ location: "src/c.ts:1" }),
			warningFinding({ location: "src/c.ts:2" }),
			warningFinding({ location: "src/c.ts:3" }),
			warningFinding({ location: "src/c.ts:4" }),
			nitFinding({ location: "src/c.ts:5" }),
			nitFinding({ location: "src/c.ts:6" }),
		]);
		const scopeCallBefore = deepseekFaux.state.callCount;
		await runRefuteOrPromote(ctx, scopeReview, MINIMAL_CONTRACT);
		const scopeCallDelta = deepseekFaux.state.callCount - scopeCallBefore;

		// ---- case 4a: FAIL-SAFE, no tool call at all ----------------------------
		const failSafeReviewA = reviewWithFindings([blockerFinding({ location: "src/d.ts:1" })]);
		const failSafeNoToolCallResult = await runRefuteOrPromote(ctx, failSafeReviewA, MINIMAL_CONTRACT);

		// ---- case 4b: FAIL-SAFE, outcome outside the enum -----------------------
		const failSafeReviewB = reviewWithFindings([blockerFinding({ location: "src/e.ts:1" })]);
		const failSafeInvalidEnumResult = await runRefuteOrPromote(ctx, failSafeReviewB, MINIMAL_CONTRACT);

		// ---- case 5: QUAL-05, pure — zero provider calls ------------------------
		const qual05CallBefore = deepseekFaux.state.callCount;
		const symptomaticZeroFindingsStop = decideWorkflowStop(
			reviewWithFindings([], {
				classification: "symptomatic",
				classificationJustification: "This patches the timeout value without touching the query that actually times out.",
			}),
		);
		const workaroundStop = decideWorkflowStop(
			reviewWithFindings([], {
				classification: "workaround",
				classificationJustification: "A real fix needs a schema migration that cannot land before the release cutoff.",
				properFix: "Rewrite the query to use a covering index instead of a full scan.",
				deferralReason: "No migration window remains before the release cutoff.",
			}),
		);
		const rootCauseWarningsOnlyStop = decideWorkflowStop(
			reviewWithFindings([warningFinding(), nitFinding()], {
				classification: "root-cause",
				classificationJustification: "This is a genuine fix; the remaining findings are minor.",
			}),
		);
		const qual05CallDelta = deepseekFaux.state.callCount - qual05CallBefore;

		// ---- case 6: BOUND and STALL --------------------------------------------
		const boundedCallBefore = deepseekFaux.state.callCount;
		const boundedResult = await runBoundedReviewLoop(ctx, {
			contract: MINIMAL_CONTRACT,
			// The SAME finding set on every call — this is what drives the stall.
			review: async () => reviewWithFindings([blockerFinding({ location: "src/loop.ts:1", concreteFailure: "same failure every time" })]),
		});
		const boundedCallDelta = deepseekFaux.state.callCount - boundedCallBefore;

		return {
			withdrawnResult,
			withdrawnPostRefutationStop,
			upheldResult,
			upheldPostRefutationStop,
			scopeCallDelta,
			failSafeNoToolCallResult,
			failSafeInvalidEnumResult,
			qual05CallDelta,
			symptomaticZeroFindingsStop,
			workaroundStop,
			rootCauseWarningsOnlyStop,
			boundedResult,
			boundedCallDelta,
		};
	} finally {
		setMode("cheap");
		setEscalated(false);
		await handle.dispose();
	}
}

let run: Run;

describe("GATE-06 / QUAL-05 — refute-or-promote, the bounded loop, and the pure stop predicate", () => {
	beforeAll(async () => {
		run = await runFixture();
	}, 60_000);

	it("case 1 — WITHDRAWN: the BLOCKER is recorded in withdrawn with its rationale, absent from promoted, and the post-refutation review does not stop", () => {
		expect(run.withdrawnResult.promoted.length, "the withdrawn BLOCKER also appears in promoted").toBe(0);
		expect(
			run.withdrawnResult.withdrawn.length,
			"no withdrawal was recorded at all — a silently dropped BLOCKER is indistinguishable from one the " +
				"reviewer never found, which is the exact failure this pass exists to make visible",
		).toBe(1);

		const withdrawal = run.withdrawnResult.withdrawn[0];
		expect(withdrawal?.finding.location).toBe("src/a.ts:10");
		expect(
			withdrawal?.rationale,
			"the withdrawal was recorded with no rationale — a withdrawal without a rationale is as unaccountable " +
				"as no record at all",
		).toContain("0-indexed");

		expect(run.withdrawnPostRefutationStop).toEqual({ stop: false });
	});

	it("case 2 — UPHELD: the BLOCKER is recorded in promoted, and the post-refutation review stops naming its location", () => {
		expect(run.upheldResult.withdrawn.length, "an upheld BLOCKER was recorded as withdrawn").toBe(0);
		expect(run.upheldResult.promoted.length, "the upheld BLOCKER did not survive into promoted").toBe(1);
		expect(run.upheldResult.promoted[0]?.location).toBe("src/b.ts:20");

		expect(run.upheldPostRefutationStop.stop, "decideWorkflowStop did not stop for a review with a surviving BLOCKER").toBe(true);
		if (run.upheldPostRefutationStop.stop) {
			expect(run.upheldPostRefutationStop.needsApproval, "a BLOCKER-driven stop reported needsApproval:true").toBe(false);
			expect(run.upheldPostRefutationStop.reason).toContain("src/b.ts:20");
		}
	});

	it("case 3 — SCOPE: exactly ONE provider call for a review with 1 BLOCKER, 3 WARNINGs, and 2 NITs", () => {
		expect(
			run.scopeCallDelta,
			"runRefuteOrPromote made a number of provider calls other than exactly 1 against a 6-finding review " +
				"with only 1 BLOCKER — this is the assertion that proves the pass is BLOCKER-only; a count-based " +
				"assertion is the only one that catches a widened scope",
		).toBe(1);
	});

	it("case 4 — FAIL-SAFE: no tool call, and an out-of-enum outcome, BOTH resolve to UPHELD", () => {
		expect(
			run.failSafeNoToolCallResult.promoted.length,
			"a response with no refute_finding tool call at all did not stay UPHELD",
		).toBe(1);
		expect(run.failSafeNoToolCallResult.withdrawn.length).toBe(0);

		expect(
			run.failSafeInvalidEnumResult.promoted.length,
			'a response whose outcome ("maybe") is outside the two-member enum did not stay UPHELD',
		).toBe(1);
		expect(run.failSafeInvalidEnumResult.withdrawn.length).toBe(0);
	});

	it("case 5 — QUAL-05: decideWorkflowStop over symptomatic/workaround/root-cause, with ZERO provider calls", () => {
		// The pure half: asserted first, per this module's own house rule that a
		// zero-call assertion precedes any content assertion.
		expect(
			run.qual05CallDelta,
			"a provider call was made around the pure decideWorkflowStop calls — the stop predicate must not " +
				"reach a model at all",
		).toBe(0);

		// (a) symptomatic, ZERO findings — the case a BLOCKER-only stop would miss.
		expect(run.symptomaticZeroFindingsStop.stop, "a symptomatic classification with no findings did not stop").toBe(true);
		if (run.symptomaticZeroFindingsStop.stop) {
			expect(run.symptomaticZeroFindingsStop.needsApproval).toBe(true);
			expect(run.symptomaticZeroFindingsStop.reason).toContain("symptomatic");
		}

		// (b) workaround — reason names BOTH properFix and deferralReason.
		expect(run.workaroundStop.stop, "a workaround classification did not stop").toBe(true);
		if (run.workaroundStop.stop) {
			expect(run.workaroundStop.needsApproval).toBe(true);
			expect(run.workaroundStop.reason).toContain("Rewrite the query to use a covering index instead of a full scan.");
			expect(run.workaroundStop.reason).toContain("No migration window remains before the release cutoff.");
		}

		// (c) root-cause, only WARNING/NIT — does not stop.
		expect(run.rootCauseWarningsOnlyStop).toEqual({ stop: false });
	});

	it("case 6 — BOUND and STALL: the same finding set every iteration terminates as stalled, bounded by MAX_REVIEW_ITERATIONS", () => {
		expect(
			run.boundedCallDelta,
			"runBoundedReviewLoop made no provider calls at all — nothing was actually exercised",
		).toBeGreaterThan(0);
		expect(
			run.boundedCallDelta,
			`runBoundedReviewLoop made ${run.boundedCallDelta} provider calls, more than MAX_REVIEW_ITERATIONS ` +
				`(${MAX_REVIEW_ITERATIONS}) — a loop that terminates without a bounded call count has not actually ` +
				"terminated by POLICY, whatever its outcome reads",
		).toBeLessThanOrEqual(MAX_REVIEW_ITERATIONS);

		expect(run.boundedResult.outcome, "an identical finding set on every iteration did not terminate as stalled").toBe("stalled");
		expect(run.boundedResult.iterations, "runBoundedReviewLoop exceeded its own MAX_REVIEW_ITERATIONS bound").toBeLessThanOrEqual(
			MAX_REVIEW_ITERATIONS,
		);
	});
});
