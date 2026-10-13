/**
 * A gated per-turn loop: while armed, each turn gets a hidden brief, and each settled turn re-gates the artifact the
 * model wrote, within one fixed turn budget. An Esc-aborted turn is not counted.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { claimWorkflow, isActiveWorkflow } from "../../lib/active-workflow.ts";
import { workDir } from "../../lib/work-artifacts.ts";
import { HARD_QUESTION_BUDGET } from "./scorecard.ts";

/** Five working turns plus the one that writes the artifact. */
export const TURN_BUDGET = HARD_QUESTION_BUDGET + 1;

export interface GatedRun {
	readonly cwd: string;
	readonly slug: string;
	/** Settled, non-aborted turns since the arm. */
	turns: number;
	lastMtime: number;
	lastReject?: string;
}

export interface GatedTurnsOptions {
	readonly workflow: string;
	readonly file: string;
	readonly customType: string;
	readonly gate: (cwd: string, slug: string, markdown: string) => { readonly ok: true } | { readonly ok: false; readonly reason: string };
	readonly brief: (run: GatedRun) => string | undefined;
	readonly spent: string;
}

/** Registers the loop's hooks and returns the arm function; a new session or another workflow's claim drops the run. */
export function registerGatedTurns(pi: ExtensionAPI, o: GatedTurnsOptions): (cwd: string, slug: string) => void {
	let run: GatedRun | undefined;
	const armed = (): GatedRun | undefined => (run = run !== undefined && isActiveWorkflow(o.workflow) ? run : undefined);

	pi.on("session_start", () => void (run = undefined));

	pi.on("before_agent_start", () => {
		const current = armed();
		const content = current === undefined ? undefined : o.brief(current);
		return content === undefined ? undefined : { message: { customType: o.customType, content, display: false } };
	});

	pi.on("agent_settled", (event, ctx) => {
		const current = armed();
		if (current === undefined || event.aborted) return;
		current.turns += 1;
		try {
			const file = join(workDir(current.cwd, current.slug), o.file);
			if (existsSync(file) && statSync(file).mtimeMs !== current.lastMtime) {
				const gated = o.gate(current.cwd, current.slug, readFileSync(file, "utf-8"));
				current.lastMtime = statSync(file).mtimeMs;
				if (gated.ok) {
					run = undefined;
					return void ctx.ui.notify(`${o.workflow}: .pi/work/${current.slug}/${o.file} passed every gate and was re-rendered`, "info");
				}
				current.lastReject = gated.reason;
				ctx.ui.notify(`${o.workflow}: ${o.file} refused -- ${gated.reason}`, "warning");
			}
			if (current.turns >= TURN_BUDGET) {
				run = undefined;
				ctx.ui.notify(`${o.workflow}: ${o.spent}`, "error");
			}
		} catch (err) {
			run = undefined;
			ctx.ui.notify(`${o.workflow}: gate not applied -- ${err instanceof Error ? err.message : String(err)}`, "error");
		}
	});

	return (cwd, slug) => {
		claimWorkflow(o.workflow);
		run = { cwd, slug, turns: 0, lastMtime: 0 };
	};
}
