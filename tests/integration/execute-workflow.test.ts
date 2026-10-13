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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { AssistantMessage, Context, FauxResponseStep } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { logDir, logPath } from "../../.pi/lib/jsonl.ts";
import { recordCheckpoint } from "../../.pi/extensions/checkpoint/store.ts";
import executeExtension from "../../.pi/extensions/execute/index.ts";
import { HANDOFF_AGENT } from "../../.pi/extensions/execute/handoff.ts";
import { latestRepin, pinnedSpecFile, readLedger } from "../../.pi/extensions/execute/ledger.ts";
import { driftAbort, executeRunContext, progressBlocks, recordedEntries, renderProgressAppend } from "../../.pi/extensions/execute/progress.ts";
import { renderSpecMarkdown, type SpecArtifact } from "../../.pi/extensions/grill/spec-schema.ts";
import workflowsExtension from "../../.pi/extensions/workflows/index.ts";
import { EVIDENCE_LOG_BASE, endRun, isRunArmed } from "../../.pi/extensions/workflows/evidence.ts";
import { setQuickGateExecOverrideForTests } from "../../.pi/extensions/quality/index.ts";
import { approve } from "../../.pi/extensions/safety/approvals.ts";
import { commitFile, headSha, makeTempRepo, repoRoot } from "../helpers/git.ts";
import { readJsonl } from "../helpers/logs.ts";
import { withFauxSession } from "../helpers/session.ts";

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
/** `promptStarts: false` models a prompt Pi never starts (no model, expired auth, a refused route): no input or before_agent_start fires. */
function harness(opts: { plan?: string | null; spec?: string | null; branch?: string; order?: "execute-first" | "workflows-first"; promptStarts?: boolean } = {}): Harness {
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
		sendUserMessage: (text: string) => {
			sent.push(text);
			if (opts.promptStarts === false) return;
			for (const fn of handlers.get("input") ?? []) fn({ type: "input", text, source: "extension" }, ctx);
			for (const fn of handlers.get("before_agent_start") ?? []) fn({ type: "before_agent_start", prompt: text }, ctx);
		},
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
		h.fire("agent_settled", { aborted: false });

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
		h.fire("agent_settled", { aborted: false });
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
		h.fire("agent_settled", { aborted: false });
		expect(h.notes.at(-1)?.text).toContain("run it after committing");
		expect(bytes(progressFile(h))).toBe(before);
	});

	it("a verification run on a tree holding an uncommitted file is rejected: the commit is not what was tested", async () => {
		const h = harness();
		await h.command(SLUG);
		const before = bytes(progressFile(h));
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		writeFileSync(join(h.repo, "src", "helper.ts"), "export const helper = 1;\n");
		verify(h);
		await h.fire("agent_settled", { aborted: false });
		expect(h.notes.at(-1)?.text).toContain("src/helper.ts");
		expect(h.notes.at(-1)?.text).toContain("not the commit");
		expect(bytes(progressFile(h))).toBe(before);
	});

	it("a file left uncommitted after a clean verification run is still rejected at settle", async () => {
		const h = harness();
		await h.command(SLUG);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		verify(h);
		writeFileSync(join(h.repo, "src", "late.ts"), "export const late = 1;\n");
		await h.fire("agent_settled", { aborted: false });
		expect(h.notes.at(-1)?.text).toContain("src/late.ts");
		expect(readFileSync(progressFile(h), "utf-8")).not.toContain("## T001 @");
	});

	it("checkpoint and log state written into a work repo with no .gitignore neither dirties the tree nor reaches `git add -A`", async () => {
		const h = harness();
		expect(existsSync(join(h.repo, ".gitignore")), "the work repo must not ignore harness state itself").toBe(false);
		await h.command(SLUG);
		const sha = commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		expect(recordCheckpoint(h.repo, { sha, label: "turn", cwd: h.repo }), "the real checkpoint store must write its file").toBeDefined();
		mkdirSync(logDir(h.repo), { recursive: true });
		writeFileSync(join(logDir(h.repo), "wire-x.jsonl"), "{}\n");
		verify(h);
		await h.fire("agent_settled", { aborted: false });
		expect(readFileSync(progressFile(h), "utf-8")).toContain(`## T001 @ ${sha}`);
		git(h.repo, ["add", "-A"]);
		const staged = spawnSync("git", ["diff", "--cached", "--name-only"], { cwd: h.repo, encoding: "utf-8" }).stdout;
		expect(staged, "a model's `git add -A` must not stage harness state").toBe("");
	});

	it("an entry the model appends to PROGRESS.md does not mark its task done: the signed ledger decides", async () => {
		const h = harness();
		writeFileSync(progressFile(h), renderProgressAppend({ taskId: "T001", commitSha: "f".repeat(40), verificationCommand: "npm test", output: "FORGED", exitCode: 0, recordedAt: 0 }), { flag: "a" });
		await h.command(SLUG);
		expect(h.sent.length, "T001 is still the next task").toBe(1);
		expect(h.sent[0]).toContain("npm test");
		endRun("", "");
	});

	it("PROGRESS carries the verification run's own output and exit code, not other tool output", async () => {
		const h = harness();
		await h.command(SLUG);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		bash(h, "cat README.md", "UNRELATED-OUTPUT");
		verify(h, "VERIFY-OUTPUT");
		h.fire("agent_settled", { aborted: false });
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
		h.fire("agent_settled", { aborted: false });
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
		await h.fire("agent_settled", { aborted: false });
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
		await h.fire("agent_settled", { aborted: false });
		expect(h.confirms.join("\n")).toContain("anti-pattern: UNAVAILABLE");
		expect(h.notes.at(-1)?.text).toContain("not approved");
		expect(bytes(progressFile(h))).toBe(before);

		h.approve = true;
		await h.command(SLUG);
		commitIn(h.repo, doc, "# a\n\nmore\n");
		verify(h);
		await h.fire("agent_settled", { aborted: false });
		expect(readFileSync(progressFile(h), "utf-8")).toContain("no check ran; recorded with the user's approval");
	});

	it("a passing typecheck does not count for a change with no TypeScript/JavaScript file, so a .tf change still needs approval", async () => {
		const tf = "infra/main.tf";
		const spec = renderSpecMarkdown({ ...SPEC, scopePin: { ...SPEC.scopePin, expectedFiles: [tf] } });
		const h = harness({ spec, plan: `- [ ] T001 [R1] Add the bucket in ${tf} | verify: npm test\n` });
		commitIn(h.repo, "tsconfig.json", "{}\n");
		setQuickGateExecOverrideForTests(() => ({ code: 0, stdout: "", stderr: "" }));
		try {
			await h.command(SLUG);
			commitIn(h.repo, tf, "resource \"x\" \"y\" {}\n");
			verify(h);
			await h.fire("agent_settled", { aborted: false });
		} finally {
			setQuickGateExecOverrideForTests(undefined);
		}
		expect(h.confirms.join("\n")).toContain("typecheck: UNAVAILABLE (no changed TypeScript/JavaScript file");
		expect(h.notes.at(-1)?.text).toContain("not approved");
	});

	it("a changed TypeScript file in a repo without a tsconfig reports the typecheck leg UNAVAILABLE", async () => {
		const h = harness();
		setQuickGateExecOverrideForTests(() => ({ code: 0, stdout: "", stderr: "" }));
		try {
			await h.command(SLUG);
			commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
			verify(h);
			await h.fire("agent_settled", { aborted: false });
		} finally {
			setQuickGateExecOverrideForTests(undefined);
		}
		expect(readFileSync(progressFile(h), "utf-8")).toContain("typecheck: UNAVAILABLE (no tsconfig.json");
	});

	it("a changed TypeScript file still runs the typecheck leg when a tsconfig exists", async () => {
		const h = harness();
		setQuickGateExecOverrideForTests(() => ({ code: 0, stdout: "", stderr: "" }));
		try {
			commitIn(h.repo, "tsconfig.json", "{}\n");
			await h.command(SLUG);
			commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
			verify(h);
			await h.fire("agent_settled", { aborted: false });
		} finally {
			setQuickGateExecOverrideForTests(undefined);
		}
		expect(readFileSync(progressFile(h), "utf-8")).toContain("- Deterministic gate: typecheck: PASS");
	});

	it("PROGRESS keeps the verification output redacted and bounded, and .pi/work/ is excluded from the work repo", async () => {
		const h = harness();
		await h.command(SLUG);
		const ignored = spawnSync("git", ["check-ignore", "-q", "--", `.pi/work/${SLUG}/PROGRESS.md`], { cwd: h.repo });
		expect(ignored.status, "a model's `git add .` must never pick up the work artifacts").toBe(0);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		verify(h, `HEAD-OF-OUTPUT key=AKIA${"A".repeat(16)}\n${"x".repeat(20_000)}\nTAIL-OF-OUTPUT`);
		h.fire("agent_settled", { aborted: false });
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
		h.fire("agent_settled", { aborted: false });
		expect(readFileSync(progressFile(h), "utf-8")).not.toContain(`AKIA${"B".repeat(16)}`);
	});

	it("the revision cap is enforced per task and survives a fresh extension instance, until an explicit --reset", async () => {
		const h = harness();
		for (let i = 0; i < 3; i++) {
			await h.command(SLUG);
			h.fire("agent_settled", { aborted: false });
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

	it("two gate rejections whose finding count does not drop escalate before the cap", async () => {
		const bad = "src/bad.ts";
		const spec = renderSpecMarkdown({ ...SPEC, scopePin: { ...SPEC.scopePin, expectedFiles: [bad] } });
		const h = harness({ spec, plan: `- [ ] T001 [R1] Add the guard to ${bad} | verify: npm test\n` });
		for (let i = 0; i < 2; i++) {
			await h.command(SLUG);
			commitIn(h.repo, bad, `export function f${i}(): void {\n\ttry {\n\t\tJSON.parse("x");\n\t} catch {}\n}\n`);
			verify(h);
			await h.fire("agent_settled", { aborted: false });
			expect(h.notes.at(-1)?.text).toContain("deterministic gate fails");
		}
		expect(h.notes.at(-1)?.text).toContain("escalated");
	});

	it("rejections with no gate finding count never read as a stall, so the cap alone escalates", async () => {
		const h = harness();
		for (let i = 0; i < 2; i++) {
			await h.command(SLUG);
			h.fire("tool_execution_end", toolEnd("boom", true));
			await h.fire("agent_settled", { aborted: false });
		}
		expect(h.notes.at(-1)?.text).toContain("rejected");
		expect(h.notes.at(-1)?.text).not.toContain("escalated");
		endRun("", "");
	});

	it("fabrication: a commit with narrated output and no structured tool result is rejected, file unchanged", async () => {
		const h = harness();
		await h.command(SLUG);
		const before = bytes(progressFile(h));
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		// The model's narration of "npm test -> 99 passed" has no structured tool result behind it.
		h.fire("agent_settled", { aborted: false });
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
		h.fire("agent_settled", { aborted: false });
		expect(h.notes.at(-1)?.text).toContain("rejected");
		expect(bytes(progressFile(h))).toBe(before);
	});

	it("a rejected attempt leaves exactly one evidence row, and it is a reject", async () => {
		const h = harness();
		await h.command(SLUG);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		bash(h, "npm test", "1 failed", 1);
		await h.fire("agent_settled", { aborted: false });
		const rows = readJsonl(logPath(h.repo, EVIDENCE_LOG_BASE)) as { verdict?: string; reason?: string }[];
		expect(rows, JSON.stringify(rows)).toHaveLength(1);
		expect(rows[0]?.verdict).toBe("reject");
		expect(rows[0]?.reason).toContain("exited 1");
	});

	it("a reset back to an earlier commit moves HEAD and changes the tree, but is not a commit: rejected, file unchanged", async () => {
		const h = harness();
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		await h.command(SLUG);
		const before = bytes(progressFile(h));
		git(h.repo, ["reset", "--hard", "HEAD~1"]);
		verify(h);
		await h.fire("agent_settled", { aborted: false });
		expect(h.notes.at(-1)?.text).toContain("not a new commit");
		expect(bytes(progressFile(h))).toBe(before);
	});

	it("a failing exploratory call and a red-before-fix verification run before the commit do not reject: the final verification decides", async () => {
		const h = harness();
		await h.command(SLUG);
		bash(h, "grep zzz-no-such-text README.md", "", 1);
		bash(h, "npm test", "red-before-fix", 1);
		h.fire("tool_execution_end", toolEnd("edit failed", true));
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		bash(h, "npm test", "1 passed");
		h.fire("agent_settled", { aborted: false });
		expect(readFileSync(progressFile(h), "utf-8")).toContain("## T001 @");
		expect(h.notes.at(-1)?.text).toContain("failed tool call(s) logged");
		const rows = readJsonl(logPath(h.repo, EVIDENCE_LOG_BASE)) as { verdict?: string; failedToolCalls?: number }[];
		expect(rows.at(-1)?.verdict).toBe("accept");
		expect(rows.at(-1)?.failedToolCalls, "the red run, the grep and the failed edit are counted").toBe(3);
	});

	it("a commit whose final verification fails is rejected naming the command, whatever else passed", async () => {
		const h = harness();
		await h.command(SLUG);
		const before = bytes(progressFile(h));
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		bash(h, "npm test", "1 failed", 1);
		h.fire("agent_settled", { aborted: false });
		expect(h.notes.at(-1)?.text).toContain("`npm test` exited 1");
		expect(bytes(progressFile(h))).toBe(before);
	});

	it("an aborted settle disarms the run with no verdict, no evidence row and no attempt counted", async () => {
		const h = harness();
		await h.command(SLUG);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		bash(h, "npm test", "1 passed");
		const notesBefore = h.notes.length;
		h.fire("agent_settled", { aborted: true });
		expect(isRunArmed()).toBe(false);
		expect(executeRunContext()).toBeUndefined();
		expect(h.notes.slice(notesBefore)).toHaveLength(0);
		expect(existsSync(logPath(h.repo, EVIDENCE_LOG_BASE))).toBe(false);
		expect(readFileSync(progressFile(h), "utf-8")).not.toContain("T001");
	});

	it("drift: a commit touching a path outside the allowance HALTS, file unchanged", async () => {
		const h = harness();
		await h.command(SLUG);
		const before = bytes(progressFile(h));
		commitIn(h.repo, "src/b.ts", "export const b = 1;\n");
		verify(h);
		h.fire("agent_settled", { aborted: false });
		expect(h.notes.at(-1)?.text).toContain("HALT");
		expect(h.notes.at(-1)?.text).toContain("src/b.ts");
		expect(bytes(progressFile(h))).toBe(before);
	});

	it("a refused /execute during a run cannot widen the allowance that run settles against", async () => {
		const h = harness();
		await h.command(SLUG);
		writeFileSync(join(h.repo, ".pi", "work", SLUG, "PLAN.md"), `${PLAN}- [ ] T009 [R1] Create the b module in src/b.ts | verify: npm test\n`);
		await h.command(SLUG);
		expect(h.notes.at(-1)?.text).toContain("already in flight");
		commitIn(h.repo, "src/b.ts", "export const b = 1;\n");
		verify(h);
		await h.fire("agent_settled", { aborted: false });
		expect(h.notes.at(-1)?.text).toContain("HALT");
	});

	it("drift is sticky: the next /execute still HALTs on the earlier undeclared commit instead of re-basing past it", async () => {
		const h = harness();
		await h.command(SLUG);
		const before = bytes(progressFile(h));
		commitIn(h.repo, "src/b.ts", "export const b = 1;\n");
		verify(h);
		h.fire("agent_settled", { aborted: false });
		expect(h.notes.at(-1)?.text).toContain("HALT");

		await h.command(SLUG);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		verify(h);
		h.fire("agent_settled", { aborted: false });
		expect(h.notes.at(-1)?.text).toContain("HALT");
		expect(h.notes.at(-1)?.text).toContain("src/b.ts");
		expect(readFileSync(progressFile(h), "utf-8")).not.toContain("## T001 @");
		expect(bytes(progressFile(h)), "the second arm reuses the pinned base and appends nothing").toBe(before);
	});

	it("--rebase-base moves the drift base only with the user's approval, after showing what moved", async () => {
		const h = harness();
		await h.command(SLUG);
		commitIn(h.repo, "src/b.ts", "export const b = 1;\n");
		verify(h);
		await h.fire("agent_settled", { aborted: false });
		expect(h.notes.at(-1)?.text).toContain("HALT");

		await h.command(`${SLUG} --rebase-base`);
		expect(h.confirms.at(-1)).toContain("src/b.ts");
		expect(h.notes.at(-1)?.text).toContain("declined");
		expect(h.sent.length, "a re-pin never prompts the model").toBe(1);

		h.approve = true;
		await h.command(`${SLUG} --rebase-base`);
		expect(h.notes.at(-1)?.text).toContain("drift base is now");
		await h.command(SLUG);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		verify(h);
		await h.fire("agent_settled", { aborted: false });
		expect(readFileSync(progressFile(h), "utf-8")).toContain(`## T001 @ ${headSha(h.repo)}`);
	});

	it("a verification command rewritten in PLAN.md after the pin is refused until the user re-pins and sees both", async () => {
		const h = harness();
		await h.command(SLUG);
		await h.fire("agent_settled", { aborted: true });
		writeFileSync(join(h.repo, ".pi", "work", SLUG, "PLAN.md"), PLAN.replace("verify: npm test", "verify: true"));
		await h.command(SLUG);
		expect(h.notes.at(-1)?.text).toContain("changed since s1 was pinned");
		expect(h.sent, "a tampered plan hands nothing to the model").toHaveLength(1);

		h.approve = true;
		await h.command(`${SLUG} --repin`);
		expect(h.confirms.at(-1)).toContain("verify: npm test");
		expect(h.confirms.at(-1)).toContain("verify: true");
		await h.command(SLUG);
		expect(h.sent).toHaveLength(2);
		expect(h.sent.at(-1)).toContain("on the committed HEAD: true");
		await h.fire("agent_settled", { aborted: true });
	});

	it("a task deleted from PLAN.md after the pin is refused", async () => {
		const two = `${PLAN}- [ ] T002 [R1] Extend the a module in src/a.ts | verify: npm test\n`;
		const h = harness({ plan: two });
		await h.command(SLUG);
		await h.fire("agent_settled", { aborted: true });
		writeFileSync(join(h.repo, ".pi", "work", SLUG, "PLAN.md"), PLAN);
		await h.command(SLUG);
		expect(h.notes.at(-1)?.text).toContain("changed since s1 was pinned");
	});

	it("a later task's text rewritten with the same path and verification is refused", async () => {
		const two = `${PLAN}- [ ] T002 [R1] Implement rate limiting in src/a.ts | verify: npm test\n`;
		const h = harness({ plan: two });
		await h.command(SLUG);
		await h.fire("agent_settled", { aborted: true });
		writeFileSync(join(h.repo, ".pi", "work", SLUG, "PLAN.md"), two.replace("Implement rate limiting", "Add a comment"));
		await h.command(SLUG);
		expect(h.notes.at(-1)?.text).toContain("PLAN.md's tasks");
		expect(h.sent).toHaveLength(1);
	});

	it("ticking a finished task's checkbox is not drift: the next /execute runs T002", async () => {
		const two = `${PLAN}- [ ] T002 [R1] Extend the a module in src/a.ts | verify: npm test\n`;
		const h = harness({ plan: two });
		await h.command(SLUG);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		verify(h);
		await h.fire("agent_settled", { aborted: false });
		writeFileSync(join(h.repo, ".pi", "work", SLUG, "PLAN.md"), two.replace("- [ ] T001", "- [x] T001"));
		await h.command(SLUG);
		expect(h.notes.at(-1)?.text ?? "").not.toContain("changed since");
		expect(h.sent).toHaveLength(2);
		expect(h.sent.at(-1)).toContain("T002");
		await h.fire("agent_settled", { aborted: true });
	});

	it("a SPEC.md edited after the pin is refused", async () => {
		const h = harness();
		await h.command(SLUG);
		await h.fire("agent_settled", { aborted: true });
		const specFile = join(h.repo, ".pi", "work", SLUG, "SPEC.md");
		writeFileSync(specFile, readFileSync(specFile, "utf-8").replace("unrelated to the a module", "not needed"));
		await h.command(SLUG);
		expect(h.notes.at(-1)?.text).toContain("SPEC.md changed since s1 was pinned");
		expect(h.sent).toHaveLength(1);
	});

	it("a SPEC.md change is shown line by line at --repin, and the refusal names a pinned copy that restores it", async () => {
		const two = `${PLAN}- [ ] T002 [R1] Extend the a module in src/a.ts | verify: npm test\n`;
		const h = harness({ plan: two });
		await h.command(SLUG);
		await h.fire("agent_settled", { aborted: true });
		const specFile = join(h.repo, ".pi", "work", SLUG, "SPEC.md");
		const pinnedSpec = readFileSync(specFile, "utf-8");
		writeFileSync(specFile, pinnedSpec.replace("unrelated to the a module", "not needed"));
		writeFileSync(join(h.repo, ".pi", "work", SLUG, "PLAN.md"), two.replace("Extend the a module", "Rewrite the a module"));
		await h.command(SLUG);
		const copy = pinnedSpecFile(h.repo, SLUG);
		expect(readFileSync(copy, "utf-8")).toBe(pinnedSpec);

		writeFileSync(join(h.repo, ".pi", "work", SLUG, "PLAN.md"), two);
		await h.command(SLUG);
		expect(h.notes.at(-1)?.text).toContain(`!cp "${copy}"`);

		writeFileSync(join(h.repo, ".pi", "work", SLUG, "PLAN.md"), two.replace("Extend the a module", "Rewrite the a module"));
		await h.command(`${SLUG} --repin`);
		const shown = h.confirms.at(-1) ?? "";
		expect(shown).toMatch(/^- .*unrelated to the a module/m);
		expect(shown).toMatch(/^\+ .*not needed/m);
		expect(shown).toMatch(/^- T002 .*Extend the a module/m);
		expect(shown).toMatch(/^\+ T002 .*Rewrite the a module/m);
		expect(shown, "an unchanged task is not listed as a change").not.toMatch(/^[-+] T001/m);
	});

	it("--repin and --rebase-base refuse while a run is in flight, so a mid-run PLAN edit cannot be accepted", async () => {
		const h = harness();
		await h.command(SLUG);
		writeFileSync(join(h.repo, ".pi", "work", SLUG, "PLAN.md"), PLAN.replace("verify: npm test", "verify: true"));
		h.approve = true;
		for (const flag of ["--repin", "--rebase-base"]) {
			await h.command(`${SLUG} ${flag}`);
			expect(h.notes.at(-1)?.text).toContain("already in flight");
		}
		expect(h.confirms).toHaveLength(0);
		await h.fire("agent_settled", { aborted: true });
	});

	it("--repin re-pins only with approval and never moves the drift base", async () => {
		const h = harness();
		await h.command(SLUG);
		await h.fire("agent_settled", { aborted: true });
		writeFileSync(join(h.repo, ".pi", "work", SLUG, "PLAN.md"), PLAN.replace("Create the a module", "Create the a module carefully"));
		await h.command(`${SLUG} --repin`);
		expect(h.notes.at(-1)?.text).toContain("declined");
		h.approve = true;
		await h.command(`${SLUG} --repin`);
		expect(h.confirms.at(-1)).toContain("drift base stays");
		const rows = readLedger(h.repo, SLUG);
		expect(rows.filter((r) => r.kind === "base")).toHaveLength(1);
		expect(latestRepin(rows), "a PLAN edit is not a rebase, so /review keeps its history check").toBeUndefined();
		await h.command(SLUG);
		expect(h.sent).toHaveLength(2);
		await h.fire("agent_settled", { aborted: true });
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
			h.fire("agent_settled", { aborted: false });
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
		h.fire("agent_settled", { aborted: false });
		const text = readFileSync(progressFile(h), "utf-8");
		expect(text).toContain("degraded (ordinary prompt loop)");
		expect(text).not.toMatch(/\bdelegated\b/);
	});

	it("an unreadable HEAD at settle still ends the shared run, so the next /execute is not refused as in flight", async () => {
		const h = harness();
		await h.command(SLUG);
		renameSync(join(h.repo, ".git"), join(h.repo, ".git-away"));
		try {
			await h.fire("agent_settled", { aborted: false });
		} finally {
			renameSync(join(h.repo, ".git-away"), join(h.repo, ".git"));
		}
		expect(isRunArmed(), "a leaked shared run refuses every later /quick and /execute").toBe(false);
		expect(h.notes.at(-1)?.level).toBe("error");
	});

	it("a prompt that never started: the next, unrelated prompt disarms the run, and its turn records nothing", async () => {
		const h = harness({ promptStarts: false });
		await h.command(SLUG);
		expect(isRunArmed()).toBe(true);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		verify(h);
		await h.fire("input", { type: "input", text: "hi, what's the status", source: "interactive" });
		await h.fire("before_agent_start", { type: "before_agent_start", prompt: "hi, what's the status" });
		await h.fire("agent_settled", { aborted: false });
		expect(isRunArmed()).toBe(false);
		expect(executeRunContext()).toBeUndefined();
		expect(readFileSync(progressFile(h), "utf-8")).not.toContain("## T001 @");
		expect(existsSync(logPath(h.repo, EVIDENCE_LOG_BASE)), "no verdict for a run that never started").toBe(false);
	});

	it("a pending run is not settled by a turn that skipped before_agent_start, and records no tool call meanwhile", async () => {
		const h = harness({ promptStarts: false });
		await h.command(SLUG);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		verify(h);
		await h.fire("agent_settled", { aborted: false });
		expect(isRunArmed(), "still waiting for its own prompt").toBe(true);
		expect(readFileSync(progressFile(h), "utf-8")).not.toContain("## T001 @");
		await h.command(SLUG);
		expect(h.notes.at(-1)?.text).toContain("/reload");
		await h.fire("session_start", {});
		expect(isRunArmed()).toBe(false);
	});

	it("a run whose agent_settled never arrived is cleared at session_start, so it cannot settle a later turn", async () => {
		const h = harness();
		await h.command(SLUG);
		expect(executeRunContext()).toBeDefined();
		await h.fire("session_start", {});
		expect(executeRunContext(), "a leaked slot would make the workflows settle handler stand aside forever").toBeUndefined();
		expect(isRunArmed()).toBe(false);
	});

	it("load order does not matter: with workflows loaded first, /execute still settles and records its own run", async () => {
		const h = harness({ order: "workflows-first" });
		await h.command(SLUG);
		commitIn(h.repo, "src/a.ts", "export const a = 1;\n");
		verify(h);
		h.fire("agent_settled", { aborted: false });
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

const entry = (name: string): string => `${repoRoot()}/.pi/extensions/${name}/index.ts`.replace(/\\/g, "/");

function quotedField(text: string, field: string): string {
	const start = text.indexOf(`${field}="`);
	if (start === -1) throw new Error(`no ${field} in block reason: ${text}`);
	let j = start + field.length + 2;
	while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
	return JSON.parse(text.slice(start + field.length + 1, j + 1)) as string;
}

describe("/execute in a real session with the safety layer loaded", () => {
	it("an approved command and a failing exploratory call do not reject: commit plus passing verification is ACCEPTED", async () => {
		const confirmCommand = "terraform apply";
		const reissue: FauxResponseStep = ((context: Context): AssistantMessage => {
			const last = [...context.messages].reverse().find((m) => m.role === "toolResult");
			const text = last?.role === "toolResult" ? last.content.map((b) => (b.type === "text" ? b.text : "")).join("") : "";
			const command = quotedField(text, "command");
			if (!approve(quotedField(text, "request_id"), command, quotedField(text, "reason"))) throw new Error("approve() refused the pending request");
			return fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" });
		}) as FauxResponseStep;
		const bashStep = (command: string) => fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" });
		const verification = "git rev-parse --verify HEAD";
		const source = [
			`import safety from ${JSON.stringify(entry("safety"))};`,
			`import execute from ${JSON.stringify(entry("execute"))};`,
			`import workflows from ${JSON.stringify(entry("workflows"))};`,
			"export default function (pi) { safety(pi); execute(pi); workflows(pi); }",
		].join("\n");

		await withFauxSession(
			{
				extensionSource: source,
				tools: ["bash"],
				cwdFiles: {
					[`.pi/work/${SLUG}/SPEC.md`]: renderSpecMarkdown(SPEC),
					[`.pi/work/${SLUG}/PLAN.md`]: `- [ ] T001 [R1] Create the a module in src/a.ts | verify: ${verification}\n`,
					[`.pi/work/${SLUG}/PROGRESS.md`]: "# Progress\n",
				},
				responses: [
					bashStep("grep zzz-no-such-text seed.txt"),
					bashStep(confirmCommand),
					reissue,
					bashStep('mkdir -p src && echo "export const a = 1;" > src/a.ts && git add src/a.ts && git commit -m "add a"'),
					bashStep(verification),
					fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
				],
			},
			async ({ session, cwd }) => {
				for (const args of [["init"], ["config", "user.email", "t@test.invalid"], ["config", "user.name", "t"], ["checkout", "-b", "work"]]) git(cwd, args);
				writeFileSync(join(cwd, "seed.txt"), "seed\n");
				git(cwd, ["add", "--", "seed.txt"]);
				git(cwd, ["commit", "-m", "seed"]);

				const ctx = session.extensionRunner.createCommandContext();
				const notes: string[] = [];
				(ctx.ui as unknown as { notify: (t: string) => void }).notify = (t) => void notes.push(t);
				setQuickGateExecOverrideForTests(() => ({ code: 0, stdout: "", stderr: "" }));
				try {
					await session.extensionRunner.getCommand("execute")?.handler(SLUG, ctx);
					const file = logPath(cwd, EVIDENCE_LOG_BASE);
					const deadline = Date.now() + 15000;
					while ((!existsSync(file) || readJsonl(file).length < 1) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));

					const rows = readJsonl(file) as { verdict?: string; failedToolCalls?: number; recordCount?: number }[];
					expect(rows, notes.join(" | ")).toHaveLength(1);
					expect(rows[0]?.verdict, `${JSON.stringify(rows[0])} ${notes.join(" | ")}`).toBe("accept");
					expect(rows[0]?.failedToolCalls, "the no-match grep and the approved-then-failed command are both logged").toBeGreaterThanOrEqual(2);
					expect(readFileSync(join(cwd, ".pi", "work", SLUG, "PROGRESS.md"), "utf-8")).toContain("## T001 @");
					expect(notes.at(-1)).toContain("recorded at");
				} finally {
					setQuickGateExecOverrideForTests(undefined);
				}
			},
		);
	});
});
