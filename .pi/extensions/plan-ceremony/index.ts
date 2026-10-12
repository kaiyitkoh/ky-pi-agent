/**
 * /plan command: one entry point, no flags, SPEC-gated. Grammar and coverage rules live in the "plan-ceremony" skill and docs/WORKFLOWS.md.
 * Registers one command, zero tools; planning goes through pi.sendUserMessage, never a nested model call.
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

/** Derives the active slug when none was passed: exactly one `.pi/work/` dir with a SPEC.md resolves; zero or several refuse, naming candidates, so a plan is never written against the wrong spec. */
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

/** Mirrors grill/index.ts's SpecGateVerdict: two arms, never three. */
export type PlanGateVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** The only function that writes PLAN.md. Re-validates the on-disk SPEC.md, derives its requirement ids from §3, runs validatePlan, and writes only the re-rendered validated artifact, never the raw `markdown`. */
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
			// Order is the claim: git guard -> resolve slug -> pre-flight -> idle guard -> hand off.
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
