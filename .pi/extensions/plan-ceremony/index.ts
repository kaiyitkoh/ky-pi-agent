/**
 * FLOW-06 -- the /plan command. One entry point, no flags, SPEC-gated. The
 * task-form grammar, the coverage-matrix rule and the three PLAN.md parts
 * live in the "plan-ceremony" skill (.pi/skills/plan-ceremony/SKILL.md,
 * loaded on demand) and docs/WORKFLOWS.md (plan 09-17). Terseness here IS
 * the WORKFLOW_TEXT_BUDGETS ceiling being honoured -- 200 raw lines total
 * (this file plus the skill body), the tightest of the four ceremonial
 * ceilings, matching grill/index.ts's own header discipline.
 *
 * CHOKEPOINT HYGIENE (DIAG-03 / QUAL-02): this file never reaches a model
 * directly -- planning is handed to the ordinary prompt loop via
 * pi.sendUserMessage, never a nested model call. It does not spell, even in
 * a comment, any of the bypass routes tests/unit/chokepoint-lint.test.ts
 * enumerates for DIAG-03.
 *
 * BOUNDARY RULE (BOOT-10): registers exactly one command, zero tools. Does
 * not spell the tool-registration call, in code or in prose.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { workDir } from "../../lib/work-artifacts.ts";
import { validateSpec } from "../grill/spec-schema.ts";
import { classifyGitInvocation, currentBranch } from "../safety/git.ts";
import { PROTECTED_BRANCHES } from "../safety/index.ts";
import { renderPlanMarkdown, validatePlan } from "./plan-schema.ts";
import { extractSpecRequirementIds } from "./requirement-ids.ts";

/** The artifact this command reads. */
const SPEC_FILE_NAME = "SPEC.md";
/** The one artifact this command ever writes. */
const PLAN_FILE_NAME = "PLAN.md";

/** Every `.pi/work/` subdirectory holding a SPEC.md, most-recently-modified first. */
function candidateSlugsWithSpec(cwd: string): readonly { readonly name: string; readonly mtime: number }[] {
	const root = resolve(join(cwd, ".pi", "work"));
	if (!existsSync(root)) {
		return [];
	}
	return readdirSync(root, { withFileTypes: true })
		.filter((e) => e.isDirectory() && existsSync(join(root, e.name, SPEC_FILE_NAME)))
		.map((e) => ({ name: e.name, mtime: statSync(join(root, e.name)).mtimeMs }))
		.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Derives the active slug when none was passed as an argument: exactly one
 * `.pi/work/` subdirectory carrying a SPEC.md resolves silently; zero or
 * more than one REFUSES, naming every candidate -- a silent pick among
 * several is how a plan gets written against the wrong spec [T-09-10-02].
 */
function resolveSlug(cwd: string): string {
	const candidates = candidateSlugsWithSpec(cwd);
	if (candidates.length === 0) {
		throw new Error(
			`plan: no .pi/work/<slug>/${SPEC_FILE_NAME} found anywhere -- run /grill first, or pass a slug: /plan <slug>`,
		);
	}
	if (candidates.length > 1) {
		throw new Error(
			`plan: more than one .pi/work/ slug carries a ${SPEC_FILE_NAME} (candidates: ${candidates.map((c) => c.name).join(", ")}) -- pass one explicitly: /plan <slug>`,
		);
	}
	const only = candidates[0];
	if (only === undefined) {
		throw new Error("plan: internal error resolving the single candidate slug");
	}
	return only.name;
}

/** Mirrors grill/index.ts's SpecGateVerdict: deliberately two arms, never three. */
export type PlanGateVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * The ONLY function in this subsystem that writes PLAN.md. Re-reads and
 * re-validates the on-disk SPEC.md rather than trusting a prior verdict --
 * the same discipline grill/index.ts's writeSpecIfGated documents for
 * SPEC.md [T-09-10-01] -- derives the SPEC's own requirement ids from its §3
 * body, then runs validatePlan before ever writing. Only
 * renderPlanMarkdown's re-rendering of the VALIDATED artifact ever reaches
 * writeFileSync, never the raw `markdown` parameter.
 */
export function writePlanIfGated(cwd: string, slug: string, markdown: string): PlanGateVerdict {
	const dir = workDir(cwd, slug);
	const specPath = join(dir, SPEC_FILE_NAME);
	if (!existsSync(specPath)) {
		return { ok: false, reason: `.pi/work/${slug}/${SPEC_FILE_NAME} does not exist -- /plan cannot write without a gated SPEC` };
	}
	const specVerdict = validateSpec(readFileSync(specPath, "utf-8"));
	if (!specVerdict.ok) {
		return { ok: false, reason: specVerdict.reason };
	}
	const planVerdict = validatePlan(markdown, extractSpecRequirementIds(specVerdict.spec.requirementsBody));
	if (!planVerdict.ok) {
		return { ok: false, reason: planVerdict.reason };
	}
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, PLAN_FILE_NAME), renderPlanMarkdown(planVerdict.plan), "utf-8");
	return { ok: true };
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("plan", {
		description: "Turn a SPEC.md that has passed its own gate into a coverage-complete PLAN.md task list",
		handler: async (args, ctx) => {
			// Order is the whole claim: git guard -> resolve slug -> pre-flight -> idle guard -> hand off.
			const verdict = classifyGitInvocation(
				{ subcommand: "commit", args: [] },
				{ currentBranch: currentBranch(ctx.cwd), protectedBranches: PROTECTED_BRANCHES },
			);
			if (verdict.kind === "block") return void ctx.ui.notify(verdict.reason, "error");

			let slug: string;
			let specPath: string;
			try {
				const arg = args.trim();
				slug = arg !== "" ? arg : resolveSlug(ctx.cwd);
				specPath = join(workDir(ctx.cwd, slug), SPEC_FILE_NAME);
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
				return;
			}

			if (!existsSync(specPath)) {
				return void ctx.ui.notify(`plan: .pi/work/${slug}/${SPEC_FILE_NAME} does not exist -- run /grill first`, "error");
			}

			const specVerdict = validateSpec(readFileSync(specPath, "utf-8"));
			if (!specVerdict.ok) return void ctx.ui.notify(specVerdict.reason, "error");

			if (!ctx.isIdle()) return void ctx.ui.notify("plan: a turn is already in flight -- wait for it to finish", "error");

			pi.sendUserMessage(
				`Read the "plan-ceremony" skill before doing anything else, then write a PLAN.md task list for ` +
					`.pi/work/${slug}/SPEC.md, covering every requirement id declared in its §3. Work in .pi/work/${slug}/.`,
			);
		},
	});
}
