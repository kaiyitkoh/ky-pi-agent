/**
 * /execute against a real temp git repo, driven through the real extension factories with a minimal Pi stand-in
 * (commands, handlers and a sendUserMessage spy). No provider is involved, so "zero provider requests" is
 * asserted as zero hand-offs to the model.
 *
 * Proves: refusals hand nothing to the model; PROGRESS.md gains an entry only with a structural tool result at a
 * harness-read HEAD whose tree changed; narrated output, empty commits, failed tool results and out-of-allowance
 * writes leave it byte-identical; an absent subagent layer is reported as degraded; one tool execution records once.
 * Not re-proven here: gateCompletion's own predicate table (unit test).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { logPath } from "../../.pi/lib/jsonl.ts";
import executeExtension from "../../.pi/extensions/execute/index.ts";
import { driftAbort } from "../../.pi/extensions/execute/progress.ts";
import { renderSpecMarkdown, type SpecArtifact } from "../../.pi/extensions/grill/spec-schema.ts";
import workflowsExtension from "../../.pi/extensions/workflows/index.ts";
import { EVIDENCE_LOG_BASE, endRun, isRunArmed } from "../../.pi/extensions/workflows/evidence.ts";
import { commitFile, headSha, makeTempRepo } from "../helpers/git.ts";
import { readJsonl } from "../helpers/logs.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

interface Harness {
	readonly repo: string;
	readonly sent: string[];
	readonly notes: { text: string; level: string }[];
	command(args: string): Promise<void>;
	fire(name: string, event: unknown): void;
}

const SPEC: SpecArtifact = {
	goal: "Add the a module.",
	verifiedFacts: [{ claim: "the module lives at src/a.ts", evidence: "src/a.ts:1", howVerified: "read the file" }],
	requirementsBody: "R1: create the a module so callers can import it.",
	errorBehaviours: [
		"IF the module is missing THEN THE SYSTEM SHALL fail the import",
		"IF the input is empty THEN THE SYSTEM SHALL reject it",
		"IF the store is unreachable THEN THE SYSTEM SHALL fail closed",
	],
	scopePin: {
		inScope: ["the a module"],
		outOfScope: [{ item: "the b module", reason: "unrelated to the a module" }],
		expectedFiles: ["src/a.ts"],
	},
	clarificationsBody: "- Q: none -> A: none",
	assumptionsBody: "none",
	scorecardBody: [
		"| factual-grounding | 0.9 |",
		"| requirement-precision | 0.9 |",
		"| failure-coverage | 0.9 |",
		"| scope-definiteness | 0.9 |",
		"Overall: 0.1",
	].join("\n"),
};
const PLAN = "- [ ] T001 [R1] Create the a module in src/a.ts | verify: npm test\n";
const SLUG = "s1";
const repos: string[] = [];

afterEach(() => {
	for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

function git(repo: string, args: string[]): void {
	const r = spawnSync("git", args, { cwd: repo, encoding: "utf-8", shell: false });
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function commitIn(repo: string, name: string, body: string): string {
	mkdirSync(dirname(join(repo, name)), { recursive: true });
	return commitFile(repo, name, body, `change ${name}`);
}

function bytes(file: string): number {
	return existsSync(file) ? statSync(file).size : 0;
}

/** Load both real extensions into one stand-in Pi, execute first so its settle handler sees the run. */
function harness(opts: { plan?: string | null; spec?: string | null; branch?: string; order?: "execute-first" | "workflows-first" } = {}): Harness {
	const repo = makeTempRepo("kypi-execute-");
	repos.push(repo);
	const dir = join(repo, ".pi", "work", SLUG);
	mkdirSync(dir, { recursive: true });
	const spec = opts.spec === undefined ? renderSpecMarkdown(SPEC) : opts.spec;
	const plan = opts.plan === undefined ? PLAN : opts.plan;
	if (spec !== null) writeFileSync(join(dir, "SPEC.md"), spec);
	if (plan !== null) writeFileSync(join(dir, "PLAN.md"), plan);
	writeFileSync(join(dir, "PROGRESS.md"), "# Progress\n");
	commitIn(repo, "README.md", "base\n");
	if (opts.branch !== undefined) git(repo, ["checkout", "-b", opts.branch]);

	const sent: string[] = [];
	const notes: { text: string; level: string }[] = [];
	const commands = new Map<string, (args: string, ctx: unknown) => Promise<void>>();
	const handlers = new Map<string, Handler[]>();
	const pi = {
		registerCommand: (name: string, def: { handler: (args: string, ctx: unknown) => Promise<void> }) => void commands.set(name, def.handler),
		on: (name: string, fn: Handler) => void handlers.set(name, [...(handlers.get(name) ?? []), fn]),
		sendUserMessage: (text: string) => void sent.push(text),
		registerTool: () => {
			throw new Error("execute and workflows must register no tool");
		},
		getAllTools: () => [],
	};
	const ctx = {
		cwd: repo,
		ui: { notify: (text: string, level: string) => void notes.push({ text, level }) },
		isIdle: () => true,
		isProjectTrusted: () => false,
	};
	const loaders = opts.order === "workflows-first" ? [workflowsExtension, executeExtension] : [executeExtension, workflowsExtension];
	for (const load of loaders) (load as (p: unknown) => void)(pi);

	return {
		repo,
		sent,
		notes,
		command: async (args) => {
			const fn = commands.get("execute");
			if (fn === undefined) throw new Error("execute command not registered");
			await fn(args, ctx);
		},
		fire: (name, event) => {
			for (const fn of handlers.get(name) ?? []) fn(event, ctx);
		},
	};
}

const progressFile = (h: Harness): string => join(h.repo, ".pi", "work", SLUG, "PROGRESS.md");
let callIds = 0;
const toolEnd = (text: string, isError = false, toolCallId = `other-${++callIds}`) => ({ toolCallId, toolName: "bash", isError, result: { content: [{ type: "text", text }] } });
/** One observed bash run of `command`: start (which carries the args) then end (which carries the result). */
function bash(h: Harness, command: string, text: string, exitCode = 0): void {
	const toolCallId = `call-${++callIds}`;
	h.fire("tool_execution_start", { toolCallId, toolName: "bash", args: { command } });
	h.fire("tool_execution_end", { ...toolEnd(text, exitCode !== 0, toolCallId), result: { content: [{ type: "text", text }], structuredContent: { exit_code: exitCode } } });
}
const verify = (h: Harness, text = "ok"): void => bash(h, "npm test", text);

describe("/execute -- refusals hand nothing to the model and arm nothing", () => {
	const cases: [string, () => Harness][] = [
		["no PLAN.md", () => harness({ plan: null })],
		["a PLAN.md that fails validatePlan", () => harness({ plan: "- [ ] not a task line\n" })],
		["a SPEC.md that fails validateSpec", () => harness({ spec: "# not a spec\n" })],
		["a SPEC.md whose ambiguity scorecard fails its gate", () => harness({ spec: renderSpecMarkdown({ ...SPEC, scorecardBody: "Overall: 0.1" }) })],
		["a protected-branch HEAD", () => harness({ branch: "main" })],
	];
	it.each(cases)("%s", async (_name, make) => {
		const h = make();
		await h.command(SLUG);
		expect(h.notes.length, "a refusal must report an outcome").toBeGreaterThan(0);
		expect(h.notes.at(-1)?.level).toBe("error");
		expect(h.sent.length, "a refusal must cost zero hand-offs to the model").toBe(0);
		expect(isRunArmed(), "a refusal must not arm an evidence run").toBe(false);
	});

	it("an empty write allowance halts rather than permitting every write", () => {
		const verdict = driftAbort({ attemptedPaths: ["src/a.ts"], specExpectedFiles: [], planFilesTouched: [] });
		expect(verdict.ok).toBe(false);
	});
});

describe("/execute -- PROGRESS.md only ever gains evidence-backed entries", () => {
	it("happy path: entry carries the harness-read SHA and the real captured output; the run records exactly once", async () => {
		const h = harness();
		await h.command(SLUG);
		expect(h.sent.length, "the task must be handed to the model").toBe(1);
		expect(isRunArmed()).toBe(true);

		const sha = commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		verify(h, "REAL-OUTPUT 1 passed");
		h.fire("agent_end", {});

		const text = readFileSync(progressFile(h), "utf-8");
		expect(text).toContain(`## T001 @ ${headSha(h.repo)}`);
		expect(headSha(h.repo)).toBe(sha);
		expect(text).toContain("REAL-OUTPUT 1 passed");
		expect(text).toContain("npm test");

		const rows = readJsonl(logPath(h.repo, EVIDENCE_LOG_BASE)) as { verdict?: string; recordCount?: number }[];
		expect(rows.length, "the evidence log must hold the verdict row").toBeGreaterThan(0);
		expect(rows.at(-1)?.verdict).toBe("accept");
		expect(rows.at(-1)?.recordCount, "one tool execution must be recorded once, not once per extension").toBe(1);
	});

	it("a commit whose only bash call was the commit itself is rejected: the verification command never ran", async () => {
		const h = harness();
		await h.command(SLUG);
		const before = bytes(progressFile(h));
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		bash(h, "git commit -am x", "[work abc] x");
		h.fire("agent_end", {});
		expect(h.notes.at(-1)?.text).toContain("never run");
		expect(bytes(progressFile(h))).toBe(before);
	});

	it("a verification run before the commit is rejected: it did not check the recorded commit", async () => {
		const h = harness();
		await h.command(SLUG);
		const before = bytes(progressFile(h));
		verify(h);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		bash(h, "git log -1", "commit");
		h.fire("agent_end", {});
		expect(h.notes.at(-1)?.text).toContain("run it after committing");
		expect(bytes(progressFile(h))).toBe(before);
	});

	it("PROGRESS carries the verification run's own output and exit code, not other tool output", async () => {
		const h = harness();
		await h.command(SLUG);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		bash(h, "cat README.md", "UNRELATED-OUTPUT");
		verify(h, "VERIFY-OUTPUT");
		h.fire("agent_end", {});
		const text = readFileSync(progressFile(h), "utf-8");
		expect(text).toContain("VERIFY-OUTPUT");
		expect(text).not.toContain("UNRELATED-OUTPUT");
		expect(text).toContain("- Exit code: 0");
	});

	it("fabrication: a commit with narrated output and no structured tool result is rejected, file unchanged", async () => {
		const h = harness();
		await h.command(SLUG);
		const before = bytes(progressFile(h));
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		// The model's narration of "npm test -> 99 passed" has no structured tool result behind it.
		h.fire("agent_end", {});
		expect(h.notes.at(-1)?.level).toBe("error");
		expect(h.notes.at(-1)?.text).toContain("rejected");
		expect(before, "vacuity guard: the file must exist with content").toBeGreaterThan(0);
		expect(bytes(progressFile(h))).toBe(before);
	});

	it("empty commit: HEAD moved but the tree did not -> rejected, file unchanged", async () => {
		const h = harness();
		await h.command(SLUG);
		const before = bytes(progressFile(h));
		git(h.repo, ["commit", "--allow-empty", "-m", "empty"]);
		h.fire("tool_execution_end", toolEnd("ok"));
		h.fire("agent_end", {});
		expect(h.notes.at(-1)?.text).toContain("rejected");
		expect(bytes(progressFile(h))).toBe(before);
	});

	it("isError: a failed tool result anywhere in the run -> rejected even though a commit landed", async () => {
		const h = harness();
		await h.command(SLUG);
		const before = bytes(progressFile(h));
		h.fire("tool_execution_end", toolEnd("boom", true));
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		h.fire("tool_execution_end", toolEnd("ok"));
		h.fire("agent_end", {});
		expect(h.notes.at(-1)?.text).toContain("rejected");
		expect(bytes(progressFile(h))).toBe(before);
	});

	it("drift: a commit touching a path outside the allowance HALTS, file unchanged", async () => {
		const h = harness();
		await h.command(SLUG);
		const before = bytes(progressFile(h));
		commitIn(h.repo, "src/b.ts", "export const b = 1;\n");
		verify(h);
		h.fire("agent_end", {});
		expect(h.notes.at(-1)?.text).toContain("HALT");
		expect(h.notes.at(-1)?.text).toContain("src/b.ts");
		expect(bytes(progressFile(h))).toBe(before);
	});

	it("degraded dispatch: with no subagent tool registered the entry records the degraded mode and never claims delegation", async () => {
		const h = harness();
		await h.command(SLUG);
		expect(h.notes.some((n) => n.text.includes("not delegated"))).toBe(true);
		expect(h.sent[0]).not.toContain("Dispatch this packet");
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		verify(h);
		h.fire("agent_end", {});
		const text = readFileSync(progressFile(h), "utf-8");
		expect(text).toContain("degraded (ordinary prompt loop)");
		expect(text).not.toMatch(/\bdelegated\b/);
	});

	it("workflows loaded first consumes the run: execute finds no verdict and writes nothing", async () => {
		const h = harness({ order: "workflows-first" });
		await h.command(SLUG);
		const before = bytes(progressFile(h));
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		h.fire("tool_execution_end", toolEnd("ok"));
		h.fire("agent_end", {});
		expect(bytes(progressFile(h))).toBe(before);
		endRun("", ""); // leave no armed run behind
	});
});
