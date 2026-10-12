/**
 * /review: builds the reviewer's six-part contract from artifacts on disk, runs the existing review mechanisms,
 * writes REVIEW.md and opens the MR through the glab classifier. Registers one command, zero tools.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { workDir } from "../../lib/work-artifacts.ts";
import { validateGatedSpec } from "../grill/spec-gate.ts";
import { extractSpecRequirementIds } from "../plan-ceremony/requirement-ids.ts";
import { validatePlan } from "../plan-ceremony/plan-schema.ts";
import { gateDepthFor } from "../quality/gates.ts";
import { runQuickGateStage } from "../quality/index.ts";
import { buildImportGraph, runReview, type ReviewerContractInput } from "../quality/reviewer.ts";
import { renderReviewMarkdown, type ReviewArtifact } from "../quality/review-schema.ts";
import { decideWorkflowStop, runRefuteOrPromote } from "../quality/verdict.ts";
import { classifyGitInvocation, currentBranch } from "../safety/git.ts";
import { PROTECTED_BRANCHES } from "../safety/index.ts";
import { MR_TARGET_BRANCH, buildMrBody, historyMismatch, openMr, sanitizeTitle, spawnExec, upstreamMismatch } from "./mr.ts";
import { changedFilesSince, compareScope } from "./scope-drift.ts";

function slugsWithProgress(cwd: string): string[] {
	const root = resolve(join(cwd, ".pi", "work"));
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter((e) => e.isDirectory() && existsSync(join(root, e.name, "PROGRESS.md")))
		.sort((a, b) => statSync(join(root, b.name)).mtimeMs - statSync(join(root, a.name)).mtimeMs)
		.map((e) => e.name);
}

const GIT_MAX_BUFFER_BYTES = 67_108_864;
function git(cwd: string, args: string[]): string {
	const r = spawnSync("git", args, { cwd, encoding: "utf-8", shell: false, windowsHide: true, maxBuffer: GIT_MAX_BUFFER_BYTES });
	if (r.status !== 0) throw new Error(`review: git ${args.join(" ")} failed (exit ${r.status}): ${r.stderr ?? ""}`);
	return r.stdout ?? "";
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("review", {
		description: "Review the change against SPEC and PLAN, write REVIEW.md, and open an MR against staging",
		handler: async (args, ctx) => {
			const fail = (msg: string) => void ctx.ui.notify(msg, "error");
			try {
				const arg = args.trim();
				const candidates = slugsWithProgress(ctx.cwd);
				if (arg === "" && candidates.length !== 1) {
					return fail(candidates.length === 0 ? "review: no .pi/work/<slug>/PROGRESS.md found -- run /execute first" : `review: several runs exist (${candidates.join(", ")}) -- pass one: /review <slug>`);
				}
				const slug = arg !== "" ? arg : (candidates[0] as string);
				const dir = workDir(ctx.cwd, slug);

				const verdict = classifyGitInvocation({ subcommand: "commit", args: [] }, { currentBranch: currentBranch(ctx.cwd), protectedBranches: PROTECTED_BRANCHES });
				if (verdict.kind === "block") return fail(verdict.reason);

				for (const f of ["SPEC.md", "PLAN.md", "PROGRESS.md"]) {
					if (!existsSync(join(dir, f))) return fail(`review: .pi/work/${slug}/${f} does not exist`);
				}
				const spec = validateGatedSpec(readFileSync(join(dir, "SPEC.md"), "utf-8"));
				if (!spec.ok) return fail(spec.reason);
				const ids = extractSpecRequirementIds(spec.spec.requirementsBody);
				const plan = validatePlan(readFileSync(join(dir, "PLAN.md"), "utf-8"), ids);
				if (!plan.ok) return fail(plan.reason);
				const progress = readFileSync(join(dir, "PROGRESS.md"), "utf-8");
				const mismatch = historyMismatch(ctx.cwd, plan.plan.tasks.map((t) => t.id), progress);
				if (mismatch !== undefined) return fail(`review: ${mismatch}`);

				const mechanisms = gateDepthFor("review").mechanisms;
				// Calibration scores seeded-defect fixtures and has no meaning for a live diff, so it is never announced here.
				ctx.ui.notify(`review: running ${mechanisms.filter((m) => m !== "calibration").join(", ")}`, "info");

				let gateReport = "The deterministic stage is outside this workflow's gate depth and did not run.";
				if (mechanisms.includes("deterministic")) {
					const gate = runQuickGateStage(ctx.cwd, ctx.isProjectTrusted());
					if (gate.blocking) return fail(`review: the deterministic gate fails at HEAD -- not reviewing:\n${gate.report}`);
					gateReport = gate.report;
				}

				const base = git(ctx.cwd, ["merge-base", "HEAD", MR_TARGET_BRANCH]).trim();
				const changed = changedFilesSince(ctx.cwd, base);
				const touched = changed.filter((p) => existsSync(join(ctx.cwd, p))).map((p) => ({ path: p, contents: readFileSync(join(ctx.cwd, p), "utf-8") }));
				const filesTouchedUnion = [...new Set([...spec.spec.scopePin.expectedFiles, ...plan.plan.filesTouched])];
				const contract: ReviewerContractInput = {
					diff: git(ctx.cwd, ["diff", `${base}..HEAD`]),
					touchedFiles: touched,
					gateReport,
					requirements: ids.map((id) => ({ id, text: (spec.spec.requirementsBody.split("\n").find((l) => new RegExp(`\\b${id}\\b`).test(l)) ?? id).trim() })),
					filesTouchedUnion,
					importGraph: buildImportGraph(touched.filter((t) => /\.[cm]?[tj]sx?$/.test(t.path)).map((t) => ({ path: t.path, text: t.contents }))),
				};

				if (!mechanisms.includes("model-review")) return fail("review: gate depth for review excludes the model review");
				const reviewed = await runReview(ctx, { contract, requirementIds: ids });
				if (!reviewed.ok) return fail(reviewed.reason);

				// The stop decision runs on the post-refutation review, so BLOCKERs are rebuilt first.
				let review: ReviewArtifact = reviewed.review;
				if (mechanisms.includes("refute-or-promote")) {
					const { promoted } = await runRefuteOrPromote(ctx, review, contract);
					review = { ...review, findings: [...review.findings.filter((f) => f.severity !== "BLOCKER"), ...promoted] };
				}
				review = { ...review, scopeDrift: compareScope({ changed, specExpectedFiles: spec.spec.scopePin.expectedFiles, planFilesTouched: plan.plan.filesTouched }) };

				writeFileSync(join(dir, "REVIEW.md"), renderReviewMarkdown(review), "utf-8");
				ctx.ui.notify(`review: wrote .pi/work/${slug}/REVIEW.md`, "info");

				const stop = decideWorkflowStop(review);
				if (stop.stop && !stop.needsApproval) return fail(`review: not opening an MR -- ${stop.reason}`);
				const drifted = review.scopeDrift?.drifted ?? [];
				const reasons = [...(stop.stop ? [stop.reason] : []), ...(drifted.length > 0 ? [`changed but not declared in SPEC or PLAN: ${drifted.join(", ")}`] : [])];
				if (reasons.length > 0) {
					const approved = await ctx.ui.confirm("Open the MR anyway?", reasons.join("\n"));
					if (!approved) return void ctx.ui.notify("review: MR not opened -- approval declined", "warning");
				}

				const unpushed = upstreamMismatch(ctx.cwd);
				if (unpushed !== undefined) return fail(`review: MR not opened -- ${unpushed}`);
				const body = buildMrBody({ spec: spec.spec, plan: plan.plan, progress, review });
				const title = sanitizeTitle(spec.spec.goal.split("\n")[0] ?? "");
				const out = openMr({ targetBranch: MR_TARGET_BRANCH, title, body }, { exec: spawnExec(ctx.cwd, undefined) });
				if (out.kind === "refused") return fail(`review: MR refused -- ${out.reason}`);
				if (out.kind === "failed") return fail(`review: glab exited ${out.code}: ${out.stderr}`);
				ctx.ui.notify(`review: MR opened against ${MR_TARGET_BRANCH}\n${out.stdout}`, "info");
			} catch (err) {
				fail(err instanceof Error ? err.message : String(err));
			}
		},
	});
}
