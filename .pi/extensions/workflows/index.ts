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
import { getModeState, planRoleCall } from "../routing/modes.ts";
import { classifyGitInvocation, currentBranch, currentSha } from "../safety/git.ts";
import { PROTECTED_BRANCHES } from "../safety/index.ts";
import { armedCwd, endRun, isRunArmed, recordFromToolResult, recordToolResult, startRun } from "./evidence.ts";

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
				if (verdict.kind === "block") {
					ctx.ui.notify(verdict.reason, "error");
					return;
				}
				if (isRunArmed()) return void ctx.ui.notify("quick: a run is already in flight -- wait for its verdict", "error");
				startRun(ctx.cwd, currentSha(ctx.cwd));
				pi.sendUserMessage(`${task}\n\nEnd this work in exactly one atomic commit made with the bash tool.`);
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.on("tool_result", (event, ctx) => {
		try {
			if (!isRunArmed()) return;
			recordToolResult(
				recordFromToolResult({
					toolName: event.toolName,
					toolInput: event.input,
					isError: event.isError,
					sha: currentSha(armedCwd() ?? ctx.cwd),
				}),
			);
		} catch {
			// Swallowed -- a capture failure must never break a tool result.
		}
	});

	pi.on("agent_end", (_event, ctx) => {
		try {
			const verdict = endRun(currentSha(armedCwd() ?? ctx.cwd));
			if (verdict === undefined) return;
			ctx.ui.notify(verdict.ok ? `quick: evidence accepted at ${verdict.sha}` : verdict.reason, verdict.ok ? "info" : "error");
		} catch {
			// Swallowed -- same rule as the tool_result handler above.
		}
	});
}
