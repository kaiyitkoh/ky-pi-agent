/**
 * The /execute PROGRESS.md append format, the fail-closed drift abort, and the per-run state that binds real tool
 * output to a commit. The accept/reject verdict stays with ../workflows/evidence.ts gateCompletion; this file only
 * renders what that gate has already accepted. Impure: appendProgress, changedFiles and the run-state accessors.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { EXPECTED_FILE_PATTERN } from "../grill/spec-schema.ts";
import { workDir } from "../../lib/work-artifacts.ts";

/** One task's completion record. `output` is the captured text, never a summary. */
export interface ProgressEntry {
	readonly taskId: string;
	readonly commitSha: string;
	readonly verificationCommand: string;
	readonly output: string;
	readonly exitCode: number;
	readonly recordedAt: number;
}

/** Render one entry: a header naming task and SHA, then the command and output in a fenced block. */
export function renderProgressAppend(entry: ProgressEntry): string {
	const lines: string[] = [];
	lines.push(`## ${entry.taskId} @ ${entry.commitSha}`);
	lines.push("");
	lines.push(`- Verification command: \`${entry.verificationCommand}\``);
	lines.push(`- Exit code: ${entry.exitCode}`);
	lines.push(`- Recorded: ${new Date(entry.recordedAt).toISOString()}`);
	lines.push("");
	lines.push("```");
	lines.push(entry.output);
	lines.push("```");
	lines.push("");
	return lines.join("\n");
}

/** Append to the slug's PROGRESS.md. Throws on an unwritable path so a lost append is never mistaken for a written one. */
export function appendProgress(cwd: string, slug: string, entry: ProgressEntry): string {
	const dir = workDir(cwd, slug);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "PROGRESS.md");
	appendFileSync(file, renderProgressAppend(entry), "utf-8");
	return file;
}

export interface DriftAbortInput {
	readonly attemptedPaths: readonly string[];
	readonly specExpectedFiles: readonly string[];
	readonly planFilesTouched: readonly string[];
}

export type DriftVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

// Backslashes become slashes and one leading "./" is dropped, before both shape and membership checks, so a Windows
// path is neither rejected as malformed nor missed against the union's forward-slash forms. Case is compared exactly.
export function normalisePathForDrift(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Decide whether attempted writes stay inside SPEC expected files union PLAN files-touched. Branches halt in order:
 * empty allowance, no attempted paths, malformed path, path outside the allowance; otherwise allow.
 */
export function driftAbort(input: DriftAbortInput): DriftVerdict {
	const union = new Set<string>([...input.specExpectedFiles, ...input.planFilesTouched]);

	// Must come first: an empty allowance means nothing was declared, and permitting everything would fail open.
	if (union.size === 0) {
		return {
			ok: false,
			reason: "the write allowance (SPEC expected files union PLAN files-touched) is empty; refusing rather than permitting any write",
		};
	}

	if (input.attemptedPaths.length === 0) {
		return { ok: false, reason: "driftAbort was called with zero attempted paths; the caller is malformed" };
	}

	const normalised = input.attemptedPaths.map(normalisePathForDrift);

	const malformed = normalised.filter((p) => !EXPECTED_FILE_PATTERN.test(p));
	if (malformed.length > 0) {
		return {
			ok: false,
			reason: `attempted path(s) are not valid repo-relative paths (no leading "/", no ".." segment, no glob): ${malformed.join(", ")}`,
		};
	}

	const outside = normalised.filter((p) => !union.has(p));
	if (outside.length > 0) {
		return {
			ok: false,
			reason: `attempted path(s) fall outside the declared write allowance: ${outside.join(", ")}; allowance is {${Array.from(union).sort().join(", ")}}`,
		};
	}

	return { ok: true };
}

export const REVISION_CAP = 2;

/** True when the error count did not drop between consecutive revisions, so the caller escalates instead of burning the cap. */
export function stallDetected(previousErrorCount: number, currentErrorCount: number): boolean {
	return currentErrorCount >= previousErrorCount;
}

interface TextBlock {
	readonly type?: string;
	readonly text?: string;
}

const MAX_FALLBACK_CHARS = 4000;
/** The text of a tool's `result`: joined text blocks when present, else a bounded JSON rendering. */
export function renderToolResultText(result: unknown): string {
	if (result !== null && typeof result === "object" && Array.isArray((result as { content?: unknown }).content)) {
		const blocks = (result as { content: TextBlock[] }).content;
		const text = blocks
			.filter((b) => b.type === "text" && typeof b.text === "string")
			.map((b) => b.text)
			.join("");
		if (text.length > 0) {
			return text;
		}
	}
	try {
		return JSON.stringify(result).slice(0, MAX_FALLBACK_CHARS);
	} catch {
		return String(result).slice(0, MAX_FALLBACK_CHARS);
	}
}

// Held on globalThis because Pi loads each extension entry through its own jiti module graph; a module-level
// variable would not be shared between copies of this file. evidence.ts redacts command input and never keeps
// output, so the output PROGRESS.md needs lives in this separate slot.
const EXECUTE_RUN_KEY = "__kypiExecuteRun";

export interface ExecuteRunContext {
	readonly cwd: string;
	readonly slug: string;
	readonly taskId: string;
	readonly verificationCommand: string;
	readonly mode: "delegated" | "degraded (ordinary prompt loop)";
}

interface ExecuteRunState extends ExecuteRunContext {
	output: string[];
}

function runState(): ExecuteRunState | undefined {
	return (globalThis as Record<string, unknown>)[EXECUTE_RUN_KEY] as ExecuteRunState | undefined;
}

/** Arm the run context, replacing any prior one. */
export function armExecuteRun(context: ExecuteRunContext): void {
	const state: ExecuteRunState = { ...context, output: [] };
	(globalThis as Record<string, unknown>)[EXECUTE_RUN_KEY] = state;
}

/** The armed context, or undefined when /execute did not arm the current run. */
export function executeRunContext(): ExecuteRunContext | undefined {
	const state = runState();
	return state === undefined
		? undefined
		: { cwd: state.cwd, slug: state.slug, taskId: state.taskId, verificationCommand: state.verificationCommand, mode: state.mode };
}

/** Append output text to the armed run; a no-op when none is armed. */
export function recordExecuteOutput(text: string): void {
	runState()?.output.push(text);
}

/** Every recorded chunk joined by a blank line; empty when nothing is armed or recorded. */
export function drainExecuteOutput(): string {
	return runState()?.output.join("\n\n") ?? "";
}

export function disarmExecuteRun(): void {
	(globalThis as Record<string, unknown>)[EXECUTE_RUN_KEY] = undefined;
}

/**
 * Repo-relative paths changed between two SHAs per git, so the drift check reads the tree and not a model's claim.
 * `--no-renames` lists both sides of a move; with rename detection a move out of an undeclared path shows only its
 * destination.
 */
export function changedFiles(cwd: string, baseSha: string, headSha: string): readonly string[] {
	const result = spawnSync("git", ["diff", "--name-only", "--no-renames", `${baseSha}..${headSha}`], {
		cwd,
		encoding: "utf-8",
		shell: false,
		windowsHide: true,
	});
	if (result.status !== 0) {
		throw new Error(`execute: git diff --name-only ${baseSha}..${headSha} failed (exit ${result.status}) in ${cwd}: ${result.stderr ?? ""}`);
	}
	return (result.stdout ?? "")
		.split("\n")
		.map((line) => line.trim().replace(/\\/g, "/"))
		.filter((line) => line.length > 0);
}
