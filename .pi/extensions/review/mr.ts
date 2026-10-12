/**
 * The /review MR: a body built from SPEC, PLAN and PROGRESS evidence (never the diff), and the one function that
 * runs glab. Impure: openMr only.
 */
import { spawnSync } from "node:child_process";

import { redactString } from "../diagnostics/redact.ts";
import { progressBlocks, recordedEntries } from "../execute/progress.ts";
import type { SpecArtifact } from "../grill/spec-schema.ts";
import type { PlanArtifact } from "../plan-ceremony/plan-schema.ts";
import type { ReviewArtifact } from "../quality/review-schema.ts";
import { classifyGlabInvocation } from "../safety/git.ts";
import { PROTECTED_BRANCHES } from "../safety/index.ts";

export const MR_TARGET_BRANCH = "staging";
export const MR_TARGET_BRANCH_FLAG = "--target-branch";
export const MR_BODY_FLAG = "--description";
/**
 * Windows caps a whole command line at 32,767 characters (CreateProcess); leave room for the rest of the argv.
 * Compared against the quoted length, since Node escapes each `"` and `\` in an argument.
 */
export const MAX_MR_BODY_CHARS = 30_000;

export const AI_AUTHORSHIP_DISCLOSURE =
	"Disclosure: this change and this description were written with AI assistance and checked by an automated reviewer pass.";

export interface MrBodyInput {
	readonly spec: SpecArtifact;
	readonly plan: PlanArtifact;
	readonly progress: string;
	readonly review: ReviewArtifact;
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
	const entries = progressBlocks(input.progress);
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

function gitRead(cwd: string, args: string[]): { status: number | null; out: string } {
	const r = spawnSync("git", args, { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	return { status: r.status, out: (r.stdout ?? "").trim() };
}

/**
 * Why the recorded history does not match HEAD, or undefined: every task recorded, each record on HEAD's history,
 * none after the last. After a user re-pin, records made before it are exempt from the ancestry check and the
 * re-pinned commit stands in for them as the last point verified.
 */
export function historyMismatch(cwd: string, taskIds: readonly string[], progress: string, repin?: { readonly sha: string; readonly before: ReadonlySet<string> }): string | undefined {
	const entries = recordedEntries(progress);
	const missing = taskIds.filter((id) => !entries.some((e) => e.taskId === id));
	if (missing.length > 0) return `PLAN task(s) with no PROGRESS entry: ${missing.join(", ")} -- run /execute first`;
	const checked = entries.filter((e) => repin?.before.has(e.sha) !== true);
	const offHistory = checked.filter((e) => gitRead(cwd, ["merge-base", "--is-ancestor", e.sha, "HEAD"]).status !== 0);
	if (offHistory.length > 0) return `recorded commit(s) not on HEAD's history: ${offHistory.map((e) => `${e.taskId} @ ${e.sha}`).join(", ")} -- after a rebase, run /execute <slug> --rebase-base`;
	const head = gitRead(cwd, ["rev-parse", "HEAD"]).out;
	const last = checked.at(-1)?.sha ?? repin?.sha;
	if (last !== head) return `HEAD (${head}) carries commits after the last recorded entry (${last ?? "none"}) that no verification covers`;
	return undefined;
}

/**
 * Why the MR would not carry HEAD, or undefined. The MR's source is the remote branch named like the local one
 * (passed explicitly as --source-branch), so that remote-tracking ref must equal HEAD; `@{u}` may track another name.
 * This reads the local remote-tracking ref, which is only as fresh as the last push or fetch.
 */
export function upstreamMismatch(cwd: string): string | undefined {
	const head = gitRead(cwd, ["rev-parse", "HEAD"]).out;
	const branch = gitRead(cwd, ["symbolic-ref", "--short", "HEAD"]);
	if (branch.status !== 0) return "HEAD is detached -- check out the branch the MR should come from";
	const remote = gitRead(cwd, ["config", "--get", `branch.${branch.out}.remote`]).out || "origin";
	const pushed = gitRead(cwd, ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${branch.out}`]);
	if (pushed.status !== 0) return `${remote}/${branch.out} does not exist -- push the branch under its own name first: git push ${remote} ${branch.out}:${branch.out}`;
	return pushed.out === head ? undefined : `${remote}/${branch.out} is at ${pushed.out}, not HEAD (${head}) -- push first`;
}

export interface MrInput {
	readonly targetBranch: string;
	/** Passed to glab explicitly, so the MR never opens from whatever `@{u}` happens to track. */
	readonly sourceBranch: string;
	readonly title: string;
	readonly body: string;
}

/** Target first, so no earlier value-taking flag can swallow it; the body is one argv element and never meets a shell. */
export function mrCreateArgv(input: MrInput): readonly string[] {
	return ["mr", "create", MR_TARGET_BRANCH_FLAG, input.targetBranch, "--source-branch", input.sourceBranch, "--title", input.title, MR_BODY_FLAG, input.body];
}

/** Keep only plain characters, so a title can never read as a flag cluster or carry control text. */
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
}

const GLAB_TIMEOUT_MS = 60_000;

/**
 * Real executor, never through a shell: the body is free text, and cmd.exe would expand `%VAR%` and metacharacters
 * in it. glab ships as a native executable; a `.cmd` shim is not found without a shell and is reported, not run.
 */
export function spawnExec(cwd: string, env: NodeJS.ProcessEnv | undefined, timeoutMs = GLAB_TIMEOUT_MS): MrExec {
	return (file, args) => {
		const r = spawnSync(file, args, { cwd, env, encoding: "utf-8", shell: false, timeout: timeoutMs, windowsHide: true });
		if (r.error === undefined) return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
		const code = (r.error as NodeJS.ErrnoException).code;
		// A timeout may land after GitLab already created the MR, so a blind retry would open a second one.
		const stderr =
			code === "ENOENT"
				? `${file} could not be started without a shell (${r.error.message}); install glab as a native executable on PATH`
				: code === "ETIMEDOUT"
					? `${file} timed out after ${timeoutMs} ms and may already have created the MR -- check \`glab mr list --source-branch <branch>\` before retrying`
					: `${file} failed to run: ${r.error.message}`;
		return { status: null, stdout: "", stderr };
	};
}

/**
 * The only place glab runs. Order is binding: classify first, execute only on allow, because a block that still
 * executes is not a block.
 */
export function openMr(input: MrInput, deps: OpenMrDeps): MrOutcome {
	const quotedLength = input.body.length + (input.body.match(/["\\]/g)?.length ?? 0);
	if (quotedLength > MAX_MR_BODY_CHARS) {
		return { kind: "refused", reason: `the MR body is ${quotedLength} characters once quoted, over the ${MAX_MR_BODY_CHARS}-character command-line limit -- not truncating evidence` };
	}
	const argv = mrCreateArgv(input);
	const [subcommand = "", ...rest] = argv;
	const verdict = classifyGlabInvocation({ subcommand, args: rest }, PROTECTED_BRANCHES);
	if (verdict.kind === "block") return { kind: "refused", reason: verdict.reason };

	const r = deps.exec("glab", [...argv]);
	return r.status === 0 ? { kind: "opened", stdout: r.stdout } : { kind: "failed", code: r.status, stderr: r.stderr };
}

// This proves classification and the argv that would be sent. It cannot show that GitLab accepts the request,
// that the target exists, or that server-side branch protection is configured.
