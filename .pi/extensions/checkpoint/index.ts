/**
 * EXT-07 — vendored, hardened `git-checkpoint` extension.
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE
 * ---------------------------------------------------------------------------
 * Re-authored from Pi's own bundled example,
 * `@earendil-works/pi-coding-agent@0.84.1`
 * `examples/extensions/git-checkpoint.ts` (53 lines), read in full before any
 * change was made. That file's own header: "Creates git stash checkpoints at
 * each turn so /fork can restore code state." All three of its cited defects
 * are addressed here; this file owns defect 1 and the overall wiring, `git.ts`
 * owns defect 2's mechanism, `store.ts` owns defect 3's persistence:
 *
 *   git-checkpoint.ts:33-36
 *     if (!ctx.hasUI) { return; }
 *     Does NOTHING headless -- the exact "a guard that was entirely absent
 *     headless" failure this project's Phase 4 review already hit once.
 *     FIX HERE: the `session_before_fork` handler below never returns
 *     silently on `!ctx.hasUI`. It calls `ctx.ui.notify` (safe to call with
 *     no UI attached -- `ctx.ui` is a no-op-but-present context in that case,
 *     per `docs/extensions.md`'s `ExtensionContext.ui` contract) naming the
 *     checkpoint SHA and the `/checkpoint-restore` command that reaches it.
 *     THE PRIMARY headless-reachable path is the registered command itself,
 *     which needs no event and no UI at all to run.
 *
 *   git-checkpoint.ts:22
 *     pi.exec("git", ["stash", "create"])
 *     No untracked-file handling -- `.env`-class untracked work is silently
 *     never captured. FIX: `git.ts#createCheckpoint`, called from `turn_start`
 *     below, uses the GIT_INDEX_FILE + write-tree + commit-tree mechanism
 *     instead (see `git.ts`'s own docstring for the measured comparison).
 *
 *   git-checkpoint.ts:11,29,49-51
 *     `const checkpoints = new Map<string, string>();` ... `checkpoints.clear()`
 *     on `agent_end`. Nothing survives `/reload` or a process restart, and
 *     restore is offered ONLY from `session_before_fork`. FIX: `store.ts`
 *     persists every checkpoint under `.pi/state/` (gitignored, durable), and
 *     this file registers NO `agent_end` clear at all -- a checkpoint recorded
 *     this turn is still findable and restorable next process.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE REGISTERS -- A COMMAND, NEVER A TOOL (BOOT-10)
 * ---------------------------------------------------------------------------
 * `/checkpoint-restore [sha]` is the sanctioned zero-cost surface
 * (CONTRIBUTING.md's boundary rule): with no argument it lists every recorded
 * checkpoint; with a SHA (full or a prefix) it restores the working tree to
 * that checkpoint via `git.ts#restoreCheckpoint`. This is what makes restore
 * reachable with NO UI and NO `session_before_fork` at all -- a command runs
 * on its own, driven directly, independent of any event.
 *
 * This module registers no tool of any kind, and does not spell the
 * tool-registration call even in a comment (`tests/unit/contributing-
 * boundary.test.ts` matches that name as a plain substring across every
 * tracked source under `.pi/extensions/`, with no new
 * `TOOL_REGISTRATION_ALLOWLIST` entry needed here).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createCheckpoint, restoreCheckpoint } from "./git.ts";
import { readCheckpoints, recordCheckpoint } from "./store.ts";

export default function (pi: ExtensionAPI): void {
	// Tracks the current session entry id, exactly the way the bundled example
	// does -- the leaf entry at the moment a turn starts is what a later
	// `session_before_fork` on that same entry id should be able to look up.
	let currentEntryId: string | undefined;

	pi.on("tool_result", async (_event, ctx) => {
		const leaf = ctx.sessionManager.getLeafEntry();
		if (leaf) currentEntryId = leaf.id;
	});

	pi.on("turn_start", async (_event, ctx) => {
		try {
			const sha = createCheckpoint(ctx.cwd, `turn ${new Date().toISOString()}`);
			recordCheckpoint(ctx.cwd, { sha, label: currentEntryId ?? "(no entry yet)", entryId: currentEntryId, cwd: ctx.cwd });
		} catch {
			// A checkpoint that cannot be taken (e.g. an unborn HEAD, no commits
			// yet) must never break the turn it was meant to protect. Mirrors
			// `safety/audit.ts#writeAuditRow`'s never-throw contract.
		}
	});

	pi.registerCommand("checkpoint-restore", {
		description:
			"List recorded working-tree checkpoints, or restore one by SHA (or SHA prefix). Works with no UI.",
		handler: async (args, ctx) => {
			const entries = readCheckpoints(ctx.cwd);
			const target = args.trim();

			if (target === "") {
				if (entries.length === 0) {
					ctx.ui.notify("checkpoint-restore: no checkpoints recorded yet", "info");
					return;
				}
				const lines = entries.map(
					(e) => `${e.sha.slice(0, 12)}  ${new Date(e.ts).toISOString()}  ${e.label}`,
				);
				ctx.ui.notify(`checkpoint-restore: ${entries.length} recorded\n${lines.join("\n")}`, "info");
				return;
			}

			const match = entries.find((e) => e.sha === target || e.sha.startsWith(target));
			if (!match) {
				ctx.ui.notify(`checkpoint-restore: no checkpoint matches "${target}"`, "error");
				return;
			}
			try {
				restoreCheckpoint(ctx.cwd, match.sha);
				ctx.ui.notify(`checkpoint-restore: working tree restored to ${match.sha}`, "info");
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.on("session_before_fork", async (event, ctx) => {
		const entries = readCheckpoints(ctx.cwd);
		// Most recent checkpoint recorded for this entry id, if any.
		let match: (typeof entries)[number] | undefined;
		for (let i = entries.length - 1; i >= 0; i--) {
			if (entries[i]?.entryId === event.entryId) {
				match = entries[i];
				break;
			}
		}
		if (!match) return undefined;

		if (!ctx.hasUI) {
			// DEFECT 1 FIX: never return silently headless. Names the checkpoint and
			// the command that reaches it, so the headless path does something
			// observable, matching this project's own SAFE-* posture on fail-open
			// guards ("a guard that was entirely absent headless").
			ctx.ui.notify(
				`checkpoint available for this fork point: ${match.sha} -- run /checkpoint-restore ${match.sha} to restore it`,
				"info",
			);
			return undefined;
		}

		const choice = await ctx.ui.select("Restore code state to this checkpoint?", [
			"Yes, restore code to that point",
			"No, keep current code",
		]);
		if (choice?.startsWith("Yes")) {
			try {
				restoreCheckpoint(ctx.cwd, match.sha);
				ctx.ui.notify("Code restored to checkpoint", "info");
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		}
		return undefined;
	});

	// Deliberately NO `agent_end` handler that clears anything. Defect 3's fix:
	// a checkpoint recorded this turn stays in `.pi/state/checkpoints.json`
	// after the agent settles, across `/reload`, and across a process restart.
}
