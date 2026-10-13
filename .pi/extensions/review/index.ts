/**
 * /review: builds the reviewer's six-part contract from artifacts on disk, runs the existing review mechanisms,
 * writes REVIEW.md and opens the MR through the glab classifier. Registers one command, zero tools.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { claimWorkflow } from "../../lib/active-workflow.ts";
import { workDir, workSlugs } from "../../lib/work-artifacts.ts";
import { acceptedEntries, allowanceOf, latestRepin, pinRefusal, readLedger, tasksOf } from "../execute/ledger.ts";
import { git } from "../execute/git-run.ts";
import { commitRefusal, ensureHarnessIgnored, uncommittedPaths } from "../execute/progress.ts";
import { validateGatedSpec } from "../grill/spec-gate.ts";
import { extractSpecRequirementIds } from "../plan-ceremony/requirement-ids.ts";
import { validatePlan } from "../plan-ceremony/plan-schema.ts";
import { computeDesignSignals, runDesignReview } from "../quality/design-review.ts";
import { gateDepthFor, shouldRunDesignReview } from "../quality/gates.ts";
import { runChangeGateStage, typecheckBaseline } from "../quality/index.ts";
import { buildImportGraph, runReview, type ReviewerContractInput } from "../quality/reviewer.ts";
import { renderReviewMarkdown, type ReviewArtifact } from "../quality/review-schema.ts";
import { decideWorkflowStop, runRefuteOrPromote } from "../quality/verdict.ts";
import { currentBranch } from "../safety/git.ts";
import { getModeState } from "../routing/modes.ts";
import { MR_TARGET_BRANCH, buildMrBody, historyMismatch, openMr, sanitizeTitle, spawnExec, upstreamMismatch } from "./mr.ts";
import { changedFilesSince, compareScope, readTouchedFiles, resolveBaseRef } from "./scope-drift.ts";

function gitOrThrow(cwd: string, args: string[]): string {
	const r = git(cwd, args);
	if (r.status !== 0) throw new Error(`review: git ${args.join(" ")} failed (exit ${r.status}): ${r.stderr}`);
	return r.out;
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("review", {
		description: "Review the change against SPEC and PLAN, write REVIEW.md, and open an MR against staging",
		handler: async (args, ctx) => {
			const fail = (msg: string) => void ctx.ui.notify(msg, "error");
			try {
				const arg = args.trim();
				const candidates = workSlugs(ctx.cwd, "PROGRESS.md");
				if (arg === "" && candidates.length !== 1) {
					return fail(candidates.length === 0 ? "review: no .pi/work/<slug>/PROGRESS.md found -- run /execute first" : `review: several runs exist (${candidates.join(", ")}) -- pass one: /review <slug>`);
				}
				const slug = arg !== "" ? arg : (candidates[0] as string);
				claimWorkflow("review");
				const dir = workDir(ctx.cwd, slug);

				const refusal = commitRefusal(ctx.cwd);
				if (refusal !== undefined) return fail(refusal);

				for (const f of ["SPEC.md", "PLAN.md", "PROGRESS.md"]) {
					if (!existsSync(join(dir, f))) return fail(`review: .pi/work/${slug}/${f} does not exist`);
				}
				const specText = readFileSync(join(dir, "SPEC.md"), "utf-8");
				const spec = validateGatedSpec(specText);
				if (!spec.ok) return fail(spec.reason);
				const ids = extractSpecRequirementIds(spec.spec.requirementsBody);
				const plan = validatePlan(readFileSync(join(dir, "PLAN.md"), "utf-8"), ids);
				if (!plan.ok) return fail(plan.reason);
				// PROGRESS.md is model-editable; the signed ledger is the record the MR and the history check read.
				const rows = readLedger(ctx.cwd, slug);
				const now = { allowance: allowanceOf(spec.spec.scopePin.expectedFiles, plan.plan.filesTouched), tasks: tasksOf(plan.plan.tasks), specText };
				const pinDrift = pinRefusal(ctx.cwd, slug, rows, now, "/execute pinned them");
				if (pinDrift !== undefined) return fail(`review: ${pinDrift}`);
				const repin = latestRepin(rows);
				const accepted = acceptedEntries(rows);
				const lastStale = accepted.map((e) => repin?.before.has(e.sha) === true).lastIndexOf(true);
				const repinNote = `\n> Re-pinned at ${repin?.sha ?? ""} by the user: the entries above were verified on commits a rebase may have replaced.\n`;
				const progress = accepted.map((e, i) => (i === lastStale ? `${e.entry}${repinNote}` : e.entry)).join("\n");
				const mismatch = historyMismatch(ctx.cwd, plan.plan.tasks.map((t) => t.id), progress, repin);
				if (mismatch !== undefined) return fail(`review: ${mismatch}`);
				const ignoredNow = ensureHarnessIgnored(ctx.cwd);
				if (ignoredNow !== undefined) ctx.ui.notify(`review: ${ignoredNow}`, "info");
				const dirty = uncommittedPaths(ctx.cwd);
				if (dirty !== "") return fail(`review: the working tree is not HEAD (uncommitted or untracked: ${dirty}) -- commit or remove them first`);

				const mechanisms = gateDepthFor("review").mechanisms;
				// Calibration scores seeded-defect fixtures and has no meaning for a live diff, so it is never announced here.
				ctx.ui.notify(`review: running ${mechanisms.filter((m) => m !== "calibration").join(", ")}`, "info");

				const baseRef = resolveBaseRef(ctx.cwd, MR_TARGET_BRANCH);
				if (!baseRef.ok) return fail(`review: ${baseRef.reason}`);
				const base = gitOrThrow(ctx.cwd, ["merge-base", "HEAD", baseRef.ref]).trim();
				const changed = changedFilesSince(ctx.cwd, base);
				let gateReport = "The deterministic stage is outside this workflow's gate depth and did not run.";
				const gateDoubts: string[] = [];
				if (mechanisms.includes("deterministic")) {
					const gate = runChangeGateStage({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted(), baseSha: base, changed, baseTypecheckFailed: false });
					if (gate.antiPattern.status === "fail") return fail(`review: the deterministic gate fails on the change -- not reviewing:\n${gate.report}`);
					const baseline = gate.typecheck.status === "fail" ? typecheckBaseline(ctx.cwd, base, ctx.isProjectTrusted(), gate.report) : {};
					if (baseline.refusal !== undefined) return fail(baseline.refusal); else if (baseline.doubt !== undefined) gateDoubts.push(baseline.doubt);
					if (gate.lint.status === "fail") gateDoubts.push(`the lint fails at HEAD:\n${gate.report}`);
					if (!gate.ranAny) gateDoubts.push(`no deterministic check applies to this change:\n${gate.report}`);
					gateReport = gate.report;
				}
				const touched = readTouchedFiles(ctx.cwd, changed);
				const contract: ReviewerContractInput = {
					diff: gitOrThrow(ctx.cwd, ["-c", "core.quotePath=false", "diff", `${base}..HEAD`]),
					touchedFiles: touched,
					gateReport,
					requirements: ids.map((id) => ({ id, text: (spec.spec.requirementsBody.split("\n").find((l) => new RegExp(`\\b${id}\\b`).test(l)) ?? id).trim() })),
					filesTouchedUnion: now.allowance,
					// A deleted, binary or omitted file carries a note, not source, so it must not read as "no declared imports".
					importGraph: buildImportGraph(touched.filter((t) => /\.[cm]?[tj]sx?$/.test(t.path) && !/^\((?:deleted|content omitted)\b/.test(t.contents)).map((t) => ({ path: t.path, text: t.contents }))),
				};

				if (!mechanisms.includes("model-review")) return fail("review: gate depth for review excludes the model review");
				const reviewed = await runReview(ctx, { contract, requirementIds: ids });
				if (!reviewed.ok) return fail(reviewed.reason);

				// The stop decision runs on the post-refutation review, so BLOCKERs are rebuilt first.
				let review: ReviewArtifact = reviewed.review;
				const signals = computeDesignSignals({ changed, diffText: contract.diff, escalated: getModeState().escalated });
				if (shouldRunDesignReview(signals)) {
					ctx.ui.notify("review: running the design-level pass", "info");
					const design = await runDesignReview(ctx, { diffText: contract.diff, changed, requirements: contract.requirements });
					if (design.notice !== undefined) gateDoubts.push(`the design pass this change's signals called for is incomplete: ${design.notice}`);
					const added = design.findings.map((f) => ({ ...f, concreteFailure: `[design] ${f.concreteFailure}` }));
					review = { ...review, findings: [...review.findings, ...added], designPass: { ran: true, note: design.notice ?? `${added.length} finding(s) added`, signals } };
				} else {
					review = { ...review, designPass: { ran: false, note: "no signal fired", signals } };
				}
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
				const reasons = [...(stop.stop ? [stop.reason] : []), ...gateDoubts, ...(drifted.length > 0 ? [`changed but not declared in SPEC or PLAN: ${drifted.join(", ")}`] : [])];
				if (reasons.length > 0) {
					const approved = await ctx.ui.confirm("Open the MR anyway?", reasons.join("\n"));
					if (!approved) return void ctx.ui.notify("review: MR not opened -- approval declined", "warning");
				}

				const unpushed = upstreamMismatch(ctx.cwd);
				if (unpushed !== undefined) return fail(`review: MR not opened -- ${unpushed}`);
				const body = buildMrBody({ spec: spec.spec, plan: plan.plan, progress, review });
				const title = sanitizeTitle(spec.spec.goal.split("\n")[0] ?? "");
				const out = openMr({ targetBranch: MR_TARGET_BRANCH, sourceBranch: currentBranch(ctx.cwd), title, body }, { exec: spawnExec(ctx.cwd, undefined), cwd: ctx.cwd });
				if (out.kind === "refused") return fail(`review: MR refused -- ${out.reason}`);
				if (out.kind === "failed") return fail(`review: glab exited ${out.code}: ${out.stderr}`);
				ctx.ui.notify(`review: MR opened against ${MR_TARGET_BRANCH}\n${out.stdout}`, "info");
			} catch (err) {
				fail(err instanceof Error ? err.message : String(err));
			}
		},
	});
}
