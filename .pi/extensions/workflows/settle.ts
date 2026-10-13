/**
 * /quick settle: a run passes when it produced a commit, the working tree is that commit, and the deterministic change gate
 * finds no failing leg on base..HEAD. Runs once per run, at agent_settled, in the repo the run was armed against.
 */
import { runChangeGateStage } from "../quality/index.ts";
import { changedFiles, uncommittedPaths } from "../execute/progress.ts";
import { currentSha, currentTree } from "../safety/git.ts";
import { acceptedReason, armedCwd, disarmRun, endRun, writeRunEvidence } from "./evidence.ts";

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
	readonly notify: (text: string, level: "info" | "warning" | "error") => void;
}

/** Ends the armed `/quick` run with exactly one evidence row. An aborted run is disarmed with no verdict and no row. */
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
	const ended = endRun(sha, tree);
	if (ended === undefined) return;
	const finish = (verdict: "accept" | "reject" | "unverified", reason: string, text: string, level: "info" | "warning" | "error") => {
		writeRunEvidence(ended.run, verdict, reason);
		input.notify(text, level);
	};
	if (!ended.ok) return finish("reject", ended.reason, ended.reason, "error");
	try {
		// The gate legs read files from disk, so a tree that differs from the commit would gate the wrong content.
		const dirty = uncommittedPaths(cwd);
		if (dirty !== "") {
			const reason = `the working tree is not the commit (uncommitted or untracked: ${dirty}), so the gate would not check what was committed`;
			return finish("reject", reason, `quick: ${reason}`, "error");
		}
		const changed = changedFiles(cwd, base.baseSha, ended.sha);
		const gate = runChangeGateStage({ cwd, projectTrusted: input.projectTrusted, baseSha: base.baseSha, changed, baseTypecheckFailed: base.baseTypecheckFailed });
		if (gate.failed) {
			const reason = `the deterministic gate fails on the change:\n${gate.report}`;
			return finish("reject", reason, `quick: ${reason}`, "error");
		}
		if (!gate.ranAny) {
			const reason = `${acceptedReason(ended.run)}; no deterministic check applied to this change, so nothing verified it`;
			return finish("unverified", reason, `quick: UNVERIFIED -- ${reason}:\n${gate.report}`, "warning");
		}
		const legs = gate.report.replace(/\n/g, "; ");
		finish("accept", acceptedReason(ended.run), `quick: HEAD moved to ${ended.sha}, a new commit on the base with a changed tree; ${ended.failedToolCalls} failed tool call(s) logged; ${legs} -- the work itself is NOT verified`, "info");
	} catch (err) {
		const reason = `gate could not run on the change -- ${err instanceof Error ? err.message : String(err)}`;
		finish("reject", reason, `quick: ${reason}`, "error");
	}
}
