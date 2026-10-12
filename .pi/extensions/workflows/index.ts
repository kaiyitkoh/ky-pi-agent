/**
 * /quick -- a Pi COMMAND, never a tool. Composes routing, git safety and the evidence gate; reimplements none.
 * Rationale and the dispatch order's findings live in docs/WORKFLOWS.md; this header stays short for the line budget.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { refundQualityCost } from "../diagnostics/quality-cost.ts";
import { runQuickGateStage } from "../quality/index.ts";
import { getModeState, planRoleCall } from "../routing/modes.ts";
import { classifyGitInvocation, currentBranch, currentSha, currentTree } from "../safety/git.ts";
import { PROTECTED_BRANCHES } from "../safety/index.ts";
import { armedCwd, endRun, isRunArmed, pruneEvidenceLogs, recordCaptureFailure, recordFromToolResult, recordToolResult, startRun } from "./evidence.ts";

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
			const plan = planRoleCall(ctx.modelRegistry, { role: "executor", state: getModeState(), need: {} });
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
				if (isRunArmed() || !ctx.isIdle()) return void ctx.ui.notify("quick: a turn is already in flight -- wait for it to finish", "error");
				// Trust reaches the gate stage so an untrusted cwd's node_modules/.bin is never spawned.
				const gate = runQuickGateStage(ctx.cwd, ctx.isProjectTrusted());
				if (gate.blocking) {
					// Refund only this gate's own cost: draining the ledger would erase other contributors in the same turn.
					refundQualityCost({ ms: gate.totalMs });
					return void ctx.ui.notify(gate.report, "error");
				}
				startRun(ctx.cwd, currentSha(ctx.cwd), currentTree(ctx.cwd)); // baseTree captured in the same try, so a throw refuses via the catch and never arms a run
				pi.sendUserMessage(`${task}\n\nEnd this work in exactly one atomic commit made with the bash tool.`);
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

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

	pi.on("agent_end", (_event, ctx) => {
		let sha = ""; // currentSha fails closed by design (safety/git.ts:171)
		let tree = ""; // same fail-closed contract: an empty tree or sha never matches, so the gate rejects
		try { sha = currentSha(armedCwd() ?? ctx.cwd); tree = currentTree(armedCwd() ?? ctx.cwd); } catch { /* gate rejects on unknown SHA/tree below */ }
		try {
			const verdict = endRun(sha, tree);
			// Accept wording states what was checked (HEAD moved), never that a commit landed.
			if (verdict !== undefined) ctx.ui.notify(verdict.ok ? `quick: HEAD moved to ${verdict.sha} with a changed tree and no failed tool result -- no commit was verified and the work itself is NOT verified` : verdict.reason, verdict.ok ? "info" : "error");
		} catch {
			// Swallowed -- same rule as the tool_execution_end handler above.
		}
	});

	// endRun("") disarms an orphaned run (no agent_end arrived) before pruning; no-op when nothing is armed.
	pi.on("session_start", (_event, ctx) => { endRun("", ""); pruneEvidenceLogs(ctx.cwd); });
}
