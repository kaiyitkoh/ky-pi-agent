/**
 * /quick -- the walking skeleton. A Pi COMMAND, never a tool: see
 * CONTRIBUTING.md's boundary rule. Composes Phase 5 routing, Phase 4 git
 * safety and the Phase 6 evidence gate; reimplements none of them. This
 * header is deliberately short -- the rationale, the dispatch order's two
 * load-bearing findings, and the line-budget rule all live in
 * docs/WORKFLOWS.md. Terseness here IS the FLOW-01 budget being honoured,
 * not an oversight.
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
				const gate = runQuickGateStage(ctx.cwd);
				if (gate.blocking) {
					// WR-06: refund ONLY this gate's own cost -- takeQualityCost() would
					// drain the WHOLE ledger, erasing any OTHER contributor (e.g. a
					// reviewer + refute pass) already recorded earlier in this SAME
					// still-in-progress turn. (i) this gate's own cost must not bill a
					// later, unrelated turn; (ii) refundQualityCost clears the slot only
					// when nothing is left, never fabricates a zero (DIAGNOSTICS.md's
					// omission rule); (iii) the SAME cost IS measured on the clean-run
					// path below; (iv) a deliberate SECOND ledger call site outside
					// diagnostics/, per 08-04's T-08-13 (no turn row composes here).
					refundQualityCost({ ms: gate.totalMs });
					return void ctx.ui.notify(gate.report, "error");
				}
				startRun(ctx.cwd, currentSha(ctx.cwd), currentTree(ctx.cwd)); // GATE-01: baseTree captured in the same try, so a throw refuses via the catch below and never arms a run
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
					toolInput: {}, // tool_execution_end carries no args; `command` has no consumer (IN-04)
					isError: event.isError,
					sha: currentSha(armedCwd() ?? ctx.cwd),
				}),
			);
		} catch {
			recordCaptureFailure(event.toolName); // CR-01 iter3: fail closed -- a dropped record must never read as "no failure"
		}
	});

	pi.on("agent_end", (_event, ctx) => {
		let sha = ""; // WR-02: currentSha fails closed by design (safety/git.ts:171)
		let tree = ""; // GATE-01: same fail-closed contract as sha -- an empty tree never matches a real baseTree, so branch (6) never falsely fires, and an empty sha still rejects at branch (4)
		try { sha = currentSha(armedCwd() ?? ctx.cwd); tree = currentTree(armedCwd() ?? ctx.cwd); } catch { /* gate rejects on unknown SHA/tree below */ }
		try {
			const verdict = endRun(sha, tree);
			// CR-01 iter4: accept wording states what was checked (HEAD moved), never that a commit landed.
			if (verdict !== undefined) ctx.ui.notify(verdict.ok ? `quick: HEAD moved to ${verdict.sha} with a changed tree and no failed tool result -- no commit was verified and the work itself is NOT verified` : verdict.reason, verdict.ok ? "info" : "error");
		} catch {
			// Swallowed -- same rule as the tool_execution_end handler above.
		}
	});

	// WR-02 iter3: endRun("") disarms an orphaned run (no agent_end ever arrived) before pruning; a no-op when nothing is armed.
	pi.on("session_start", (_event, ctx) => { endRun("", ""); pruneEvidenceLogs(ctx.cwd); });
}
