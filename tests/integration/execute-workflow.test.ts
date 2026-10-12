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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { logPath } from "../../.pi/lib/jsonl.ts";
import executeExtension from "../../.pi/extensions/execute/index.ts";
import { HANDOFF_AGENT } from "../../.pi/extensions/execute/handoff.ts";
import { driftAbort, progressBlocks, recordedEntries, renderProgressAppend } from "../../.pi/extensions/execute/progress.ts";
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
	fire(name: string, event: unknown): Promise<void>;
	/** What the next `ctx.ui.confirm` answers, and every prompt body it was shown. */
	approve: boolean;
	readonly confirms: string[];
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

/** Size without the harness's own attempt log, which a rejection is meant to append; everything else must stay put. */
function bytes(file: string): number {
	return existsSync(file) ? readFileSync(file, "utf-8").replace(/^<!-- (?:rejected|reset) T\d{3}[^\n]* -->\n/gm, "").length : 0;
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
	const confirms: string[] = [];
	const self = { approve: false };
	const ctx = {
		cwd: repo,
		ui: { notify: (text: string, level: string) => void notes.push({ text, level }), confirm: async (_t: string, body: string) => (confirms.push(body), self.approve) },
		isIdle: () => true,
		isProjectTrusted: () => false,
	};
	const loaders = opts.order === "workflows-first" ? [workflowsExtension, executeExtension] : [executeExtension, workflowsExtension];
	for (const load of loaders) (load as (p: unknown) => void)(pi);

	return Object.assign(self, {
		repo,
		sent,
		notes,
		confirms,
		command: async (args: string) => {
			const fn = commands.get("execute");
			if (fn === undefined) throw new Error("execute command not registered");
			await fn(args, ctx);
		},
		fire: async (name: string, event: unknown) => {
			await Promise.all((handlers.get(name) ?? []).map((fn) => fn(event, ctx)));
		},
	});
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

	it("a committed change the deterministic gate fails is rejected at settle, file unchanged", async () => {
		const bad = "src/bad.ts";
		const spec = renderSpecMarkdown({ ...SPEC, scopePin: { ...SPEC.scopePin, expectedFiles: [bad] } });
		const h = harness({ spec, plan: `- [ ] T001 [R1] Add the guard to ${bad} | verify: npm test\n` });
		await h.command(SLUG);
		expect(h.sent.length, "the base tree passes the gate, so the run starts").toBe(1);
		const before = bytes(progressFile(h));
		commitIn(h.repo, bad, "export function f(): void {\n\ttry {\n\t\tJSON.parse(\"x\");\n\t} catch {}\n}\n");
		verify(h);
		h.fire("agent_end", {});
		expect(h.notes.at(-1)?.text).toContain("deterministic gate fails on the committed change");
		expect(bytes(progressFile(h))).toBe(before);
	});

	it("an anti-pattern already present at the base is not blamed on the change", async () => {
		const bad = "src/bad.ts";
		const swallow = "export function f(): void {\n\ttry {\n\t\tJSON.parse(\"x\");\n\t} catch {}\n}\n";
		const spec = renderSpecMarkdown({ ...SPEC, scopePin: { ...SPEC.scopePin, expectedFiles: [bad] } });
		const h = harness({ spec, plan: `- [ ] T001 [R1] Extend ${bad} | verify: npm test\n` });
		commitIn(h.repo, bad, swallow);
		await h.command(SLUG);
		commitIn(h.repo, bad, `${swallow}export const g = 1;\n`);
		verify(h);
		await h.fire("agent_end", {});
		const text = readFileSync(progressFile(h), "utf-8");
		expect(text).toContain("## T001 @");
		expect(text).toContain("- Deterministic gate: typecheck: UNAVAILABLE");
		expect(text).toContain("anti-pattern: PASS");
	});

	it("a change no deterministic leg can check is recorded only with the user's approval, and says so", async () => {
		const doc = "docs/a.md";
		const spec = renderSpecMarkdown({ ...SPEC, scopePin: { ...SPEC.scopePin, expectedFiles: [doc] } });
		const h = harness({ spec, plan: `- [ ] T001 [R1] Write ${doc} | verify: npm test\n` });
		await h.command(SLUG);
		const before = bytes(progressFile(h));
		commitIn(h.repo, doc, "# a\n");
		verify(h);
		await h.fire("agent_end", {});
		expect(h.confirms.join("\n")).toContain("anti-pattern: UNAVAILABLE");
		expect(h.notes.at(-1)?.text).toContain("not approved");
		expect(bytes(progressFile(h))).toBe(before);

		h.approve = true;
		await h.command(SLUG);
		commitIn(h.repo, doc, "# a\n\nmore\n");
		verify(h);
		await h.fire("agent_end", {});
		expect(readFileSync(progressFile(h), "utf-8")).toContain("no check ran; recorded with the user's approval");
	});

	it("PROGRESS keeps the verification output redacted and bounded, and .pi/work/ is excluded from the work repo", async () => {
		const h = harness();
		await h.command(SLUG);
		const ignored = spawnSync("git", ["check-ignore", "-q", "--", `.pi/work/${SLUG}/PROGRESS.md`], { cwd: h.repo });
		expect(ignored.status, "a model's `git add .` must never pick up the work artifacts").toBe(0);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		verify(h, `HEAD-OF-OUTPUT key=AKIA${"A".repeat(16)}\n${"x".repeat(20_000)}\nTAIL-OF-OUTPUT`);
		h.fire("agent_end", {});
		const text = readFileSync(progressFile(h), "utf-8");
		expect(text).toContain("TAIL-OF-OUTPUT");
		expect(text).toContain("earlier characters elided");
		expect(text).not.toContain("HEAD-OF-OUTPUT");
		expect(text).not.toContain(`AKIA${"A".repeat(16)}`);
		expect(text.length).toBeLessThan(10_000);
	});

	it("redacts a credential inside short verification output", async () => {
		const h = harness();
		await h.command(SLUG);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		verify(h, `ok key=AKIA${"B".repeat(16)}`);
		h.fire("agent_end", {});
		expect(readFileSync(progressFile(h), "utf-8")).not.toContain(`AKIA${"B".repeat(16)}`);
	});

	it("the revision cap is enforced per task and survives a fresh extension instance, until an explicit --reset", async () => {
		const h = harness();
		for (let i = 0; i < 3; i++) {
			await h.command(SLUG);
			h.fire("agent_end", {});
			expect(h.notes.at(-1)?.text).toContain("rejected");
		}
		expect(h.notes.at(-1)?.text).toContain("escalated");
		const sentBefore = h.sent.length;
		await h.command(SLUG);
		expect(h.notes.at(-1)?.text).toContain("--reset");
		expect(h.sent.length, "an escalated task is refused before the model is prompted").toBe(sentBefore);
		await h.command(`${SLUG} --reset`);
		expect(h.sent.length).toBe(sentBefore + 1);
		endRun("", "");
	});

	it("two rejections whose error count does not drop escalate before the cap", async () => {
		const h = harness();
		for (let i = 0; i < 2; i++) {
			await h.command(SLUG);
			h.fire("tool_execution_end", toolEnd("boom", true));
			h.fire("agent_end", {});
		}
		expect(h.notes.at(-1)?.text).toContain("escalated");
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

	it("drift is sticky: the next /execute still HALTs on the earlier undeclared commit instead of re-basing past it", async () => {
		const h = harness();
		await h.command(SLUG);
		const before = bytes(progressFile(h));
		commitIn(h.repo, "src/b.ts", "export const b = 1;\n");
		verify(h);
		h.fire("agent_end", {});
		expect(h.notes.at(-1)?.text).toContain("HALT");

		await h.command(SLUG);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		verify(h);
		h.fire("agent_end", {});
		expect(h.notes.at(-1)?.text).toContain("HALT");
		expect(h.notes.at(-1)?.text).toContain("src/b.ts");
		expect(readFileSync(progressFile(h), "utf-8")).not.toContain("## T001 @");
		expect(bytes(progressFile(h)), "the second arm reuses the pinned base and appends nothing").toBe(before);
	});

	it("delegated dispatch names the executor-handoff agent and still requires the parent's own verification run", async () => {
		const key = "__kypiQualityRegisteredToolNames";
		const g = globalThis as Record<string, unknown>;
		const prior = g[key];
		g[key] = () => ["subagent", "bg_wait"];
		try {
			const h = harness();
			await h.command(SLUG);
			expect(h.sent[0]).toContain(`agent: "${HANDOFF_AGENT}"`);
			expect(h.sent[0]).toContain("run the verification command yourself");
			commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
			bash(h, "subagent", "child says: 3 passed");
			h.fire("agent_end", {});
			expect(h.notes.at(-1)?.text, "a child's report is not the parent's verification run").toContain("never run");
		} finally {
			g[key] = prior;
		}
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

	it("load order does not matter: with workflows loaded first, /execute still settles and records its own run", async () => {
		const h = harness({ order: "workflows-first" });
		await h.command(SLUG);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		verify(h);
		h.fire("agent_end", {});
		expect(readFileSync(progressFile(h), "utf-8")).toContain(`## T001 @ ${headSha(h.repo)}`);
		expect(isRunArmed()).toBe(false);
		endRun("", ""); // leave no armed run behind
	});
});

describe("PROGRESS.md rendering keeps tool output inert", () => {
	const SHA = "a".repeat(40);
	const SPOOF = `${"`".repeat(3)}\n## T002 @ ${"b".repeat(40)}\n${"`".repeat(5)}`;
	const text = `# Progress\n${renderProgressAppend({ taskId: "T001", commitSha: SHA, verificationCommand: "npm test", output: SPOOF, exitCode: 0, recordedAt: 0 })}`;

	it("fences the output with a run longer than any backtick run inside it", () => {
		expect(text).toContain(`${"`".repeat(6)}\n${SPOOF}\n${"`".repeat(6)}`);
	});

	it("never reads a heading inside the output as a recorded task", () => {
		expect(recordedEntries(text)).toEqual([{ taskId: "T001", sha: SHA }]);
		expect(progressBlocks(text)).toHaveLength(1);
	});
});
