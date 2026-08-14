/**
 * FLOW-01 / GATE-07 -- the walking-skeleton proof: does `/quick` really
 * compose Phase 4's git guard, Phase 5's routing guard and Phase 6's
 * evidence gate, or does it merely LOOK like it does?
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE PROVES, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * Five cases: (0) `/quick` is really registered, so the cases below fail for
 * the right reason if it is not; (1) breaking the Phase 5 seam (no configured
 * auth for the executor candidate) makes `/quick` refuse in Phase 5's OWN
 * words, at zero provider requests; (2) breaking the Phase 4 seam (HEAD is a
 * protected branch) makes `/quick` refuse in Phase 4's OWN words, at zero
 * provider requests; (3) a transcript that reads exactly like a passing
 * `npm test` run, with no real tool call behind it, is REJECTED by the
 * evidence gate, and the reject reason is shown to contain none of the
 * fabricated text -- proof the gate never read it; (4) a real commit made
 * through the guarded bash tool, at the branch's real HEAD, is ACCEPTED, with
 * the accepted SHA checked against a `git rev-parse HEAD` this file runs
 * itself, a Phase 4 audit row, and a Phase 2 turn row, all in the SAME
 * session.
 *
 * This file does NOT re-prove `classifyGitInvocation`'s table
 * (`tests/unit/git-policy.test.ts`), `planRoleCall`'s resolution order
 * (`tests/unit/routing-dispatch.test.ts`) or `gateCompletion`'s predicate
 * (`tests/unit/evidence-gate.test.ts`). It proves that `/quick` calls the
 * REAL versions of all three, in the right order, and that a real Pi session
 * really executes the guarded command.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FIXTURE LOADS AT USER SCOPE
 * ---------------------------------------------------------------------------
 * `tests/helpers/session.ts`'s own docstring: project-scoped `.pi/extensions`
 * is gated behind project trust, which resolves `false` headless with no UI
 * to answer the prompt -- a silently absent extension is a green run that
 * proved nothing. Every case below loads through `extensionSource`, never a
 * project-scoped path, mirroring `tests/integration/double-enforcement.test.ts`
 * and `tests/integration/turns-log.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * DECISION D-13 -- EVERY EXPECTED REFUSAL IS READ FROM THE REAL FUNCTION
 * ---------------------------------------------------------------------------
 * Cases 1 and 2 call `planRoleCall` / `classifyGitInvocation` themselves,
 * with the same inputs `/quick` uses, and compare the notification against
 * the RETURNED `reason` -- never a retyped literal. Phase 5's own review
 * found a wire-proof test that was structurally unable to distinguish a real
 * routing decision from a hardcoded chain head; a retyped literal here would
 * stay green against a `/quick` that hardcoded the identical string.
 *
 * ---------------------------------------------------------------------------
 * DECISION D-14 -- A REFUSAL MUST COST ZERO PROVIDER REQUESTS
 * ---------------------------------------------------------------------------
 * `faux.state.callCount === 0` after a refusal is what distinguishes
 * "refused before prompting" from "prompted, then reported something" --
 * the same assertion shape `tests/integration/single-shot-roles.test.ts`
 * established for a guard refusal.
 *
 * ---------------------------------------------------------------------------
 * DECISION D-16 -- A KNOWN AND ACCEPTED PROPERTY, STATED RATHER THAN HIDDEN
 * ---------------------------------------------------------------------------
 * Evidence is bound to the SHA at CAPTURE time and compared against HEAD at
 * CLAIM time. A verification command run BEFORE the commit is therefore
 * stale by construction the instant the commit lands -- this is GATE-07's
 * stated rule ("evidence collected against SHA A must not satisfy a claim
 * made at SHA B"), not a defect. Re-running verification after the commit,
 * or binding to a tree hash instead of a commit SHA, is Phase 8's job, not
 * this walking skeleton's.
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { describe, expect, it } from "vitest";

import { logPath } from "../../.pi/lib/jsonl.ts";
import { TURNS_LOG_BASE } from "../../.pi/extensions/diagnostics/schema.ts";
import { getModeState, planRoleCall } from "../../.pi/extensions/routing/modes.ts";
import { ROLE_MAP } from "../../.pi/extensions/routing/schema.ts";
import { classifyGitInvocation, currentBranch } from "../../.pi/extensions/safety/git.ts";
import { PROTECTED_BRANCHES } from "../../.pi/extensions/safety/index.ts";
import { AUDIT_LOG_BASE } from "../../.pi/extensions/safety/schema.ts";
import { EVIDENCE_LOG_BASE } from "../../.pi/extensions/workflows/evidence.ts";
import { repoRoot } from "../helpers/git.ts";
import { readJsonl } from "../helpers/logs.ts";
import { withFauxSession, type FauxSessionHandle } from "../helpers/session.ts";

/** Absolute, forward-slashed path of the safety extension this repository ships. */
const SAFETY_ENTRY = `${repoRoot()}/.pi/extensions/safety/index.ts`.replace(/\\/g, "/");
/** Absolute, forward-slashed path of the workflows extension (`/quick`) this repository ships. */
const WORKFLOWS_ENTRY = `${repoRoot()}/.pi/extensions/workflows/index.ts`.replace(/\\/g, "/");
/** Absolute, forward-slashed path of the diagnostics extension this repository ships. */
const DIAGNOSTICS_ENTRY = `${repoRoot()}/.pi/extensions/diagnostics/index.ts`.replace(/\\/g, "/");

/** A cost-rated fixture model, matching `tests/integration/mode-switch.test.ts`'s own shape. */
const FIXTURE_COST = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } as const;

/**
 * Build the inline user-scope extension source: the REAL safety extension,
 * then the REAL workflows extension (`/quick`), and -- for case 4 -- the
 * REAL diagnostics extension too (D-12). No re-implementation, no shim, no
 * stub: every default export is imported by absolute path and called.
 */
function composite(withDiagnostics: boolean): string {
	const lines = [
		"// Generated for tests/integration/quick-workflow.test.ts. Lives in a temp dir.",
		`import safety from ${JSON.stringify(SAFETY_ENTRY)};`,
		`import workflows from ${JSON.stringify(WORKFLOWS_ENTRY)};`,
	];
	if (withDiagnostics) {
		lines.push(`import diagnostics from ${JSON.stringify(DIAGNOSTICS_ENTRY)};`);
	}
	lines.push("export default function (pi) {", "\tsafety(pi);", "\tworkflows(pi);");
	if (withDiagnostics) {
		lines.push("\tdiagnostics(pi);");
	}
	lines.push("}");
	return lines.join("\n");
}

/** Run one git argv in `cwd`, throwing with the exact failing argv on a non-zero exit. */
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

/**
 * Init a real git repository IN the faux session's own `cwd` (never a fresh
 * temp dir -- `/quick` reads `ctx.cwd`, so the repository under test must be
 * the session's own working directory), checked out on `branch`, with one
 * seed commit so `currentSha`/`git rev-parse HEAD` never throw on "no
 * commits yet".
 */
function gitInit(cwd: string, branch: string): void {
	runGit(["init"], cwd);
	runGit(["config", "user.email", "quick@test.invalid"], cwd);
	runGit(["config", "user.name", "quick test"], cwd);
	runGit(["checkout", "-b", branch], cwd);
	writeFileSync(join(cwd, "seed.txt"), "seed\n", "utf-8");
	runGit(["add", "--", "seed.txt"], cwd);
	runGit(["commit", "-m", "seed"], cwd);
}

/** The number of commits reachable from HEAD, read fresh every call. */
function commitCount(cwd: string): number {
	return Number(runGit(["rev-list", "--count", "HEAD"], cwd).trim());
}

/** `git log --oneline`'s raw text, for a subject-line containment check. */
function logOneline(cwd: string): string {
	return runGit(["log", "--oneline"], cwd);
}

/**
 * This test's OWN, independent `git rev-parse HEAD` -- never the value taken
 * from an evidence row and compared to itself (case 4, assertion (b)).
 */
function realHeadSha(cwd: string): string {
	return runGit(["rev-parse", "HEAD"], cwd).trim();
}

/**
 * Poll `predicate` until it is true, or throw naming `label` and the
 * timeout. Modelled on `mode-switch.test.ts`'s `waitForConfiguredAuth` --
 * never a bare `setTimeout` guess. Needed because `pi.sendUserMessage` is
 * fire-and-forget [`agent-session.js:1855-1862`]: `/quick`'s command handler
 * returns before the turn -- and therefore the evidence gate -- has run.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 5000, label = "condition"): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`waitFor: "${label}" was not met within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

/**
 * Poll `modelRuntime.hasConfiguredAuth(providerId)` until `true`. Copied from
 * `tests/integration/mode-switch.test.ts`'s measured finding: the awaited
 * `setRuntimeApiKey` promise resolving is not sufficient by itself --
 * `hasConfiguredAuth` reads a cached snapshot that lags the live check by a
 * few milliseconds.
 */
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

/** A notification `ctx.ui.notify` recorded. */
interface Notification {
	text: string;
	level?: string;
}

/**
 * Patch `ctx.ui`'s own `notify` METHOD, not the `ctx.ui` property itself.
 *
 * `ctx.ui` is a getter that returns `runner.uiContext`
 * [VERIFIED: `dist/core/extensions/runner.js:464-467`] -- the SAME object
 * reference every time it is read, from EVERY context the runner ever
 * builds. `/quick`'s own refusal notifications happen inside the command
 * handler, on the exact `ctx` this file passes to `command.handler(...)`,
 * but the acceptance/rejection verdict (cases 3 and 4) is notified from
 * `agent_end`, a DIFFERENT, freshly built context object
 * [`runner.js:459-537`, `createContext()`]. Shadowing `ctx.ui` itself (the
 * technique `tests/integration/mode-switch.test.ts` uses, sufficient there
 * because every assertion in that file happens inside the SAME command
 * handler) would miss `agent_end`'s notification entirely -- confirmed by
 * running this file with that technique first and observing an empty
 * `notifications` array on cases 3 and 4 despite a real evidence row landing.
 * Mutating the METHOD on the shared underlying object is read back
 * identically by every context, command or event. Restored in a `finally` by
 * every caller so the mutation never leaks into a later test in the same
 * worker.
 */
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

/** The row shape `workflows/evidence.ts#writeEvidenceRow` writes. */
interface EvidenceRowShape {
	ts?: number;
	event?: string;
	verdict?: "accept" | "reject";
	reason?: string;
	baseSha?: string;
	headSha?: string;
	recordCount?: number;
	tools?: string[];
}

/** Read the evidence log for `cwd`, failing with the remedy rather than an `ENOENT` stack. */
function readEvidence(cwd: string): EvidenceRowShape[] {
	const file = logPath(cwd, EVIDENCE_LOG_BASE);
	if (!existsSync(file)) {
		throw new Error(
			`${file} does not exist: /quick's evidence gate never wrote a verdict. The likeliest cause is the ` +
				"workflows extension not loading at USER scope, or the run never reaching agent_end.",
		);
	}
	return readJsonl(file) as EvidenceRowShape[];
}

/** A row from the Phase 4 audit log, narrowed to the fields this file reads. */
interface AuditRowShape {
	event?: string;
	tool?: string;
	command?: string;
	verdict?: "allow" | "block";
	reason?: string;
}

/** Read the Phase 4 audit log for `cwd`, failing with the remedy rather than an `ENOENT` stack. */
function readAudit(cwd: string): AuditRowShape[] {
	const file = logPath(cwd, AUDIT_LOG_BASE);
	if (!existsSync(file)) {
		throw new Error(
			`${file} does not exist: the session wrote no safety audit log at all. The likeliest cause is the ` +
				"safety extension not loading at USER scope.",
		);
	}
	return readJsonl(file) as AuditRowShape[];
}

/** A row from the Phase 2 turns log, narrowed to the field this file reads. */
interface TurnRowShape {
	kind?: string;
}

/** Read the Phase 2 turns log for `cwd`, failing with the remedy rather than an `ENOENT` stack. */
function readTurns(cwd: string): TurnRowShape[] {
	const file = logPath(cwd, TURNS_LOG_BASE);
	if (!existsSync(file)) {
		throw new Error(
			`${file} does not exist: the session wrote no diagnostics turns log at all. The likeliest cause is ` +
				"the diagnostics extension not loading at USER scope.",
		);
	}
	return readJsonl(file) as TurnRowShape[];
}

/** `ROLE_MAP.cheap.executor`'s first candidate, read out of the real table -- never hardcoded. */
function flashExecutorCandidate(): { provider: string; id: string } {
	const candidate = ROLE_MAP.cheap.executor.candidates[0];
	if (candidate === undefined) {
		throw new Error(
			"ROLE_MAP.cheap.executor.candidates is empty -- this fixture has no candidate to make servable",
		);
	}
	return candidate;
}

describe("FLOW-01/GATE-07 -- /quick walking skeleton: two refusal seams, fabricated-evidence rejection, composed acceptance", () => {
	it("case 0 -- /quick is really registered (vacuity guard)", async () => {
		await withFauxSession({ extensionSource: composite(false) }, async ({ session }) => {
			const command = session.extensionRunner.getCommand("quick");
			expect(
				command,
				'getCommand("quick") returned undefined -- the workflows extension did not register /quick. ' +
					"The likeliest cause is the extension not loading at all: it must sit at USER scope headless, " +
					"which would make every case below fail for the wrong reason",
			).toBeDefined();
		});
	});

	it("case 1 -- credential-less flash candidates: /quick refuses with planRoleCall's own reason, at zero provider requests", async () => {
		await withFauxSession(
			{ extensionSource: composite(false), tools: ["bash"], responses: [] },
			async ({ session, faux, cwd }) => {
				// The branch is irrelevant to this case -- routing refuses before the
				// git pre-flight is ever reached -- but a repository is initialised
				// anyway so an accidental reordering does not crash the test with an
				// unrelated git error instead of failing the assertion below.
				gitInit(cwd, "work");

				const ctx = session.extensionRunner.createCommandContext();
				const expected = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: {} });
				expect(
					expected.ok,
					"the fixture became servable by accident -- with no credentials set up for either flash " +
						"candidate, planRoleCall must refuse, or case 1 is testing nothing",
				).toBe(false);
				if (expected.ok) {
					return;
				}

				const command = session.extensionRunner.getCommand("quick");
				expect(command, 'getCommand("quick") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					await command.handler("fix the typo", ctx);

					expect(notifications.length, "a refusal must still report an outcome").toBe(1);
					expect(
						notifications[0]?.text,
						"/quick's refusal text does not equal planRoleCall's own reason -- it may be retyped or hardcoded",
					).toBe(expected.reason);
					expect(notifications[0]?.level, "a refusal is an error, not an info message").toBe("error");
					expect(faux.state.callCount, "a routing refusal must cost zero provider requests").toBe(0);
				} finally {
					restore();
				}
			},
		);
	});

	it("case 2 -- protected branch: /quick refuses with classifyGitInvocation's own reason, at zero provider requests", async () => {
		const candidate = flashExecutorCandidate();

		await withFauxSession(
			{
				extensionSource: composite(false),
				tools: ["bash"],
				responses: [],
				providerId: candidate.provider,
				models: [{ id: candidate.id, reasoning: true, cost: FIXTURE_COST }],
			},
			async ({ session, faux, cwd, modelRuntime }) => {
				await modelRuntime.setRuntimeApiKey(candidate.provider, "kypi-fixture-not-a-real-key");
				await waitForConfiguredAuth(modelRuntime, candidate.provider);

				gitInit(cwd, "main");

				const ctx = session.extensionRunner.createCommandContext();
				const plan = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: {} });
				expect(
					plan.ok,
					"the executor route did not become servable -- case 2 needs it servable so the ONLY reachable " +
						"refusal is the branch-policy one",
				).toBe(true);
				if (!plan.ok) {
					return;
				}

				const expectedGit = classifyGitInvocation(
					{ subcommand: "commit", args: [] },
					{ currentBranch: currentBranch(cwd), protectedBranches: PROTECTED_BRANCHES },
				);
				expect(
					expectedGit.kind,
					'HEAD is not classified "block" -- case 2 is not exercising a genuine branch-policy refusal',
				).toBe("block");
				if (expectedGit.kind !== "block") {
					return;
				}

				const command = session.extensionRunner.getCommand("quick");
				expect(command, 'getCommand("quick") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					await command.handler("fix the typo", ctx);

					expect(notifications.length, "a refusal must still report an outcome").toBe(1);
					expect(
						notifications[0]?.text,
						"/quick's refusal text does not equal classifyGitInvocation's own reason -- it may be retyped " +
							"or hardcoded",
					).toBe(expectedGit.reason);
					expect(notifications[0]?.level, "a refusal is an error, not an info message").toBe("error");
					expect(faux.state.callCount, "a branch-policy refusal must cost zero provider requests").toBe(0);
				} finally {
					restore();
				}
			},
		);
	});

	it("WR-02 regression -- two models registered, session on the NON-routed one: /quick refuses at zero provider requests", async () => {
		const candidate = flashExecutorCandidate();
		const DECOY_MODEL_ID = "kypi-wr-02-decoy-model";

		await withFauxSession(
			{
				extensionSource: composite(false),
				tools: ["bash"],
				responses: [],
				providerId: candidate.provider,
				// `models[0]` becomes the session's own `ctx.model` -- the decoy, NOT
				// the routed candidate `planRoleCall` will resolve to.
				models: [
					{ id: DECOY_MODEL_ID, reasoning: true, cost: FIXTURE_COST },
					{ id: candidate.id, reasoning: true, cost: FIXTURE_COST },
				],
			},
			async ({ session, faux, cwd, modelRuntime, model }) => {
				await modelRuntime.setRuntimeApiKey(candidate.provider, "kypi-fixture-not-a-real-key");
				await waitForConfiguredAuth(modelRuntime, candidate.provider);

				expect(
					model.id,
					"the fixture's own session model must be the decoy, or this case is not exercising a genuine mismatch",
				).toBe(DECOY_MODEL_ID);

				gitInit(cwd, "work");

				const ctx = session.extensionRunner.createCommandContext();
				const plan = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: {} });
				expect(plan.ok, "the executor route did not become servable -- this case needs it servable").toBe(true);
				if (!plan.ok) {
					return;
				}
				expect(
					plan.model.id,
					"planRoleCall must resolve the REAL routed candidate, not the decoy -- otherwise this case " +
						"proves nothing about a mismatch",
				).toBe(candidate.id);
				expect(
					ctx.model?.id,
					"ctx.model must be the decoy -- the session's own active model, independent of routing",
				).toBe(DECOY_MODEL_ID);

				const command = session.extensionRunner.getCommand("quick");
				expect(command, 'getCommand("quick") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					await command.handler("fix the typo", ctx);

					expect(notifications.length, "a refusal must still report an outcome").toBe(1);
					expect(
						notifications[0]?.text,
						"WR-02's own refusal text must name the routed executor, not the session's active model",
					).toContain(candidate.id);
					expect(notifications[0]?.level, "a refusal is an error, not an info message").toBe("error");
					expect(faux.state.callCount, "a WR-02 refusal must cost zero provider requests").toBe(0);
				} finally {
					restore();
				}
			},
		);
	});

	it("case 3 -- a fabricated transcript is rejected, and the gate's reason quotes none of it", async () => {
		const candidate = flashExecutorCandidate();

		const FABRICATED = [
			"$ npm test",
			"",
			"PASS tests/unit/example.test.ts",
			"  ✓ does the thing (3 ms)",
			"",
			"Test Suites: 1 passed, 1 total",
			"Tests:       1 passed, 1 total",
			"exit 0",
		].join("\n");

		await withFauxSession(
			{
				extensionSource: composite(false),
				tools: ["bash"],
				providerId: candidate.provider,
				models: [{ id: candidate.id, reasoning: true, cost: FIXTURE_COST }],
				responses: [
					fauxAssistantMessage([fauxText(FABRICATED)], { stopReason: "stop" }),
					fauxAssistantMessage([fauxText("noted, thanks")], { stopReason: "stop" }),
				],
			},
			async ({ session, faux, cwd, modelRuntime }) => {
				await modelRuntime.setRuntimeApiKey(candidate.provider, "kypi-fixture-not-a-real-key");
				await waitForConfiguredAuth(modelRuntime, candidate.provider);

				gitInit(cwd, "work");

				const ctx = session.extensionRunner.createCommandContext();
				const plan = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: {} });
				expect(plan.ok, "the executor route did not become servable -- case 3 needs a servable route").toBe(true);
				if (!plan.ok) {
					return;
				}

				const command = session.extensionRunner.getCommand("quick");
				expect(command, 'getCommand("quick") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					await command.handler("run the tests", ctx);

					const evidenceFile = logPath(cwd, EVIDENCE_LOG_BASE);
					await waitFor(
						() => existsSync(evidenceFile) && readJsonl(evidenceFile).length >= 1,
						5000,
						"case 3's evidence row",
					);

					const rows = readEvidence(cwd);
					expect(rows.length, "more than one evidence row was written for a single /quick run").toBe(1);
					const row = rows[0] as EvidenceRowShape;
					expect(row.verdict, `expected reject, got: ${JSON.stringify(row)}`).toBe("reject");
					expect(
						row.recordCount ?? -1,
						"a fabricated transcript with no real tool call must record zero structured results",
					).toBe(0);

					expect(notifications.length, "a rejection must still report an outcome").toBe(1);
					expect(notifications[0]?.text, "/quick's notification does not equal the gate's own reason").toBe(
						row.reason,
					);
					expect(notifications[0]?.level, "a rejection is an error, not an info message").toBe("error");

					const reason = row.reason ?? "";
					expect(
						reason.includes(FABRICATED),
						"the gate's reject reason quotes the ENTIRE fabricated transcript -- it must never have read it",
					).toBe(false);
					for (const distinctiveLine of ["$ npm test", "exit 0"]) {
						expect(
							reason.includes(distinctiveLine),
							`the gate's reject reason contains a substring of the fabricated transcript ("${distinctiveLine}")`,
						).toBe(false);
					}

					expect(
						faux.state.callCount,
						"the model really did answer once and was disbelieved -- callCount must be exactly 1",
					).toBe(1);

					// Disarm proof: an ordinary turn OUTSIDE /quick's own run must record nothing new.
					await session.prompt("anything else?");
					const after = readEvidence(cwd);
					expect(
						after.length,
						"a turn outside /quick's own run wrote a second evidence row -- the run was not disarmed",
					).toBe(1);
				} finally {
					restore();
				}
			},
		);
	});

	it("case 4 -- a real guarded commit is accepted, bound to a SHA this test reads from git itself", async () => {
		const candidate = flashExecutorCandidate();
		const COMMIT_COMMAND = 'git commit --allow-empty -m "quick: skeleton commit"';

		await withFauxSession(
			{
				extensionSource: composite(true),
				tools: ["bash"],
				providerId: candidate.provider,
				models: [{ id: candidate.id, reasoning: true, cost: FIXTURE_COST }],
				responses: [
					fauxAssistantMessage([fauxToolCall("bash", { command: COMMIT_COMMAND })], { stopReason: "toolUse" }),
					fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
					fauxAssistantMessage([fauxText("noted, thanks")], { stopReason: "stop" }),
				],
			},
			async ({ session, cwd, modelRuntime }) => {
				await modelRuntime.setRuntimeApiKey(candidate.provider, "kypi-fixture-not-a-real-key");
				await waitForConfiguredAuth(modelRuntime, candidate.provider);

				gitInit(cwd, "work");
				const before = commitCount(cwd);

				const ctx = session.extensionRunner.createCommandContext();
				const plan = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: {} });
				expect(plan.ok, "the executor route did not become servable -- case 4 needs a servable route").toBe(true);
				if (!plan.ok) {
					return;
				}

				const command = session.extensionRunner.getCommand("quick");
				expect(command, 'getCommand("quick") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					await command.handler("make the skeleton commit", ctx);

					const evidenceFile = logPath(cwd, EVIDENCE_LOG_BASE);
					await waitFor(
						() => existsSync(evidenceFile) && readJsonl(evidenceFile).length >= 1,
						5000,
						"case 4's evidence row",
					);

					// (a) exactly one evidence row, accept, at least one record.
					const rows = readEvidence(cwd);
					expect(rows.length, "more than one evidence row was written for a single /quick run").toBe(1);
					const row = rows[0] as EvidenceRowShape;
					expect(row.verdict, `expected accept, got: ${JSON.stringify(row)}`).toBe("accept");
					expect(
						row.recordCount ?? 0,
						"an accepted run must have recorded at least one structured tool result",
					).toBeGreaterThanOrEqual(1);

					// (b) the accepted SHA equals a real `git rev-parse HEAD` THIS TEST reads.
					const sha = realHeadSha(cwd);
					expect(sha, "this test's own git rev-parse HEAD call returned nothing").toBeTruthy();
					expect(
						row.headSha,
						"the accepted row's headSha does not equal a real git rev-parse HEAD read by the test itself",
					).toBe(sha);
					// IN-03 / CR-01's negation: HEAD genuinely moved during this run -- the
					// cheapest possible statement that this accept is NOT the CR-01 shape.
					expect(row.baseSha, "an accepted run's baseSha must differ from its headSha -- HEAD must have moved").not.toBe(
						row.headSha,
					);

					// (c) the atomic-commit claim: commit count +1, subject present.
					const after = commitCount(cwd);
					expect(after, "the commit count did not increase by exactly one").toBe(before + 1);
					expect(
						logOneline(cwd),
						"git log --oneline does not show the skeleton commit's subject",
					).toContain("quick: skeleton commit");

					// (d) the Phase 4 audit log carries a row naming the git commit -- non-empty asserted FIRST.
					const auditRows = readAudit(cwd);
					expect(auditRows.length, "the audit log exists but is empty").toBeGreaterThan(0);
					const commitAuditRows = auditRows.filter((r) => (r.command ?? "").includes("git commit --allow-empty"));
					expect(
						commitAuditRows.length,
						"no audit row names the git commit /quick made -- the wrapped bash tool's own enforcement " +
							"may not have run",
					).toBeGreaterThan(0);

					// (e) the Phase 2 turn log carries at least one kind:"turn" row -- non-empty asserted FIRST.
					const turnRows = readTurns(cwd);
					expect(turnRows.length, "the turns log exists but is empty").toBeGreaterThan(0);
					const realTurnRows = turnRows.filter((r) => r.kind === "turn");
					expect(
						realTurnRows.length,
						'no kind:"turn" row was written for this composed session -- see SUMMARY for a possible SEAM FINDING',
					).toBeGreaterThanOrEqual(1);

					expect(notifications.length, "an acceptance must still report an outcome").toBeGreaterThan(0);
					expect(notifications.at(-1)?.level, "an acceptance is informational, not an error").toBe("info");

					// Disarm proof: an ordinary turn OUTSIDE /quick's own run must record nothing new.
					await session.prompt("anything else?");
					const evidenceAfterSecondTurn = readEvidence(cwd);
					expect(
						evidenceAfterSecondTurn.length,
						"a turn outside /quick's own run wrote a second evidence row -- the run was not disarmed",
					).toBe(1);
				} finally {
					restore();
				}
			},
		);
	});

	it("case 5 (CR-01 regression) -- a real tool call that makes NO commit is rejected, and the commit count is unchanged", async () => {
		const candidate = flashExecutorCandidate();

		await withFauxSession(
			{
				extensionSource: composite(false),
				tools: ["bash"],
				providerId: candidate.provider,
				models: [{ id: candidate.id, reasoning: true, cost: FIXTURE_COST }],
				responses: [
					fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
					fauxAssistantMessage([fauxText("all done, I made the commit and the tests pass")], { stopReason: "stop" }),
				],
			},
			async ({ session, cwd, modelRuntime }) => {
				await modelRuntime.setRuntimeApiKey(candidate.provider, "kypi-fixture-not-a-real-key");
				await waitForConfiguredAuth(modelRuntime, candidate.provider);

				gitInit(cwd, "work");
				const before = commitCount(cwd);

				const ctx = session.extensionRunner.createCommandContext();
				const plan = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: {} });
				expect(plan.ok, "the executor route did not become servable -- case 5 needs a servable route").toBe(true);
				if (!plan.ok) {
					return;
				}

				const command = session.extensionRunner.getCommand("quick");
				expect(command, 'getCommand("quick") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					await command.handler("do the thing", ctx);

					const evidenceFile = logPath(cwd, EVIDENCE_LOG_BASE);
					await waitFor(
						() => existsSync(evidenceFile) && readJsonl(evidenceFile).length >= 1,
						5000,
						"case 5's evidence row",
					);

					const rows = readEvidence(cwd);
					expect(rows.length, "more than one evidence row was written for a single /quick run").toBe(1);
					const row = rows[0] as EvidenceRowShape;
					expect(
						row.verdict,
						`CR-01 regression: a run with no commit must be REJECTED, got: ${JSON.stringify(row)}`,
					).toBe("reject");
					expect(row.reason ?? "").toContain("no commit");
					expect(
						row.baseSha,
						"CR-01's own shape: HEAD never moved during this run",
					).toBe(row.headSha);

					const after = commitCount(cwd);
					expect(after, "PROBE A: no commit may have actually landed").toBe(before);

					expect(notifications.length, "a rejection must still report an outcome").toBe(1);
					expect(notifications[0]?.level, "a rejection is an error, not an info message").toBe("error");

					// The model's own prose claimed success -- the reject reason must never echo it.
					expect(row.reason ?? "").not.toContain("I made the commit");
				} finally {
					restore();
				}
			},
		);
	});

	it("case 6 (CR-01 iteration 2 regression, PROBE F) -- a failed verification command is not buried by a commit that lands afterwards", async () => {
		const candidate = flashExecutorCandidate();

		await withFauxSession(
			{
				extensionSource: composite(false),
				tools: ["bash"],
				providerId: candidate.provider,
				models: [{ id: candidate.id, reasoning: true, cost: FIXTURE_COST }],
				responses: [
					// (1) a real verification command that genuinely fails (exit 1).
					fauxAssistantMessage([fauxToolCall("bash", { command: "exit 1" })], { stopReason: "toolUse" }),
					// (2) the model, undeterred, makes the commit anyway.
					fauxAssistantMessage([fauxToolCall("bash", { command: 'git commit --allow-empty -m "quick: PROBE F"' })], {
						stopReason: "toolUse",
					}),
					fauxAssistantMessage([fauxText("tests pass, done")], { stopReason: "stop" }),
				],
			},
			async ({ session, cwd, modelRuntime }) => {
				await modelRuntime.setRuntimeApiKey(candidate.provider, "kypi-fixture-not-a-real-key");
				await waitForConfiguredAuth(modelRuntime, candidate.provider);

				gitInit(cwd, "work");

				const ctx = session.extensionRunner.createCommandContext();
				const plan = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: {} });
				expect(plan.ok, "the executor route did not become servable -- case 6 needs a servable route").toBe(true);
				if (!plan.ok) {
					return;
				}

				const command = session.extensionRunner.getCommand("quick");
				expect(command, 'getCommand("quick") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					await command.handler("run verification, then commit", ctx);

					const evidenceFile = logPath(cwd, EVIDENCE_LOG_BASE);
					await waitFor(
						() => existsSync(evidenceFile) && readJsonl(evidenceFile).length >= 1,
						5000,
						"case 6's evidence row",
					);

					const rows = readEvidence(cwd);
					expect(rows.length, "more than one evidence row was written for a single /quick run").toBe(1);
					const row = rows[0] as EvidenceRowShape;
					expect(
						row.verdict,
						`PROBE F: a run holding a recorded failure must be REJECTED even though a commit landed ` +
							`afterwards, got: ${JSON.stringify(row)}`,
					).toBe("reject");
					expect(row.reason ?? "", "the reject reason must name the failing tool").toContain("bash");
					expect(
						row.recordCount ?? 0,
						"both the failing verification AND the passing commit must have been recorded",
					).toBe(2);
					expect(
						row.baseSha,
						"HEAD genuinely moved during this run -- the commit really landed, and still rejected",
					).not.toBe(row.headSha);

					expect(notifications.length, "a rejection must still report an outcome").toBe(1);
					expect(notifications[0]?.level, "a rejection is an error, not an info message").toBe("error");

					// The model's own prose claimed success -- the reject reason must never echo it.
					expect(row.reason ?? "").not.toContain("tests pass");
				} finally {
					restore();
				}
			},
		);
	});

	it("case 7 (CR-01 iteration 3 regression, PROBE P4) -- a call BLOCKED by this repo's own safety layer is not invisible to the gate", async () => {
		const candidate = flashExecutorCandidate();
		const BLOCKED_PUSH = "git push --force origin main";

		await withFauxSession(
			{
				extensionSource: composite(false),
				tools: ["bash"],
				providerId: candidate.provider,
				models: [{ id: candidate.id, reasoning: true, cost: FIXTURE_COST }],
				responses: [
					// (1) BLOCKED before it ever executes -- CR-05's own pushTargetsProtected
					// check fires on the refspec destination regardless of the checked-out
					// branch, so this blocks even though gitInit below checks out "work".
					fauxAssistantMessage([fauxToolCall("bash", { command: BLOCKED_PUSH })], { stopReason: "toolUse" }),
					// (2) undeterred, the model commits anyway.
					fauxAssistantMessage([fauxToolCall("bash", { command: 'git commit --allow-empty -m "quick: PROBE P4"' })], {
						stopReason: "toolUse",
					}),
					fauxAssistantMessage([fauxText("pushed and verified, tests pass")], { stopReason: "stop" }),
				],
			},
			async ({ session, cwd, modelRuntime }) => {
				await modelRuntime.setRuntimeApiKey(candidate.provider, "kypi-fixture-not-a-real-key");
				await waitForConfiguredAuth(modelRuntime, candidate.provider);

				gitInit(cwd, "work");

				const ctx = session.extensionRunner.createCommandContext();
				const plan = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: {} });
				expect(plan.ok, "the executor route did not become servable -- case 7 needs a servable route").toBe(true);
				if (!plan.ok) {
					return;
				}

				const command = session.extensionRunner.getCommand("quick");
				expect(command, 'getCommand("quick") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					await command.handler("push and commit", ctx);

					const evidenceFile = logPath(cwd, EVIDENCE_LOG_BASE);
					await waitFor(
						() => existsSync(evidenceFile) && readJsonl(evidenceFile).length >= 1,
						5000,
						"case 7's evidence row",
					);

					// The audit log independently confirms the push was really blocked --
					// the same fact the evidence gate must now also be able to see.
					const auditRows = readAudit(cwd);
					const pushAuditRows = auditRows.filter((r) => (r.command ?? "").includes(BLOCKED_PUSH));
					expect(
						pushAuditRows.some((r) => r.verdict === "block"),
						"the safety audit log must record a block verdict for the push -- otherwise this case is not " +
							"exercising a genuine block and proves nothing about CR-01",
					).toBe(true);

					const rows = readEvidence(cwd);
					expect(rows.length, "more than one evidence row was written for a single /quick run").toBe(1);
					const row = rows[0] as EvidenceRowShape;
					expect(
						row.verdict,
						`PROBE P4: a run containing a call BLOCKED by this repo's own safety layer must be REJECTED, ` +
							`even though a commit landed afterwards, got: ${JSON.stringify(row)}`,
					).toBe("reject");
					expect(
						row.recordCount ?? 0,
						"both the BLOCKED push and the passing commit must have been recorded -- a blocked call must " +
							"not be structurally invisible to the gate",
					).toBe(2);
					expect(
						row.baseSha,
						"HEAD genuinely moved during this run -- the commit really landed, and still rejected",
					).not.toBe(row.headSha);

					expect(notifications.length, "a rejection must still report an outcome").toBe(1);
					expect(notifications[0]?.level, "a rejection is an error, not an info message").toBe("error");

					// The model's own prose claimed success -- the reject reason must never echo it.
					expect(row.reason ?? "").not.toContain("pushed and verified");
				} finally {
					restore();
				}
			},
		);
	});

	it("case 8 (CR-01 iteration 3 regression, PROBE P7) -- a dropped capture (currentSha throws mid-run) must reject, never silently vanish into an ACCEPT", async () => {
		const candidate = flashExecutorCandidate();

		await withFauxSession(
			{
				extensionSource: composite(false),
				tools: ["bash"],
				providerId: candidate.provider,
				models: [{ id: candidate.id, reasoning: true, cost: FIXTURE_COST }],
				responses: [
					// (1) a REAL, successful command (mv exits 0) whose own EVIDENCE
					// CAPTURE nonetheless throws: tool_execution_end's currentSha(cwd)
					// call cannot find a `.git` to read while it is renamed away.
					fauxAssistantMessage([fauxToolCall("bash", { command: "mv .git .gitx" })], { stopReason: "toolUse" }),
					// (2) restore .git and make the real commit -- this call's own
					// capture succeeds normally.
					fauxAssistantMessage(
						[fauxToolCall("bash", { command: 'mv .gitx .git && git commit --allow-empty -m "quick: PROBE P7"' })],
						{ stopReason: "toolUse" },
					),
					fauxAssistantMessage([fauxText("tests pass, done")], { stopReason: "stop" }),
				],
			},
			async ({ session, cwd, modelRuntime }) => {
				await modelRuntime.setRuntimeApiKey(candidate.provider, "kypi-fixture-not-a-real-key");
				await waitForConfiguredAuth(modelRuntime, candidate.provider);

				gitInit(cwd, "work");

				const ctx = session.extensionRunner.createCommandContext();
				const plan = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: {} });
				expect(plan.ok, "the executor route did not become servable -- case 8 needs a servable route").toBe(true);
				if (!plan.ok) {
					return;
				}

				const command = session.extensionRunner.getCommand("quick");
				expect(command, 'getCommand("quick") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					await command.handler("rename .git away, then restore and commit", ctx);

					const evidenceFile = logPath(cwd, EVIDENCE_LOG_BASE);
					await waitFor(
						() => existsSync(evidenceFile) && readJsonl(evidenceFile).length >= 1,
						5000,
						"case 8's evidence row",
					);

					const rows = readEvidence(cwd);
					expect(rows.length, "more than one evidence row was written for a single /quick run").toBe(1);
					const row = rows[0] as EvidenceRowShape;
					expect(
						row.verdict,
						`PROBE P7: a run holding a DROPPED capture must be REJECTED, not silently accepted just ` +
							`because the surviving record's own SHA happens to match headSha, got: ${JSON.stringify(row)}`,
					).toBe("reject");
					expect(
						row.reason ?? "",
						"the reject reason must name the capture-failed record so a human can tell it apart from an ordinary tool failure",
					).toContain("capture failed");
					expect(
						row.recordCount ?? 0,
						"the capture failure must be recorded as ITS OWN row, not silently dropped -- CR-01 iteration 3's whole point",
					).toBe(2);
					expect(
						row.baseSha,
						"HEAD genuinely moved during this run -- the commit really landed, and still rejected",
					).not.toBe(row.headSha);

					expect(notifications.length, "a rejection must still report an outcome").toBe(1);
					expect(notifications[0]?.level, "a rejection is an error, not an info message").toBe("error");
				} finally {
					restore();
				}
			},
		);
	});

	it("case 9 (CR-01 iteration 4 regression, PROBE W1) -- a checkout that moves HEAD without committing anything is worded as HEAD moving, never as a commit landing", async () => {
		const candidate = flashExecutorCandidate();

		await withFauxSession(
			{
				extensionSource: composite(false),
				tools: ["bash"],
				providerId: candidate.provider,
				models: [{ id: candidate.id, reasoning: true, cost: FIXTURE_COST }],
				responses: [
					// (1) a real, successful tool call that moves HEAD -- CREATES
					// NO COMMIT, landing on a SHA that already existed before this
					// run was even armed.
					fauxAssistantMessage([fauxToolCall("bash", { command: "git checkout --detach HEAD~1" })], {
						stopReason: "toolUse",
					}),
					// (2) a false completion claim -- no commit was ever made here.
					fauxAssistantMessage([fauxText("done, I implemented and committed the fix and all tests pass")], {
						stopReason: "stop",
					}),
				],
			},
			async ({ session, cwd, modelRuntime }) => {
				await modelRuntime.setRuntimeApiKey(candidate.provider, "kypi-fixture-not-a-real-key");
				await waitForConfiguredAuth(modelRuntime, candidate.provider);

				gitInit(cwd, "work");
				// A second commit so HEAD~1 is a real, pre-existing commit for the
				// checkout below to land on.
				writeFileSync(join(cwd, "second.txt"), "second\n", "utf-8");
				runGit(["add", "--", "second.txt"], cwd);
				runGit(["commit", "-m", "second"], cwd);
				const totalCommitsBefore = Number(runGit(["rev-list", "--count", "--all"], cwd).trim());

				const ctx = session.extensionRunner.createCommandContext();
				const plan = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: {} });
				expect(plan.ok, "the executor route did not become servable -- case 9 needs a servable route").toBe(true);
				if (!plan.ok) {
					return;
				}

				const command = session.extensionRunner.getCommand("quick");
				expect(command, 'getCommand("quick") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					await command.handler("implement and commit the fix", ctx);

					const evidenceFile = logPath(cwd, EVIDENCE_LOG_BASE);
					await waitFor(
						() => existsSync(evidenceFile) && readJsonl(evidenceFile).length >= 1,
						5000,
						"case 9's evidence row",
					);

					const rows = readEvidence(cwd);
					expect(rows.length, "more than one evidence row was written for a single /quick run").toBe(1);
					const row = rows[0] as EvidenceRowShape;

					// PROBE W1's own shape: HEAD moved (a real, successful tool
					// call), so the gate still accepts -- CR-01 (iteration 4) is
					// about what the ACCEPT is worded as, never about tightening
					// the predicate itself (that is Phase 8's job).
					expect(row.verdict, `expected accept, got: ${JSON.stringify(row)}`).toBe("accept");
					expect(row.baseSha, "HEAD moved during this run").not.toBe(row.headSha);

					// No NEW commit object was created anywhere in the
					// repository -- checkout --detach only moves a ref.
					const totalCommitsAfter = Number(runGit(["rev-list", "--count", "--all"], cwd).trim());
					expect(totalCommitsAfter, "PROBE W1: a checkout must never create a new commit object").toBe(
						totalCommitsBefore,
					);

					// CR-01 (iteration 4): the row's own reason, and the
					// notification shown to the user, must say what was actually
					// checked -- never assert that a commit landed.
					expect(
						row.reason ?? "",
						'PROBE W1: the evidence row must not claim "a commit landed" when checkout only moved HEAD',
					).not.toContain("a commit landed");
					expect(row.reason ?? "", "the row's own reason must say HEAD moved instead").toContain("HEAD moved");

					expect(notifications.length, "an acceptance must still report an outcome").toBeGreaterThan(0);
					const last = notifications.at(-1);
					expect(
						last?.text ?? "",
						'PROBE W1: /quick\'s own notification must not claim "a commit landed"',
					).not.toContain("a commit landed");
					expect(last?.text ?? "", "the notification must say HEAD moved instead").toContain("HEAD moved");
					expect(last?.level, "an acceptance is informational, not an error").toBe("info");
				} finally {
					restore();
				}
			},
		);
	});

	it("WR-01 regression -- a second /quick while a run is in flight is refused, and does not steal the first run's buffer", async () => {
		const candidate = flashExecutorCandidate();

		await withFauxSession(
			{
				extensionSource: composite(false),
				tools: ["bash"],
				providerId: candidate.provider,
				models: [{ id: candidate.id, reasoning: true, cost: FIXTURE_COST }],
				responses: [
					fauxAssistantMessage(
						[fauxToolCall("bash", { command: 'git commit --allow-empty -m "quick: run one"' })],
						{ stopReason: "toolUse" },
					),
					fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
				],
			},
			async ({ session, cwd, modelRuntime }) => {
				await modelRuntime.setRuntimeApiKey(candidate.provider, "kypi-fixture-not-a-real-key");
				await waitForConfiguredAuth(modelRuntime, candidate.provider);

				gitInit(cwd, "work");

				const ctx = session.extensionRunner.createCommandContext();
				const plan = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: {} });
				expect(plan.ok, "the executor route did not become servable -- this case needs a servable route").toBe(true);
				if (!plan.ok) {
					return;
				}

				const command = session.extensionRunner.getCommand("quick");
				expect(command, 'getCommand("quick") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					// Run 1's handler arms the run and fires the turn in the background
					// (pi.sendUserMessage is fire-and-forget) -- the handler itself
					// returns before agent_end. Run 2's handler call races run 1's turn.
					await command.handler("first task", ctx);
					await command.handler("second task", ctx);

					expect(
						notifications.length,
						"the second /quick call must report exactly one refusal, synchronously, before run 1's turn settles",
					).toBe(1);
					expect(notifications[0]?.text, "WR-01's own refusal text").toContain("already in flight");
					expect(notifications[0]?.level, "a refusal is an error, not an info message").toBe("error");

					// Let run 1 actually finish, proving the refusal never touched its buffer.
					const evidenceFile = logPath(cwd, EVIDENCE_LOG_BASE);
					await waitFor(
						() => existsSync(evidenceFile) && readJsonl(evidenceFile).length >= 1,
						5000,
						"run 1's evidence row",
					);
					const rows = readEvidence(cwd);
					expect(
						rows.length,
						"exactly one evidence row for the one run that was ever actually armed -- a stolen buffer " +
							"would leave BOTH runs' work attributed to a single row, or none at all",
					).toBe(1);
					expect(rows[0]?.verdict, `run 1's own commit must still be accepted, got: ${JSON.stringify(rows[0])}`).toBe(
						"accept",
					);
				} finally {
					restore();
				}
			},
		);
	});

	it("WR-01 iteration 2 regression (PROBE H2) -- /quick refuses while an ORDINARY turn (not a second /quick) is in flight, and never arms a run for it", async () => {
		const candidate = flashExecutorCandidate();

		await withFauxSession(
			{
				extensionSource: composite(false),
				tools: ["bash"],
				providerId: candidate.provider,
				models: [{ id: candidate.id, reasoning: true, cost: FIXTURE_COST }],
				responses: [
					fauxAssistantMessage(
						[fauxToolCall("bash", { command: 'git commit --allow-empty -m "ordinary work"' })],
						{ stopReason: "toolUse" },
					),
					fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
				],
			},
			async ({ session, cwd, modelRuntime }) => {
				await modelRuntime.setRuntimeApiKey(candidate.provider, "kypi-fixture-not-a-real-key");
				await waitForConfiguredAuth(modelRuntime, candidate.provider);

				gitInit(cwd, "work");

				const ctx = session.extensionRunner.createCommandContext();
				const plan = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: {} });
				expect(plan.ok, "the executor route did not become servable -- this case needs a servable route").toBe(true);
				if (!plan.ok) {
					return;
				}

				const command = session.extensionRunner.getCommand("quick");
				expect(command, 'getCommand("quick") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					// Fire an ORDINARY prompt (not through /quick at all) and do not await
					// it -- this is the shape that WR-01's original fix (guarding only
					// against a second /quick) could not see: no `/quick` run is armed by
					// this turn, so `isRunArmed()` alone stays false throughout.
					const ordinary = session.prompt("do some ordinary work");
					await waitFor(() => !ctx.isIdle(), 2000, "the ordinary turn to actually start (ctx.isIdle() false)");

					await command.handler("do the quick thing", ctx);

					expect(notifications.length, "a refusal must still report an outcome").toBe(1);
					expect(
						notifications[0]?.text,
						"the refusal must come from the isIdle() guard, not the isRunArmed() one -- same wording either way",
					).toContain("already in flight");
					expect(notifications[0]?.level, "a refusal is an error, not an info message").toBe("error");

					await ordinary;

					// Disarm proof: /quick's own handler never called startRun(), so no
					// evidence row exists at all for this cwd -- not even a reject row.
					const evidenceFile = logPath(cwd, EVIDENCE_LOG_BASE);
					expect(
						existsSync(evidenceFile) ? readJsonl(evidenceFile).length : 0,
						"the ordinary turn's own commit must never be attributed to a /quick run that was refused " +
							"before it ever armed",
					).toBe(0);
				} finally {
					restore();
				}
			},
		);
	});

	it("WR-02 regression (PROBE I) -- a currentSha failure inside agent_end still disarms and writes a reject row, never leaves /quick armed forever", async () => {
		const candidate = flashExecutorCandidate();

		await withFauxSession(
			{
				extensionSource: composite(false),
				tools: ["bash"],
				providerId: candidate.provider,
				models: [{ id: candidate.id, reasoning: true, cost: FIXTURE_COST }],
				responses: [
					fauxAssistantMessage(
						[fauxToolCall("bash", { command: 'git commit --allow-empty -m "done" && rm -rf .git' })],
						{ stopReason: "toolUse" },
					),
					fauxAssistantMessage([fauxText("done, committed and tests pass")], { stopReason: "stop" }),
				],
			},
			async ({ session, cwd, modelRuntime }) => {
				await modelRuntime.setRuntimeApiKey(candidate.provider, "kypi-fixture-not-a-real-key");
				await waitForConfiguredAuth(modelRuntime, candidate.provider);

				gitInit(cwd, "work");

				const ctx = session.extensionRunner.createCommandContext();
				const plan = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: {} });
				expect(plan.ok, "the executor route did not become servable -- this case needs a servable route").toBe(true);
				if (!plan.ok) {
					return;
				}

				const command = session.extensionRunner.getCommand("quick");
				expect(command, 'getCommand("quick") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					await command.handler("destroy the repo after committing", ctx);

					// Before WR-02's fix this timeout never resolved: agent_end's own
					// currentSha() throw was swallowed whole, endRun() was never
					// reached, no row was ever written, and isRunArmed() stayed true
					// forever. waitFor's own timeout IS the RED signal for that shape.
					const evidenceFile = logPath(cwd, EVIDENCE_LOG_BASE);
					await waitFor(
						() => existsSync(evidenceFile) && readJsonl(evidenceFile).length >= 1,
						5000,
						"a reject row to land after agent_end's currentSha() failure",
					);

					const rows = readEvidence(cwd);
					expect(rows.length, "exactly one row for the one run").toBe(1);
					expect(rows[0]?.verdict, `a currentSha failure must fail CLOSED (reject), got: ${JSON.stringify(rows[0])}`).toBe(
						"reject",
					);

					// The slot must be free: a second /quick must be servable again.
					const { notifications: notifications2, restore: restore2 } = captureNotify(ctx);
					try {
						await command.handler("try again", ctx);
						expect(
							notifications2.some((n) => n.text.includes("already in flight")),
							"the run-armed slot must have been freed by WR-02's fix -- a second /quick must not be " +
								"permanently refused",
						).toBe(false);
					} finally {
						restore2();
					}

					// The .git destruction happened INSIDE the one bash call, so the
					// tool_result handler's own currentSha() read also throws (swallowed,
					// same rule) -- no structured record ever lands, so the reject reason
					// is the empty-records branch, not a stale-SHA one.
					expect(notifications.length, "run 1's own outcome must still be reported").toBe(1);
					expect(notifications[0]?.text, "notification text must equal the written row's own reason").toBe(
						rows[0]?.reason,
					);
					expect(notifications[0]?.level, "a reject is an error, not an info message").toBe("error");
				} finally {
					restore();
				}
			},
		);
	});
});
