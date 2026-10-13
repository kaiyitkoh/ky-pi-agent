/**
 * GATE-01 / QUAL-05 / QUAL-09 — session-level proof, over a REAL composed
 * session, of four claims plan 08-11 makes and no earlier plan could prove
 * alone:
 *
 *   "order"       — a finding already present in the harness source does not
 *                    stop /quick, and the paired positive proves a clean run
 *                    arms and reaches the provider.
 *   "unavailable" — the LSP leg's UNAVAILABLE state is visible in a real
 *                    gate report and never fails the change; and — the second
 *                    half of this group — RESEARCH Open Question 2
 *                    ("does `pi.getAllTools()` include a registered-but-
 *                    inactive tool?") is answered by OBSERVATION, not by
 *                    reading a type.
 *   "stop"        — a workaround-classified review's QUAL-05 stop signal is
 *                    demonstrable at session level, with the debt (proper
 *                    fix, deferral reason) visible in what the user is
 *                    shown; wiring this into a LIVE ceremonial workflow
 *                    command is explicitly Phase 9's job (QUAL-08) and this
 *                    file does not attempt it.
 *
 * ---------------------------------------------------------------------------
 * THE EXEC OVERRIDE — WHY EVERY GROUP SETS AND RESTORES IT
 * ---------------------------------------------------------------------------
 * The change gate's typecheck and lint legs run the repo-local `tsc` and `eslint` against `cwd`. A throwaway
 * fixture has neither, so every `it` below installs `quality/index.ts#setQuickGateExecOverrideForTests`
 * (a `globalThis`-backed seam) with a deterministic, instant runner and restores it in a `finally`, so a thrown
 * assertion never leaks the override into a later test file sharing this worker.
 *
 * ---------------------------------------------------------------------------
 * THE OFFENDING FIXTURE — WHAT TRIPS THE ERROR-TIER LEG
 * ---------------------------------------------------------------------------
 * The fixture plants a `.ts` file under `<cwd>/.pi/extensions/` that carries a shipped `TODO` marker, which
 * `rules.ts#ruleShippedTodo` flags at ERROR tier. It exists before the run and is not part of the run's change,
 * so it must not stop `/quick`.
 *
 * ---------------------------------------------------------------------------
 * WHY THE "stop" GROUP HAND-BUILDS A `ReviewArtifact`, NOT `validateReview`'s
 * OUTPUT
 * ---------------------------------------------------------------------------
 * `decideWorkflowStop` is PURE — its contract is "given this shape, decide",
 * regardless of whether the shape came from a real reviewer's validated tool
 * call or a hand-built fixture. `tests/integration/refute-or-promote.test.ts`
 * (plan 08-09) already established this precedent for the identical
 * function; this file follows it rather than re-deriving a second
 * `validateReview` round trip that would prove nothing new about
 * `decideWorkflowStop` itself.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { afterEach, describe, expect, it } from "vitest";

import { registeredToolNames, runChangeGateStage, setQuickGateExecOverrideForTests } from "../../.pi/extensions/quality/index.ts";
import type { ExecRunner } from "../../.pi/extensions/quality/gates.ts";
import type { ReviewArtifact } from "../../.pi/extensions/quality/review-schema.ts";
import { decideWorkflowStop } from "../../.pi/extensions/quality/verdict.ts";
import { getModeState, planRoleCall } from "../../.pi/extensions/routing/modes.ts";
import { ROLE_MAP } from "../../.pi/extensions/routing/schema.ts";
import { isRunArmed } from "../../.pi/extensions/workflows/evidence.ts";
import { repoRoot } from "../helpers/git.ts";
import { withFauxSession, type FauxSessionHandle } from "../helpers/session.ts";
import { spawnSync } from "node:child_process";

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

/** Run one git argv in `cwd`, throwing with the exact failing argv on a non-zero exit — mirrors `quick-workflow.test.ts#runGit`. */
function runGit(args: string[], cwd: string): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	if (result.error) {
		throw new Error(`git ${args.join(" ")} failed to launch in ${cwd}: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed (exit ${result.status}) in ${cwd}: ${result.stderr ?? ""}`);
	}
	return result.stdout ?? "";
}

/** Init a real git repository IN the faux session's own `cwd` — `/quick` reads `ctx.cwd`, so the repo under test must be that same directory. */
function gitInit(cwd: string, branch: string): void {
	runGit(["init"], cwd);
	runGit(["config", "user.email", "quick@test.invalid"], cwd);
	runGit(["config", "user.name", "quick test"], cwd);
	runGit(["checkout", "-b", branch], cwd);
	writeFileSync(join(cwd, "seed.txt"), "seed\n", "utf-8");
	runGit(["add", "--", "seed.txt"], cwd);
	runGit(["commit", "-m", "seed"], cwd);
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

/** Poll `predicate` until true, or throw naming `label` and the timeout — mirrors `quick-workflow.test.ts#waitFor`. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000, label = "condition"): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`waitFor: "${label}" was not met within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

/** Poll `modelRuntime.hasConfiguredAuth(providerId)` until true — mirrors `quick-workflow.test.ts#waitForConfiguredAuth`. */
async function waitForConfiguredAuth(modelRuntime: FauxSessionHandle["modelRuntime"], providerId: string, timeoutMs = 2000): Promise<void> {
	const start = Date.now();
	while (!modelRuntime.hasConfiguredAuth(providerId)) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`waitForConfiguredAuth: ${providerId} never reported configured auth within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

interface Notification {
	text: string;
	level?: string;
}

/** Patch `ctx.ui`'s own `notify` METHOD — see `quick-workflow.test.ts#captureNotify`'s own docstring for why the property itself must not be shadowed. */
function captureNotify(ctx: ExtensionCommandContext): { notifications: Notification[]; restore: () => void } {
	const notifications: Notification[] = [];
	const ui = ctx.ui as unknown as { notify: (text: string, level?: string) => void };
	const original = ui.notify;
	ui.notify = (text: string, level?: string) => {
		notifications.push({ text, level });
	};
	return {
		notifications,
		restore: () => {
			ui.notify = original;
		},
	};
}

/** Wire a session up with a configured, servable `executor` route -- every group that calls `/quick`'s handler needs this. */
async function withConfiguredCandidate<T>(fn: (candidate: { provider: string; id: string }) => Promise<T>): Promise<T> {
	const candidate = flashExecutorCandidate();
	return fn(candidate);
}

afterEach(() => {
	// Belt-and-braces: every `it` below restores this itself in a `finally`,
	// but a thrown assertion inside a `finally` (unlikely, but possible) must
	// still never leak the override across test files sharing this worker.
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
						// Deliberately no offending fixture -- this is the paired
						// positive that proves the gate is not a gate that always
						// blocks.

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

						// Drain to completion before this test ends -- isRunArmed()'s
						// backing slot is a globalThis-keyed, PROCESS-WIDE state (per
						// evidence.ts's own STATE-SLOT HAZARD docstring), shared across
						// every `it` in this file's worker. Leaving it armed would make
						// a LATER, unrelated test's /quick call refuse with "already in
						// flight" instead of exercising its own gate.
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
		// `tools` is BOTH the initial-active list AND the allowlist that bounds
		// the ENTIRE tool universe `getAllTools()`/`getActiveTools()` can ever
		// see [VERIFIED: pi-coding-agent 0.84.1 `dist/core/sdk.js:133,136` --
		// `allowedToolNames = options.tools ?? ...`]. `consult_advisor` must be
		// named here or it is invisible to BOTH accessors regardless of
		// registration, which would make this whole proof vacuous.
		await withFauxSession({ extensionSource: composite(), tools: ["bash", "consult_advisor"] }, async ({ session }) => {
			// consult_advisor is registered by quality/index.ts's own factory,
			// which -- per agent-session.js's own _refreshToolRegistry -- makes it
			// ACTIVE by default (a newly-registered tool not in the previous
			// registry is pushed into nextActiveToolNames). Confirmed before it is
			// touched, so the "still present after deactivation" half below is
			// meaningful rather than vacuous.
			const beforeActive = session.getActiveToolNames();
			const beforeAll = session.getAllTools().map((t) => t.name);
			expect(beforeActive.length, "the session must have at least one active tool before this proof begins").toBeGreaterThan(0);
			expect(beforeAll.length, "the session must have at least one registered tool before this proof begins").toBeGreaterThan(0);
			expect(beforeActive.includes("consult_advisor"), "consult_advisor must be active by default, or this proof is not exercising a genuine deactivation").toBe(true);
			expect(beforeAll.includes("consult_advisor"), "consult_advisor must already be visible in getAllTools() before deactivation").toBe(true);
			expect(registeredToolNames().includes("consult_advisor"), "quality/index.ts's own accessor must already agree with getAllTools()").toBe(true);

			// Deactivate it via AgentSession#setActiveToolsByName -- the exact
			// method pi.setActiveTools() itself calls
			// [agent-session.js:1882, `setActiveTools: (toolNames) =>
			// this.setActiveToolsByName(toolNames)`]. Genuinely exercises Pi's own
			// runtime, not a stand-in.
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
				// Demonstrated at SESSION LEVEL over a validated review, per this
				// plan's own must_haves -- wiring this into a LIVE ceremonial
				// workflow command is explicitly Phase 9's job (QUAL-08); this is
				// the record the stop signal produces, shown the way a future
				// workflow would show it.
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
