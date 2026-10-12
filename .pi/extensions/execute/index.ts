/**
 * /execute: runs the next unfinished PLAN task and appends PROGRESS.md only after the evidence gate accepts.
 * Registers one command, zero tools. Rationale lives in docs/WORKFLOWS.md.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { workDir } from "../../lib/work-artifacts.ts";
import { validateGatedSpec } from "../grill/spec-gate.ts";
import { extractSpecRequirementIds } from "../plan-ceremony/requirement-ids.ts";
import { validatePlan, type ParsedTask } from "../plan-ceremony/plan-schema.ts";
import { gateDepthFor } from "../quality/gates.ts";
import { registeredToolNames, runChangeGateStage, runTypecheckAt } from "../quality/index.ts";
import { classifyGitInvocation, currentBranch, currentSha, currentTree } from "../safety/git.ts";
import { PROTECTED_BRANCHES } from "../safety/index.ts";
import { endRun, isRunArmed, startRun } from "../workflows/evidence.ts";
import { HANDOFF_AGENT, buildHandoffPacket, probeSubagentAvailability, renderHandoffPacket } from "./handoff.ts";
import { acceptedEntries, allowanceOf, appendLedger, attemptState, ledgerBase, pinnedAllowance, readLedger } from "./ledger.ts";
import {
	REVISION_CAP, appendProgress, armExecuteRun, changedFiles, checkVerification, disarmExecuteRun, driftAbort, ensureWorkIgnored,
	executeRunContext, headShaOrEmpty, noteToolEnd, noteToolStart, renderProgressAppend, uncommittedPaths, verificationRecord,
} from "./progress.ts";

/** Slugs holding a PLAN.md. A plan is only trusted after revalidation, so existence is all that is checked here. */
function slugsWithPlan(cwd: string): string[] {
	const root = resolve(join(cwd, ".pi", "work"));
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter((e) => e.isDirectory() && existsSync(join(root, e.name, "PLAN.md")))
		.sort((a, b) => statSync(join(root, b.name)).mtimeMs - statSync(join(root, a.name)).mtimeMs)
		.map((e) => e.name);
}

export default function (pi: ExtensionAPI): void {
	// Reset at each arm; the settle handler reads them after the run ends.
	let baseSha = "";
	let allowance: { spec: readonly string[]; plan: readonly string[] } = { spec: [], plan: [] };
	let errorCount = 0;
	let baseTypecheckFailed = false;

	pi.registerCommand("execute", {
		description: "Run the next unfinished PLAN.md task, evidence-gated, and append PROGRESS.md on acceptance",
		handler: async (args, ctx) => {
			const fail = (msg: string) => void ctx.ui.notify(msg, "error");
			try {
				const tokens = args.trim().split(/\s+/).filter((t) => t !== "");
				const reset = tokens.includes("--reset");
				const arg = tokens.find((t) => t !== "--reset") ?? "";
				const candidates = slugsWithPlan(ctx.cwd);
				if (arg === "" && candidates.length !== 1) {
					return fail(candidates.length === 0 ? "execute: no .pi/work/<slug>/PLAN.md found -- run /plan first" : `execute: several plans exist (${candidates.join(", ")}) -- pass one: /execute <slug>`);
				}
				const slug = arg !== "" ? arg : (candidates[0] as string);
				const dir = workDir(ctx.cwd, slug);

				const verdict = classifyGitInvocation({ subcommand: "commit", args: [] }, { currentBranch: currentBranch(ctx.cwd), protectedBranches: PROTECTED_BRANCHES });
				if (verdict.kind === "block") return fail(verdict.reason);

				if (!existsSync(join(dir, "PLAN.md"))) return fail(`execute: .pi/work/${slug}/PLAN.md does not exist -- run /plan first`);
				const spec = validateGatedSpec(readFileSync(join(dir, "SPEC.md"), "utf-8"));
				if (!spec.ok) return fail(spec.reason);
				const plan = validatePlan(readFileSync(join(dir, "PLAN.md"), "utf-8"), extractSpecRequirementIds(spec.spec.requirementsBody));
				if (!plan.ok) return fail(plan.reason);

				allowance = { spec: spec.spec.scopePin.expectedFiles, plan: plan.plan.filesTouched };
				if (allowance.spec.length + allowance.plan.length === 0) {
					return fail("execute: the write allowance (SPEC expected files and PLAN files-touched) is empty -- nothing may be written");
				}

				const rows = readLedger(ctx.cwd, slug);
				const union = allowanceOf(allowance.spec, allowance.plan);
				const pinnedUnion = pinnedAllowance(rows);
				if (pinnedUnion !== undefined && pinnedUnion.join("\n") !== union.join("\n")) {
					return fail(`execute: the SPEC/PLAN write allowance changed since ${slug}'s base was pinned (pinned: ${pinnedUnion.join(", ")}) -- restore it`);
				}
				const recorded = new Set(acceptedEntries(rows).map((e) => e.taskId));
				const task: ParsedTask | undefined = plan.plan.tasks.find((t) => !recorded.has(t.id));
				if (task === undefined || task.verificationCommand === undefined) return fail(task === undefined ? "execute: every PLAN task already has a PROGRESS entry" : `execute: ${task.id} has no verification command`);

				if (isRunArmed() || !ctx.isIdle()) return fail("execute: a turn is already in flight -- wait for it to finish");

				const prior = reset ? { attempts: 0, stalled: false } : attemptState(rows, task.id);
				if (prior.attempts > REVISION_CAP || prior.stalled) {
					return fail(`execute: ${task.id} is escalated (${prior.attempts} rejected attempts${prior.stalled ? ", errors not dropping" : ""}) -- inspect it, then run /execute ${slug} --reset to allow another attempt`);
				}

				// A typecheck that already fails on the base tree cannot blame the change, so the settle gate skips that leg.
				const deterministic = gateDepthFor("execute").mechanisms.includes("deterministic");
				baseTypecheckFailed = deterministic && runTypecheckAt(ctx.cwd, ctx.isProjectTrusted()).status === "fail";
				if (deterministic) ctx.ui.notify(`execute: ${task.id} runs the deterministic gate on the changed files at settle`, "info");

				const probe = probeSubagentAvailability(registeredToolNames());
				let brief: string;
				let mode: "delegated" | "degraded (ordinary prompt loop)";
				if (probe.status === "pass") {
					mode = "delegated";
					// A child's tool results never reach this session's evidence, so the parent re-runs the verification itself.
					brief = `Dispatch this packet to the subagent tool with agent: "${HANDOFF_AGENT}" and wait with bg_wait. Its report is not evidence:\n\n${renderHandoffPacket(buildHandoffPacket({ spec: spec.spec, task }))}`;
				} else {
					mode = "degraded (ordinary prompt loop)";
					ctx.ui.notify(`execute: subagent layer unavailable (${probe.status === "unavailable" ? probe.reason : "not usable"}) -- running ${task.id} in this session, not delegated`, "warning");
					brief = `Do this task yourself: ${task.rawLine}`;
				}

				// Base SHA and tree are read in the same try, so a throw refuses and never arms a run.
				const ignoredNow = ensureWorkIgnored(ctx.cwd);
				if (ignoredNow !== undefined) ctx.ui.notify(ignoredNow, "info");
				const headSha = currentSha(ctx.cwd);
				const pinned = ledgerBase(rows);
				if (pinned === undefined) appendLedger(ctx.cwd, slug, { kind: "base", sha: headSha, allowance: union, reason: "first /execute" });
				if (reset) appendLedger(ctx.cwd, slug, { kind: "reset", taskId: task.id });
				baseSha = pinned ?? headSha;
				startRun(ctx.cwd, headSha, currentTree(ctx.cwd));
				errorCount = 0;
				armExecuteRun({ cwd: ctx.cwd, slug, taskId: task.id, verificationCommand: task.verificationCommand, mode });
				pi.sendUserMessage(`${brief}\n\nMake exactly one atomic commit with the bash tool, THEN run the verification command yourself with the bash tool, exactly as written, on the committed HEAD: ${task.verificationCommand}\nTouch only: ${[...allowance.spec, ...allowance.plan].join(", ")}`);
			} catch (err) {
				fail(err instanceof Error ? err.message : String(err));
			}
		},
	});

	// A run whose agent_end never arrived must not settle some later turn.
	pi.on("session_start", () => disarmExecuteRun());

	pi.on("tool_execution_start", (event) => {
		if (executeRunContext() !== undefined) noteToolStart(event.toolCallId, event.toolName, event.args);
	});

	// The evidence record itself is taken by the workflows recorder on the shared run; this handler keeps only the verification run.
	pi.on("tool_execution_end", (event) => {
		const run = executeRunContext();
		if (run === undefined) return;
		noteToolEnd(event.toolCallId, event.isError, event.result, () => ({ sha: headShaOrEmpty(run.cwd), dirty: uncommittedPaths(run.cwd) }));
		if (event.isError) errorCount += 1;
	});

	pi.on("agent_end", async (_event, ctx) => {
		const run = executeRunContext();
		if (run === undefined) return;
		const verification = verificationRecord();
		disarmExecuteRun();
		try {
			const cwd = run.cwd;
			const sha = currentSha(cwd);
			const ended = endRun(sha, currentTree(cwd));
			const checked = ended?.ok === true ? checkVerification(verification, run.verificationCommand, ended.sha) : undefined;
			const verdict = ended?.ok === true && checked?.ok === false ? { ok: false as const, reason: checked.reason } : ended;
			// Unarmed means another settle handler consumed the run; no verdict, so nothing is written.
			if (verdict === undefined) return void ctx.ui.notify(`execute: ${run.taskId} had no evidence verdict -- nothing written`, "error");
			const reject = (reason: string) => {
				appendLedger(cwd, run.slug, { kind: "rejected", taskId: run.taskId, count: errorCount });
				const state = attemptState(readLedger(cwd, run.slug), run.taskId);
				const next = state.attempts > REVISION_CAP || state.stalled ? "escalated: further attempts are refused until /execute --reset" : "fix and run /execute again";
				ctx.ui.notify(`execute: ${run.taskId} rejected -- ${reason}; ${next}`, "error");
			};
			if (!verdict.ok) return reject(verdict.reason);
			const dirty = uncommittedPaths(cwd);
			if (dirty !== "") return reject(`the working tree is not the commit (uncommitted or untracked: ${dirty}), so the gate would not check what was committed`);
			const changed = changedFiles(cwd, baseSha, verdict.sha);
			const drift = driftAbort({ attemptedPaths: changed, specExpectedFiles: allowance.spec, planFilesTouched: allowance.plan });
			if (!drift.ok) return void ctx.ui.notify(`execute: HALT ${run.taskId} -- ${drift.reason}`, "error");
			let gateLine = "outside this workflow's gate depth";
			if (gateDepthFor("execute").mechanisms.includes("deterministic")) {
				const gate = runChangeGateStage({ cwd, projectTrusted: ctx.isProjectTrusted(), baseSha, changed, baseTypecheckFailed });
				if (gate.typecheck.status === "fail" || gate.antiPattern.status === "fail") return reject(`the deterministic gate fails on the committed change:\n${gate.report}`);
				// Awaited only when nothing ran, so an ordinary settle stays synchronous.
				if (!gate.ranAny && !(await ctx.ui.confirm("Record with no deterministic check?", `No deterministic check applies to ${run.taskId}:\n${gate.report}`))) {
					return void ctx.ui.notify(`execute: ${run.taskId} not recorded -- no deterministic check ran and recording without one was not approved`, "error");
				}
				gateLine = `${gate.report.replace(/\n/g, "; ")}${gate.ranAny ? "" : " -- no check ran; recorded with the user's approval"}`;
			}
			const rendered = renderProgressAppend({ taskId: run.taskId, commitSha: verdict.sha, verificationCommand: `${run.verificationCommand} [${run.mode}]`, gate: gateLine, output: verification?.output ?? "", exitCode: verification?.exitCode ?? 0, recordedAt: Date.now() });
			// The ledger row is the record; PROGRESS.md is the readable copy.
			appendLedger(cwd, run.slug, { kind: "accepted", taskId: run.taskId, sha: verdict.sha, entry: rendered });
			appendProgress(cwd, run.slug, rendered);
			ctx.ui.notify(`execute: ${run.taskId} recorded at ${verdict.sha} (${run.mode})`, "info");
		} catch (err) {
			ctx.ui.notify(`execute: ${run.taskId} not recorded -- ${err instanceof Error ? err.message : String(err)}`, "error");
		}
	});
}
