/**
 * /quick -- a Pi COMMAND, never a tool. Composes routing, git safety and the evidence gate; reimplements none.
 * Rationale and the dispatch order's findings live in docs/WORKFLOWS.md; this header stays short for the line budget.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runTypecheckAt } from "../quality/index.ts";
import { deriveNeed } from "../routing/guard.ts";
import { getModeState, planRoleCall } from "../routing/modes.ts";
import { classifyGitInvocation, currentBranch, currentSha, currentTree } from "../safety/git.ts";
import { PROTECTED_BRANCHES } from "../safety/index.ts";
import { IN_FLIGHT, armQuickSettle, clearQuickSettle, notePrompt, settleQuickRun } from "./settle.ts";
import { armedCwd, endRun, isRunArmed, pruneEvidenceLogs, recordCaptureFailure, recordFromToolResult, recordToolResult, startRun, writeRunEvidence } from "./evidence.ts";
import { disarmExecuteRun, ensureHarnessIgnored, executeRunContext, uncommittedPaths } from "../execute/progress.ts";
import { claimWorkflow } from "../../lib/active-workflow.ts";

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("quick", {
		description: "Route, guard, arm evidence, and hand a trivial task to the ordinary prompt loop",
		handler: async (args, ctx) => {
			// Order is the whole claim: route -> guard -> arm -> hand off.
			const task = args.trim();
			if (task === "") {
				ctx.ui.notify('quick: usage is "/quick <task>"', "error");
				return;
			}
			const plan = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: deriveNeed(ctx, { promptChars: task.length }) });
			if (!plan.ok) {
				ctx.ui.notify(plan.reason, "error");
				return;
			}
			if (ctx.model?.id !== plan.model.id || ctx.model?.provider !== plan.model.provider)
				return void ctx.ui.notify(`quick: session model is not the routed executor (${plan.model.provider}/${plan.model.id})`, "error");
			try {
				const verdict = classifyGitInvocation(
					{ subcommand: "commit", args: [] },
					{ currentBranch: currentBranch(ctx.cwd), protectedBranches: PROTECTED_BRANCHES },
				);
				if (verdict.kind === "block") return void ctx.ui.notify(verdict.reason, "error");
				if (isRunArmed() || !ctx.isIdle()) return void ctx.ui.notify(`quick: ${IN_FLIGHT}`, "error");
				disarmExecuteRun(); // with no shared run armed, an /execute slot is a leak that would otherwise settle this run

				ensureHarnessIgnored(ctx.cwd); // the settle refuses a dirty tree, and harness logs must not count as dirt
				// Pre-existing changes would be swept into the run's commit by `git add -A`, and would fail the settle anyway.
				const dirty = uncommittedPaths(ctx.cwd);
				if (dirty !== "") return void ctx.ui.notify(`quick: the working tree has uncommitted or untracked changes (${dirty}) -- commit or stash them first`, "error");
				claimWorkflow("quick");
				const baseSha = currentSha(ctx.cwd);
				const baseTree = currentTree(ctx.cwd); // read in the same try, so a throw refuses via the catch and never arms a run
				// A typecheck that already fails on the base cannot be blamed on the change.
				armQuickSettle({ baseSha, baseTypecheckFailed: runTypecheckAt(ctx.cwd, ctx.isProjectTrusted()).status === "fail" });
				const prompt = `${task}\n\nEnd this work in exactly one atomic commit made with the bash tool, staging only the files you changed (git add <path>...).`;
				startRun(ctx.cwd, baseSha, baseTree, prompt);
				pi.sendUserMessage(prompt);
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	// sendUserMessage is fire-and-forget: a run whose own prompt never started is disarmed by the next prompt that does.
	pi.on("input", (event) => notePrompt(event.text, false));
	pi.on("before_agent_start", (event) => notePrompt(event.prompt, true));

	pi.on("tool_execution_end", (event, ctx) => {
		try {
			if (!isRunArmed()) return;
			recordToolResult(
				recordFromToolResult({
					toolName: event.toolName,
					toolInput: {}, // tool_execution_end carries no args
					isError: event.isError,
					sha: currentSha(armedCwd() ?? ctx.cwd),
				}),
			);
		} catch {
			recordCaptureFailure(event.toolName); // fail closed: a dropped record must never read as "no failure"
		}
	});

	pi.on("agent_settled", (event, ctx) => {
		if (executeRunContext() !== undefined) return; // /execute owns the settle of its own run, whatever the load order
		try {
			settleQuickRun({ fallbackCwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted(), aborted: event.aborted, notify: (text, level) => ctx.ui.notify(text, level) });
		} catch {
			// Swallowed -- same rule as the tool_execution_end handler above.
		}
	});

	// An orphaned run (no agent_settled arrived) is disarmed before pruning.
	pi.on("session_start", (_event, ctx) => {
		clearQuickSettle();
		const orphan = endRun("", "");
		if (orphan !== undefined) writeRunEvidence(orphan.run, "reject", "the run was orphaned: no agent_settled arrived before a new session started");
		pruneEvidenceLogs(ctx.cwd);
	});
}
