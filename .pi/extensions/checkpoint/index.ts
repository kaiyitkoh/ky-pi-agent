/**
 * Vendored, hardened git-checkpoint extension. Re-authored from Pi's own bundled example: see PROVENANCE.md.
 * Registers a command (/checkpoint-restore), never a tool; headless restore needs no UI or event.
 * git.ts owns the mechanism, store.ts the persistence under .pi/state/. No agent_end clear: checkpoints survive reload.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { writeAuditRow } from "../safety/audit.ts";
import { createCheckpoint, dropCheckpointRef, repoTopLevel, restoreCheckpoint } from "./git.ts";
import { pruneCheckpoints, readCheckpoints, recordCheckpoint } from "./store.ts";

/** Repository root for a session whose cwd may be a subdirectory; falls back to cwd outside a repo. */
function rootFor(cwd: string): string {
	try {
		return repoTopLevel(cwd);
	} catch {
		return cwd;
	}
}

export default function (pi: ExtensionAPI): void {
	// Leaf entry id when a turn starts; session_before_fork looks checkpoints up by it.
	let currentEntryId: string | undefined;

	pi.on("tool_result", async (_event, ctx) => {
		const leaf = ctx.sessionManager.getLeafEntry();
		if (leaf) currentEntryId = leaf.id;
	});

	pi.on("turn_start", async (_event, ctx) => {
		try {
			const root = rootFor(ctx.cwd);
			const label = `turn ${new Date().toISOString()}`;
			const sha = createCheckpoint(root, label);
			recordCheckpoint(root, { sha, label, entryId: currentEntryId, cwd: root });
			// Bound the index and drop the anchoring ref of every evicted row.
			for (const dropped of pruneCheckpoints(root)) {
				dropCheckpointRef(root, dropped.sha);
			}
		} catch {
			// A checkpoint that cannot be taken (e.g. unborn HEAD) must never break the turn.
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
				// The restore deletes post-checkpoint files, so tell the user the undo SHA and the removed paths.
				const outcome = restoreCheckpoint(root, match.sha);
				ctx.ui.notify(
					`checkpoint-restore: working tree restored to ${match.sha}\n` +
						`${outcome.removed.length} file(s) removed as absent from that checkpoint` +
						(outcome.removed.length > 0 ? `: ${outcome.removed.join(", ")}` : "") +
						`\nundo with /checkpoint-restore ${outcome.undoSha}`,
					"info",
				);
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.on("session_before_fork", async (event, ctx) => {
		const root = rootFor(ctx.cwd);
		const entries = readCheckpoints(root);
		// Oldest checkpoint for this entry id: several turns without a tool call share one id, and the fork point is the first.
		const match = entries.find((e) => e.entryId === event.entryId);
		if (!match) return undefined;

		if (!ctx.hasUI) {
			// Pi's no-UI notify is a no-op (dist/core/extensions/runner.js:92), so the observable headless channel is the audit log.
			// writeAuditRow never throws, so this cannot turn a fork into an exception.
			writeAuditRow(root, {
				event: "checkpoint_available_at_fork",
				tool: "checkpoint",
				command: `/checkpoint-restore ${match.sha}`,
				cwd: root,
				verdict: "allow",
				reason: `a checkpoint was recorded for this fork point (entryId ${event.entryId ?? "unknown"}); run the command to restore it`,
			});
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
				const outcome = restoreCheckpoint(root, match.sha);
				ctx.ui.notify(
					`Code restored to checkpoint (${outcome.removed.length} file(s) removed) -- ` +
						`undo with /checkpoint-restore ${outcome.undoSha}`,
					"info",
				);
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		}
		return undefined;
	});
}
