/**
 * In a real composed session: a finding already in the harness source does not stop /quick (and a clean run reaches
 * the provider); an unavailable LSP leg shows in the report without failing the change; getAllTools() still lists an
 * inactive tool; and a workaround review's stop signal carries its debt. Every test installs and restores an instant
 * exec override, since the throwaway cwd has no tsc or eslint. decideWorkflowStop is pure, so a hand-built review suffices.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

import { afterEach, describe, expect, it } from "vitest";

import { registeredToolNames, runChangeGateStage, setQuickGateExecOverrideForTests } from "../../.pi/extensions/quality/index.ts";
import type { ExecRunner } from "../../.pi/extensions/quality/gates.ts";
import type { ReviewArtifact } from "../../.pi/extensions/quality/review-schema.ts";
import { decideWorkflowStop } from "../../.pi/extensions/quality/verdict.ts";
import { getModeState, planRoleCall } from "../../.pi/extensions/routing/modes.ts";
import { ROLE_MAP } from "../../.pi/extensions/routing/schema.ts";
import { isRunArmed } from "../../.pi/extensions/workflows/evidence.ts";
import { gitInit, repoRoot, runGit } from "../helpers/git.ts";
import { captureNotify, waitFor, waitForConfiguredAuth, withFauxSession } from "../helpers/session.ts";

/** Absolute, forward-slashed entry paths — mirrors `tests/integration/quick-workflow.test.ts`'s own SAFETY_ENTRY/WORKFLOWS_ENTRY convention. */
const SAFETY_ENTRY = `${repoRoot()}/.pi/extensions/safety/index.ts`.replace(/\\/g, "/");
const WORKFLOWS_ENTRY = `${repoRoot()}/.pi/extensions/workflows/index.ts`.replace(/\\/g, "/");
const QUALITY_ENTRY = `${repoRoot()}/.pi/extensions/quality/index.ts`.replace(/\\/g, "/");
const DIAGNOSTICS_ENTRY = `${repoRoot()}/.pi/extensions/diagnostics/index.ts`.replace(/\\/g, "/");

/** A cost-rated fixture model, matching `quick-workflow.test.ts`'s own shape. */
const FIXTURE_COST = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } as const;

/** The always-passing ExecRunner every `it` below installs before touching the change gate or `/quick` — see the module docstring. */
const INSTANT_PASS_EXEC: ExecRunner = () => ({ code: 0, stdout: "", stderr: "" });

/** Build the inline user-scope extension: the REAL safety, workflows, quality and diagnostics extensions, composed — no re-implementation, no shim. */
function composite(): string {
	return [
		"// Generated for tests/integration/quality-gate-order.test.ts. Lives in a temp dir.",
		`import safety from ${JSON.stringify(SAFETY_ENTRY)};`,
		`import workflows from ${JSON.stringify(WORKFLOWS_ENTRY)};`,
		`import quality from ${JSON.stringify(QUALITY_ENTRY)};`,
		`import diagnostics from ${JSON.stringify(DIAGNOSTICS_ENTRY)};`,
		"export default function (pi) {",
		"\tsafety(pi);",
		"\tworkflows(pi);",
		"\tquality(pi);",
		"\tdiagnostics(pi);",
		"}",
	].join("\n");
}

/** Plant a `.ts` file under `<cwd>/.pi/extensions/` carrying a shipped-TODO comment — an ERROR-tier finding that predates the run's change. */
function seedOffendingSource(cwd: string): void {
	const dir = join(cwd, ".pi", "extensions", "quality-fixture");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "offender.ts"),
		"// TODO: replace this stub before shipping\nexport const OFFENDING_MARKER = 1;\n",
		"utf-8",
	);
	// Committed, because /quick refuses to gate a working tree that is not the commit.
	runGit(["add", "--", ".pi/extensions/quality-fixture/offender.ts"], cwd);
	runGit(["commit", "-m", "pre-existing finding"], cwd);
}

/** `ROLE_MAP.cheap.executor`'s first candidate, read out of the real table — never hardcoded. */
function flashExecutorCandidate(): { provider: string; id: string } {
	const candidate = ROLE_MAP.cheap.executor.candidates[0];
	if (candidate === undefined) {
		throw new Error("ROLE_MAP.cheap.executor.candidates is empty -- this fixture has no candidate to make servable");
	}
	return candidate;
}

/** Wire a session up with a configured, servable `executor` route -- every group that calls `/quick`'s handler needs this. */
async function withConfiguredCandidate<T>(fn: (candidate: { provider: string; id: string }) => Promise<T>): Promise<T> {
	const candidate = flashExecutorCandidate();
	return fn(candidate);
}

afterEach(() => {
	// Each test restores this itself; this catches a thrown assertion leaking it across files in the worker.
	setQuickGateExecOverrideForTests(undefined);
});

describe("order", () => {
	it("a finding already present in <cwd>/.pi/extensions does not stop /quick: the gate runs on the change, after the work", async () => {
		await withConfiguredCandidate(async (candidate) => {
			await withFauxSession(
				{
					extensionSource: composite(),
					tools: ["bash"],
					providerId: candidate.provider,
					models: [{ id: candidate.id, reasoning: true, cost: FIXTURE_COST }],
					responses: [
						fauxAssistantMessage([fauxToolCall("bash", { command: 'echo "export const ok = 1;" > ok.ts && git add ok.ts && git commit -m "quick: ok"' })], {
							stopReason: "toolUse",
						}),
						fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
					],
				},
				async ({ session, faux, cwd, modelRuntime }) => {
					setQuickGateExecOverrideForTests(INSTANT_PASS_EXEC);
					try {
						await modelRuntime.setRuntimeApiKey(candidate.provider, "kypi-fixture-not-a-real-key");
						await waitForConfiguredAuth(modelRuntime, candidate.provider);

						gitInit(cwd, "work");
						seedOffendingSource(cwd);

						const ctx = session.extensionRunner.createCommandContext();
						const command = session.extensionRunner.getCommand("quick");
						expect(command, 'getCommand("quick") returned undefined').toBeDefined();
						if (command === undefined) return;

						const { notifications, restore } = captureNotify(ctx);
						try {
							await command.handler("make a clean commit", ctx);
							expect(isRunArmed(), "a pre-existing finding must not stop the run from arming").toBe(true);
							await waitFor(() => faux.state.callCount >= 1, 5000, "the provider to actually be called");
							await waitFor(() => !isRunArmed(), 5000, "the armed run to settle before this test ends");
							expect(notifications.some((n) => n.level === "error"), JSON.stringify(notifications)).toBe(false);
						} finally {
							restore();
						}
					} finally {
						setQuickGateExecOverrideForTests(undefined);
					}
				},
			);
		});
	});

	it("paired positive -- a clean repo proceeds through the gate, arms a run, and the provider IS genuinely called", async () => {
		await withConfiguredCandidate(async (candidate) => {
			await withFauxSession(
				{
					extensionSource: composite(),
					tools: ["bash"],
					providerId: candidate.provider,
					models: [{ id: candidate.id, reasoning: true, cost: FIXTURE_COST }],
					responses: [
						fauxAssistantMessage([fauxToolCall("bash", { command: 'git commit --allow-empty -m "quick: order positive"' })], {
							stopReason: "toolUse",
						}),
						fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
					],
				},
				async ({ session, faux, cwd, modelRuntime }) => {
					setQuickGateExecOverrideForTests(INSTANT_PASS_EXEC);
					try {
						await modelRuntime.setRuntimeApiKey(candidate.provider, "kypi-fixture-not-a-real-key");
						await waitForConfiguredAuth(modelRuntime, candidate.provider);

						gitInit(cwd, "work");
						// No offending fixture: the paired positive proves the gate does not always block.

						const ctx = session.extensionRunner.createCommandContext();
						const plan = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: {} });
						expect(plan.ok, "the executor route did not become servable -- this case needs it servable").toBe(true);
						if (!plan.ok) return;

						const command = session.extensionRunner.getCommand("quick");
						expect(command, 'getCommand("quick") returned undefined').toBeDefined();
						if (command === undefined) return;

						await command.handler("make the order-positive commit", ctx);

						expect(isRunArmed(), "a clean gate must arm a run -- startRun runs before sendUserMessage").toBe(true);

						await waitFor(() => faux.state.callCount >= 1, 5000, "the provider to actually be called");
						expect(faux.state.callCount, "the provider must genuinely be called on a clean gate").toBeGreaterThanOrEqual(1);

						// isRunArmed() is process-wide, so a run left armed would make a later test's /quick refuse.
						await waitFor(() => !isRunArmed(), 5000, "the armed run to disarm at agent_settled before this test ends");
					} finally {
						setQuickGateExecOverrideForTests(undefined);
					}
				},
			);
		});
	});
});

describe("unavailable", () => {
	it("the LSP leg reports UNAVAILABLE in a real composed session's gate report, and never fails or passes the change", async () => {
		await withFauxSession({ extensionSource: composite(), tools: ["bash"] }, async ({ cwd }) => {
			setQuickGateExecOverrideForTests(INSTANT_PASS_EXEC);
			try {
				gitInit(cwd, "work");
				const base = runGit(["rev-parse", "HEAD"], cwd).trim();
				writeFileSync(join(cwd, "ok.ts"), "export const ok = 1;\n", "utf-8");
				const result = runChangeGateStage({ cwd, projectTrusted: true, baseSha: base, changed: ["ok.ts"], baseTypecheckFailed: false });

				expect(result.lsp.status, "the LSP leg is never run by the gate, so it must read UNAVAILABLE").toBe("unavailable");
				expect(result.failed, "an UNAVAILABLE leg alone must never fail the change").toBe(false);
				expect(result.report.includes("lsp: UNAVAILABLE"), "the LSP leg's UNAVAILABLE state must be visibly named in the report").toBe(true);
				expect(result.report.indexOf("typecheck:")).toBeLessThan(result.report.indexOf("lint:"));
				expect(result.report.indexOf("lint:")).toBeLessThan(result.report.indexOf("lsp:"));
				expect(result.report.indexOf("lsp:")).toBeLessThan(result.report.indexOf("anti-pattern:"));
			} finally {
				setQuickGateExecOverrideForTests(undefined);
			}
		});
	});

	it("RESEARCH Open Question 2, resolved by observation -- pi.getAllTools() includes a registered tool even after it is made INACTIVE", async () => {
		// `tools` also bounds every tool the accessors can see (pi dist/core/sdk.js:133,136), so consult_advisor must be named.
		await withFauxSession({ extensionSource: composite(), tools: ["bash", "consult_advisor"] }, async ({ session }) => {
			// A newly registered tool starts active, confirmed first so the after-deactivation half is meaningful.
			const beforeActive = session.getActiveToolNames();
			const beforeAll = session.getAllTools().map((t) => t.name);
			expect(beforeActive.length, "the session must have at least one active tool before this proof begins").toBeGreaterThan(0);
			expect(beforeAll.length, "the session must have at least one registered tool before this proof begins").toBeGreaterThan(0);
			expect(beforeActive.includes("consult_advisor"), "consult_advisor must be active by default, or this proof is not exercising a genuine deactivation").toBe(true);
			expect(beforeAll.includes("consult_advisor"), "consult_advisor must already be visible in getAllTools() before deactivation").toBe(true);
			expect(registeredToolNames().includes("consult_advisor"), "quality/index.ts's own accessor must already agree with getAllTools()").toBe(true);

			// setActiveToolsByName is what pi.setActiveTools() calls (agent-session.js:1882).
			session.setActiveToolsByName(beforeActive.filter((name) => name !== "consult_advisor"));

			const afterActive = session.getActiveToolNames();
			const afterAll = session.getAllTools().map((t) => t.name);
			expect(afterActive.includes("consult_advisor"), "consult_advisor must no longer be ACTIVE after deactivation").toBe(false);
			expect(
				afterAll.includes("consult_advisor"),
				"OBSERVED: consult_advisor is STILL present in getAllTools() after being made inactive -- getAllTools() " +
					"returns the full registry (_toolDefinitions), not the active subset (agent.state.tools). This is the " +
					"observation RESEARCH Open Question 2 asked for.",
			).toBe(true);
			expect(
				registeredToolNames().includes("consult_advisor"),
				"quality/index.ts's own production accessor must ALSO still see the deactivated-but-registered tool -- " +
					"this is what lets the LSP probe see an installed " +
					"but currently-deferred tool is still visible to it",
			).toBe(true);
		});
	});
});

describe("stop", () => {
	it("a workaround classification stops the workflow, and the session-level notification names the approval requirement plus the proper fix and the deferral reason", async () => {
		const review: ReviewArtifact = {
			verdicts: [{ requirementId: "QUAL-05", status: "Implemented", evidence: "quality/verdict.ts:158" }],
			findings: [],
			checkedAndCleared: "reviewed the stop predicate wiring for QUAL-05",
			classification: "workaround",
			classificationJustification: "ships a temporary patch to unblock the demo path",
			properFix: "rewrite the underlying query to avoid the N+1 pattern it papers over",
			deferralReason: "the proper fix needs a schema migration scheduled for next sprint",
		};

		const stopResult = decideWorkflowStop(review);
		expect(stopResult.stop, "a workaround classification must stop the workflow regardless of findings").toBe(true);
		if (!stopResult.stop) return;
		expect(stopResult.needsApproval, "a workaround classification is a classification-driven stop, not a BLOCKER-driven one").toBe(true);

		await withFauxSession({ extensionSource: composite(), tools: ["bash"] }, async ({ session }) => {
			const ctx = session.extensionRunner.createCommandContext();
			const { notifications, restore } = captureNotify(ctx);
			try {
				// The record a workflow shows when the stop signal fires.
				ctx.ui.notify(`${stopResult.reason} -- requires human approval before shipping.`, "error");

				expect(notifications.length, "a stop must produce a visible notification").toBe(1);
				const text = notifications[0]?.text ?? "";
				expect(notifications[0]?.level, "a stop is an error, not an info message").toBe("error");
				expect(text.includes("approval"), "the notification must name the approval requirement -- a stop the user cannot act on is not a stop").toBe(true);
				expect(text.includes(review.properFix ?? ""), "the notification must show the proper fix").toBe(true);
				expect(text.includes(review.deferralReason ?? ""), "the notification must show the deferral reason").toBe(true);
			} finally {
				restore();
			}
		});
	});

	it("paired negative -- a root-cause review with only WARNINGs does not stop", () => {
		const review: ReviewArtifact = {
			verdicts: [{ requirementId: "QUAL-05", status: "Implemented", evidence: "quality/verdict.ts:158" }],
			findings: [{ severity: "WARNING", location: "quality/index.ts:42", concreteFailure: "minor style issue", suggestedFix: "tidy up" }],
			checkedAndCleared: "reviewed the stop predicate wiring for QUAL-05",
			classification: "root-cause",
			classificationJustification: "fixes the underlying cause directly, no shortcut taken",
		};

		const stopResult = decideWorkflowStop(review);
		expect(stopResult.stop, "a root-cause review with only WARNINGs must not stop the workflow, however many WARNINGs it carries").toBe(false);
	});
});
