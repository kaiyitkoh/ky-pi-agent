/**
 * The /review MR: a body built from SPEC, PLAN and PROGRESS evidence (never the diff), and the one function that
 * runs glab. Impure: openMr only.
 */
import { spawnSync } from "node:child_process";

import { commandFor } from "../../lib/win-quote.ts";
import { redactString } from "../diagnostics/redact.ts";
import type { SpecArtifact } from "../grill/spec-schema.ts";
import type { PlanArtifact } from "../plan-ceremony/plan-schema.ts";
import type { ReviewArtifact } from "../quality/review-schema.ts";
import { classifyGlabInvocation } from "../safety/git.ts";
import { PROTECTED_BRANCHES } from "../safety/index.ts";

export const MR_TARGET_BRANCH = "staging";
export const MR_TARGET_BRANCH_FLAG = "--target-branch";
export const MR_BODY_FILE_FLAG = "--description-file";

export const AI_AUTHORSHIP_DISCLOSURE =
	"Disclosure: this change and this description were written with AI assistance and checked by an automated reviewer pass.";

export interface MrBodyInput {
	readonly spec: SpecArtifact;
	readonly plan: PlanArtifact;
	readonly progress: string;
	readonly review: ReviewArtifact;
}

// Each PROGRESS entry starts at its own "## T### @ sha" heading; lifting whole entries keeps the output verbatim.
function progressEntries(progress: string): string[] {
	return progress.split(/^(?=## )/m).map((s) => s.trim()).filter((s) => s.startsWith("## "));
}

/** Evidence-built MR description. No diff parameter on purpose: a diff restates what the reviewer can already read. */
export function buildMrBody(input: MrBodyInput): string {
	const { spec, plan, review } = input;
	const lines: string[] = [];

	lines.push("## Why", "", spec.goal.trim(), "");

	lines.push("## What", "", spec.requirementsBody.trim(), "");
	const coverage = [...plan.coverageMatrix].map(([req, tasks]) => `${req}: ${tasks.join(", ")}`);
	if (coverage.length > 0) lines.push("Planned tasks per requirement:", "", ...coverage.map((c) => `- ${c}`), "");

	lines.push("## Verification", "");
	const entries = progressEntries(input.progress);
	if (entries.length === 0) lines.push("No recorded verification evidence.", "");
	for (const entry of entries) lines.push(entry.replace(/^## /, "### "), "");

	lines.push("## Risk / look-here", "");
	const risky = review.findings.filter((f) => f.severity !== "NIT");
	for (const f of risky) lines.push(`- ${f.severity} \`${f.location}\`: ${f.concreteFailure}`);
	for (const p of review.scopeDrift?.drifted ?? []) lines.push(`- changed but not declared: \`${p}\``);
	if (risky.length === 0 && (review.scopeDrift?.drifted.length ?? 0) === 0) lines.push("No BLOCKER or WARNING findings and no undeclared changes.");
	lines.push("");
	if (review.classification === "workaround") {
		lines.push(`Workaround: ${review.classificationJustification}`, `- Proper fix: ${review.properFix ?? ""}`, `- Deferred because: ${review.deferralReason ?? ""}`, "");
	}

	lines.push("## Out of scope", "");
	for (const x of spec.scopePin.outOfScope) lines.push(`- ${x.item} (${x.reason})`);
	lines.push("");

	lines.push("## Disclosure", "", AI_AUTHORSHIP_DISCLOSURE, "");

	return redactString(lines.join("\n"));
}

/** Explicit target always; the body travels as a file so no body text reaches a command line. */
export function mrCreateArgv(input: { targetBranch: string; title: string; bodyFile: string }): readonly string[] {
	return ["mr", "create", MR_TARGET_BRANCH_FLAG, input.targetBranch, "--title", input.title, MR_BODY_FILE_FLAG, input.bodyFile];
}

/** Titles reach a Windows shell string; keep only characters with no cmd.exe meaning. */
export function sanitizeTitle(raw: string): string {
	const clean = raw.replace(/[^A-Za-z0-9 .,:/()_-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 72);
	return clean.length > 0 ? clean : "Change";
}

export type MrExec = (file: string, args: string[]) => { status: number | null; stdout: string; stderr: string };

export type MrOutcome =
	| { readonly kind: "refused"; readonly reason: string }
	| { readonly kind: "opened"; readonly stdout: string }
	| { readonly kind: "failed"; readonly code: number | null; readonly stderr: string };

export interface OpenMrDeps {
	readonly exec: MrExec;
	readonly isWindows: boolean;
}

/** Real executor; Windows needs a shell for .cmd shims, which commandFor makes safe by quoting into one string. */
export function spawnExec(cwd: string, env: NodeJS.ProcessEnv | undefined, isWindows: boolean): MrExec {
	return (file, args) => {
		const r = spawnSync(file, args, { cwd, env, encoding: "utf-8", shell: isWindows, timeout: 60_000, windowsHide: true });
		return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
	};
}

/**
 * The only place glab runs. Order is binding: classify first, execute only on allow, because a block that still
 * executes is not a block.
 */
export function openMr(input: { targetBranch: string; title: string; bodyFile: string }, deps: OpenMrDeps): MrOutcome {
	const argv = mrCreateArgv(input);
	const [subcommand = "", ...rest] = argv;
	const verdict = classifyGlabInvocation({ subcommand, args: rest }, PROTECTED_BRANCHES);
	if (verdict.kind === "block") return { kind: "refused", reason: verdict.reason };

	const [file, args] = commandFor("glab", [...argv], deps.isWindows);
	const r = deps.exec(file, args);
	return r.status === 0 ? { kind: "opened", stdout: r.stdout } : { kind: "failed", code: r.status, stderr: r.stderr };
}

// This proves classification and the argv that would be sent. It cannot show that GitLab accepts the body-file
// flag, that the target exists, or that server-side branch protection is configured.
