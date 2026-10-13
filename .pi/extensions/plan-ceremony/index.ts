/**
 * /plan command: one entry point, no flags, SPEC-gated. Grammar and coverage rules live in the "plan-ceremony" skill and docs/WORKFLOWS.md.
 * Registers one command, zero tools; planning goes through pi.sendUserMessage, never a nested model call.
 * While armed, each turn's PLAN.md is re-gated and re-rendered, and a refusal is handed to the next turn.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { workDir, workSlugs } from "../../lib/work-artifacts.ts";
import { commitRefusal } from "../execute/progress.ts";
import { validateGatedSpec } from "../grill/spec-gate.ts";
import { TURN_BUDGET, registerGatedTurns, type GatedRun } from "../grill/turns.ts";
import { renderPlanMarkdown, validatePlan } from "./plan-schema.ts";
import { extractSpecRequirementIds } from "./requirement-ids.ts";

const SPEC_FILE_NAME = "SPEC.md";
const PLAN_FILE_NAME = "PLAN.md";

/** Derives the active slug when none was passed: exactly one `.pi/work/` dir with a SPEC.md resolves; zero or several refuse, naming candidates, so a plan is never written against the wrong spec. */
function resolveSlug(cwd: string): string {
	const candidates = workSlugs(cwd, SPEC_FILE_NAME);
	if (candidates.length === 0) {
		throw new Error(`plan: no .pi/work/<slug>/${SPEC_FILE_NAME} found anywhere -- run /grill first, or pass a slug: /plan <slug>`);
	}
	if (candidates.length > 1) {
		throw new Error(`plan: more than one .pi/work/ slug carries a ${SPEC_FILE_NAME} (candidates: ${candidates.join(", ")}) -- pass one explicitly: /plan <slug>`);
	}
	return candidates[0] as string;
}

export type PlanGateVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** The only function that writes PLAN.md. Re-validates the on-disk SPEC.md, derives its requirement ids from §3, runs validatePlan, and writes only the re-rendered validated artifact, never the raw `markdown`. */
export function writePlanIfGated(cwd: string, slug: string, markdown: string): PlanGateVerdict {
	const dir = workDir(cwd, slug);
	const specPath = join(dir, SPEC_FILE_NAME);
	if (!existsSync(specPath)) {
		return { ok: false, reason: `.pi/work/${slug}/${SPEC_FILE_NAME} does not exist -- /plan cannot write without a gated SPEC` };
	}
	const specVerdict = validateGatedSpec(readFileSync(specPath, "utf-8"));
	if (!specVerdict.ok) return { ok: false, reason: specVerdict.reason };
	const planVerdict = validatePlan(markdown, extractSpecRequirementIds(specVerdict.spec.requirementsBody));
	if (!planVerdict.ok) return { ok: false, reason: planVerdict.reason };
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, PLAN_FILE_NAME), renderPlanMarkdown(planVerdict.plan), "utf-8");
	return { ok: true };
}

/** The hidden note for the next turn: the last gate rejection and, on the final turn, an instruction to write the file. */
function turnBrief(run: GatedRun): string | undefined {
	const lines = [
		...(run.lastReject === undefined ? [] : [`The last ${PLAN_FILE_NAME} was refused by the gate: ${run.lastReject}`]),
		...(run.turns === TURN_BUDGET - 1 ? [`This is the last turn: write ${PLAN_FILE_NAME} now.`] : []),
	];
	return lines.length === 0 ? undefined : lines.join(" ");
}

export default function (pi: ExtensionAPI): void {
	const arm = registerGatedTurns(pi, {
		workflow: "plan",
		file: PLAN_FILE_NAME,
		customType: "plan-gate",
		gate: writePlanIfGated,
		brief: turnBrief,
		spent: `${TURN_BUDGET} turns passed with no gated ${PLAN_FILE_NAME} -- run /plan again to continue`,
	});

	pi.registerCommand("plan", {
		description: "Turn a SPEC.md that has passed its own gate into a coverage-complete PLAN.md task list",
		handler: async (args, ctx) => {
			// Order is the claim: git guard -> resolve slug -> pre-flight -> idle guard -> hand off.
			let slug: string;
			let specPath: string;
			try {
				const refusal = commitRefusal(ctx.cwd);
				if (refusal !== undefined) return void ctx.ui.notify(refusal, "error");
				const arg = args.trim();
				slug = arg !== "" ? arg : resolveSlug(ctx.cwd);
				specPath = join(workDir(ctx.cwd, slug), SPEC_FILE_NAME);
			} catch (err) {
				return void ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
			if (!existsSync(specPath)) return void ctx.ui.notify(`plan: .pi/work/${slug}/${SPEC_FILE_NAME} does not exist -- run /grill first`, "error");
			const specVerdict = validateGatedSpec(readFileSync(specPath, "utf-8"));
			if (!specVerdict.ok) return void ctx.ui.notify(specVerdict.reason, "error");
			if (!ctx.isIdle()) return void ctx.ui.notify("plan: a turn is already in flight -- wait for it to finish", "error");

			arm(ctx.cwd, slug);
			pi.sendUserMessage(
				`Read the "plan-ceremony" skill before doing anything else, then write a PLAN.md task list for ` +
					`.pi/work/${slug}/SPEC.md, covering every requirement id declared in its §3. Work in .pi/work/${slug}/.`,
			);
		},
	});
}
