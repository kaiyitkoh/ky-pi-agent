/**
 * /quick settle: a run passes when it produced a commit, the working tree is that commit, and the deterministic change gate
 * finds no failing leg on base..HEAD. Runs once per run, at agent_settled, in the repo the run was armed against.
 */
import { runChangeGateStage } from "../quality/index.ts";
import { changedFiles, uncommittedPaths } from "../execute/progress.ts";
import { currentSha, currentTree } from "../safety/git.ts";
import { armedCwd, disarmRun, endRun, writeEvidenceRow } from "./evidence.ts";

const SETTLE_KEY = "__kypiQuickSettle";

interface QuickBase {
	readonly baseSha: string;
	readonly baseTypecheckFailed: boolean;
}

/** Remember what the settle step compares against; cleared by the settle itself. */
export function armQuickSettle(base: QuickBase): void {
	(globalThis as Record<string, unknown>)[SETTLE_KEY] = base;
}

export function clearQuickSettle(): void {
	(globalThis as Record<string, unknown>)[SETTLE_KEY] = undefined;
}

export interface QuickSettleInput {
	readonly fallbackCwd: string;
	readonly projectTrusted: boolean;
	readonly aborted: boolean;
	readonly notify: (text: string, level: "info" | "error") => void;
}

/** Ends the armed `/quick` run. An aborted run is disarmed with no verdict, no evidence row and nothing else recorded. */
export function settleQuickRun(input: QuickSettleInput): void {
	const base = (globalThis as Record<string, unknown>)[SETTLE_KEY] as QuickBase | undefined;
	if (base === undefined) return;
	clearQuickSettle();
	if (input.aborted) return disarmRun();
	const cwd = armedCwd() ?? input.fallbackCwd;
	let sha = "";
	let tree = "";
	try {
		sha = currentSha(cwd);
		tree = currentTree(cwd);
	} catch {
		// An unknown SHA or tree never matches, so the evidence gate rejects.
	}
	const verdict = endRun(sha, tree);
	if (verdict === undefined) return;
	if (!verdict.ok) return input.notify(verdict.reason, "error");
	try {
		// The gate legs read files from disk, so a tree that differs from the commit would gate the wrong content.
		const dirty = uncommittedPaths(cwd);
		if (dirty !== "") {
			const reason = `the working tree is not the commit (uncommitted or untracked: ${dirty}), so the gate would not check what was committed`;
			writeEvidenceRow(cwd, { verdict: "reject", reason, baseSha: base.baseSha, headSha: verdict.sha, recordCount: 0, tools: [], failedToolCalls: verdict.failedToolCalls });
			return input.notify(`quick: ${reason}`, "error");
		}
		const changed = changedFiles(cwd, base.baseSha, verdict.sha);
		const gate = runChangeGateStage({ cwd, projectTrusted: input.projectTrusted, baseSha: base.baseSha, changed, baseTypecheckFailed: base.baseTypecheckFailed });
		if (gate.failed) {
			const reason = `the deterministic gate fails on the change:\n${gate.report}`;
			writeEvidenceRow(cwd, { verdict: "reject", reason, baseSha: base.baseSha, headSha: verdict.sha, recordCount: 0, tools: [], failedToolCalls: verdict.failedToolCalls });
			return input.notify(`quick: ${reason}`, "error");
		}
		const scope = gate.ranAny ? gate.report.replace(/\n/g, "; ") : "no deterministic check applied to this change";
		input.notify(`quick: HEAD moved to ${verdict.sha}, a new commit on the base with a changed tree; ${verdict.failedToolCalls} failed tool call(s) logged; ${scope} -- the work itself is NOT verified`, "info");
	} catch (err) {
		input.notify(`quick: gate could not run on the change -- ${err instanceof Error ? err.message : String(err)}`, "error");
	}
}
