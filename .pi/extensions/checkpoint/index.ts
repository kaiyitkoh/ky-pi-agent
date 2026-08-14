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
 *     silently on `!ctx.hasUI`. It writes an AUDIT ROW naming the checkpoint
 *     SHA and the `/checkpoint-restore` command that reaches it.
 *     CORRECTED BY WR-16: this used to claim `ctx.ui.notify` made the
 *     headless branch observable. It does not. Pi's no-UI context is
 *     `noOpUIContext` at `dist/core/extensions/runner.js:88-119`, and its
 *     notify is literally `notify: () => { }` (line 92) -- VERIFIED against
 *     the installed 0.84.1, not inferred from `docs/extensions.md`. Nothing
 *     was emitted, logged or written, so the branch was behaviourally
 *     identical to the upstream `return` it was presented as fixing. The
 *     observable headless channel is a file, so it is now the audit log.
 *     THE PRIMARY headless-reachable path is still the registered command
 *     itself, which needs no event and no UI at all to run.
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

import { writeAuditRow } from "../safety/audit.ts";
import { createCheckpoint, dropCheckpointRef, repoTopLevel, restoreCheckpoint } from "./git.ts";
import { pruneCheckpoints, readCheckpoints, recordCheckpoint } from "./store.ts";

/**
 * The repository root for a session whose `ctx.cwd` may be a subdirectory
 * (WR-13), falling back to `ctx.cwd` when git cannot answer.
 *
 * Every parameter in `git.ts`/`store.ts` is named `repoRoot` and every call
 * site had `ctx.cwd`, which Pi does not guarantee is the repository root. The
 * consequences were not cosmetic: capture is whole-repo (`git add -A`) while
 * `git restore ... -- .` run from a subdirectory scopes the RESTORE to that
 * subdirectory, so the two were asymmetric with no indication; and `stateDir`
 * became `<subdir>/.pi/state`, which `.gitignore`'s root-anchored `.pi/state/`
 * entry does NOT ignore, making `checkpoints.json` -- absolute filesystem
 * paths and commit SHAs -- committable.
 *
 * Falls back rather than throwing: a session outside any repository is a
 * legitimate state, and `createCheckpoint` will fail there anyway inside the
 * `turn_start` handler's own catch.
 */
function rootFor(cwd: string): string {
	try {
		return repoTopLevel(cwd);
	} catch {
		return cwd;
	}
}

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
			const root = rootFor(ctx.cwd);
			// WR-14: the human-readable label is what goes into the store, not the
			// entry id. Before this, `label` was set to `currentEntryId` -- already
			// stored verbatim in the `entryId` field on the same row -- so the two
			// columns were duplicates and `/checkpoint-restore`'s listing showed a
			// column of opaque 8-hex ids next to a timestamp derived from
			// `Date.now()` rather than from the label the commit actually carries.
			const label = `turn ${new Date().toISOString()}`;
			const sha = createCheckpoint(root, label);
			recordCheckpoint(root, { sha, label, entryId: currentEntryId, cwd: root });
			// WR-10: bound the index, and drop the anchoring ref of every row the
			// bound evicts so the ref namespace cannot outgrow the store it mirrors.
			for (const dropped of pruneCheckpoints(root)) {
				dropCheckpointRef(root, dropped.sha);
			}
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
			const root = rootFor(ctx.cwd);
			const entries = readCheckpoints(root);
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
				restoreCheckpoint(root, match.sha);
				ctx.ui.notify(`checkpoint-restore: working tree restored to ${match.sha}`, "info");
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.on("session_before_fork", async (event, ctx) => {
		const root = rootFor(ctx.cwd);
		const entries = readCheckpoints(root);
		// WR-12: the OLDEST checkpoint recorded for this entry id, not the newest.
		// `currentEntryId` is updated only on `tool_result` while a checkpoint is
		// taken on every `turn_start`, so two or more consecutive turns with no
		// tool call in between record several checkpoints under the SAME entry id.
		// Forking AT entry E must restore the tree as it stood at E -- the first
		// checkpoint recorded once E was current -- not the tree at the start of
		// some later turn, which would silently include every change the user made
		// after E and overwrite their current tree with a NEWER snapshot.
		const match = entries.find((e) => e.entryId === event.entryId);
		if (!match) return undefined;

		if (!ctx.hasUI) {
			// DEFECT 1 FIX, CORRECTED BY WR-16. The original claim here was that
			// `ctx.ui.notify` is "safe to call with no UI attached" and therefore
			// makes the headless path "do something observable". The first half is
			// true and the conclusion was false: Pi's no-UI context is
			// `noOpUIContext` in `dist/core/extensions/runner.js:88-119`, whose
			// notify is literally `notify: () => { }` [VERIFIED at that file:line
			// against the installed 0.84.1]. Nothing was emitted, logged or written
			// anywhere -- the branch was behaviourally identical to the upstream
			// `if (!ctx.hasUI) { return; }` it was presented as fixing.
			//
			// The observable headless channel is a FILE, so this writes an audit
			// row through the writer this repository already has. `writeAuditRow`
			// never throws (safety/audit.ts's own contract), so this cannot turn a
			// fork into an exception.
			writeAuditRow(root, {
				event: "checkpoint_available_at_fork",
				tool: "checkpoint",
				command: `/checkpoint-restore ${match.sha}`,
				cwd: root,
				verdict: "allow",
				reason: `a checkpoint was recorded for this fork point (entryId ${event.entryId ?? "unknown"}); run the command to restore it`,
			});
			// Still called, because a UI-bearing context reached through this branch
			// (mode "rpc" with hasUI false is not a thing today, but the contract
			// does not forbid it) should say so -- it just is not the evidence.
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
				restoreCheckpoint(root, match.sha);
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
