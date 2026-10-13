/**
 * /grill and /plan driven through their real command handlers and settle hooks with a minimal Pi stand-in: the
 * gated writers run on whatever the model wrote, and every reader refuses a SPEC that fails the full gate.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appendLedger, readLedger } from "../../.pi/extensions/execute/ledger.ts";
import grillExtension from "../../.pi/extensions/grill/index.ts";
import { HARD_QUESTION_BUDGET } from "../../.pi/extensions/grill/scorecard.ts";
import { validateGatedSpec } from "../../.pi/extensions/grill/spec-gate.ts";
import { renderSpecMarkdown, type SpecArtifact } from "../../.pi/extensions/grill/spec-schema.ts";
import planExtension from "../../.pi/extensions/plan-ceremony/index.ts";
import { claimWorkflow } from "../../.pi/lib/active-workflow.ts";
import { commitFile, makeTempRepo } from "../helpers/git.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

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
const UNGATED_SPEC = renderSpecMarkdown({ ...SPEC, scorecardBody: "Overall: 0.1" });
const SLUG = "add-the-a-module";
const repos: string[] = [];

afterEach(() => {
	for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

function harness(load: (pi: unknown) => void) {
	const repo = makeTempRepo("kypi-ceremony-");
	repos.push(repo);
	const sent: string[] = [];
	const notes: { text: string; level: string }[] = [];
	const commands = new Map<string, (args: string, ctx: unknown) => Promise<void>>();
	const handlers = new Map<string, Handler[]>();
	load({
		registerCommand: (name: string, def: { handler: (args: string, ctx: unknown) => Promise<void> }) => void commands.set(name, def.handler),
		on: (name: string, fn: Handler) => void handlers.set(name, [...(handlers.get(name) ?? []), fn]),
		sendUserMessage: (text: string) => void sent.push(text),
	});
	const ctx = { cwd: repo, ui: { notify: (text: string, level: string) => void notes.push({ text, level }) }, isIdle: () => true };
	return {
		repo,
		sent,
		notes,
		dir: join(repo, ".pi", "work", SLUG),
		run: async (name: string, args: string) => commands.get(name)?.(args, ctx),
		fire: (name: string, event: object = {}): unknown[] => (handlers.get(name) ?? []).map((fn) => fn(event, ctx)),
	};
}

/** Write as the model would, with an mtime the settle hook cannot mistake for its own last read. */
function modelWrites(file: string, body: string, tick: number): void {
	mkdirSync(join(file, ".."), { recursive: true });
	writeFileSync(file, body, "utf-8");
	const t = new Date(Date.now() + tick * 1000);
	utimesSync(file, t, t);
}

describe("validateGatedSpec -- the gate every reader applies", () => {
	it("accepts a SPEC whose scorecard clears every floor and the overall gate", () => {
		expect(validateGatedSpec(renderSpecMarkdown(SPEC)).ok).toBe(true);
	});

	it("re-rendering a gated SPEC reproduces it byte for byte, so a re-gate never moves its pinned hash", () => {
		const once = renderSpecMarkdown(SPEC);
		const gated = validateGatedSpec(once);
		expect(gated.ok && renderSpecMarkdown(gated.spec)).toBe(once);
	});

	it("refuses a SPEC with no dimension scores, even with a self-reported low overall", () => {
		const v = validateGatedSpec(UNGATED_SPEC);
		expect(v.ok).toBe(false);
		if (!v.ok) expect(v.reason).toContain("§8");
	});

	it("refuses a SPEC whose §3 declares no requirement id", () => {
		expect(validateGatedSpec(renderSpecMarkdown({ ...SPEC, requirementsBody: "create the a module" })).ok).toBe(false);
	});
});

describe("/grill -- the settle hook gates whatever SPEC.md the model wrote", () => {
	it("tells each turn its question slot, then re-renders a SPEC.md that passes", async () => {
		const h = harness(grillExtension as (pi: unknown) => void);
		await h.run("grill", "add the a module");
		expect(h.sent.length).toBe(1);
		const brief = h.fire("before_agent_start")[0] as { message: { content: string } };
		expect(brief.message.content).toContain(`Question 1 of ${HARD_QUESTION_BUDGET}`);

		modelWrites(join(h.dir, "SPEC.md"), UNGATED_SPEC, 1);
		h.fire("agent_settled");
		expect(h.notes.at(-1)?.text).toContain("refused");
		const next = h.fire("before_agent_start")[0] as { message: { content: string } };
		expect(next.message.content).toContain("Question 2 of");
		expect(next.message.content).toContain("refused by the gate");

		modelWrites(join(h.dir, "SPEC.md"), renderSpecMarkdown(SPEC), 2);
		h.fire("agent_settled");
		expect(h.notes.at(-1)?.level).toBe("info");
		expect(validateGatedSpec(readFileSync(join(h.dir, "SPEC.md"), "utf-8")).ok).toBe(true);
		expect(h.fire("before_agent_start")[0], "a gated SPEC disarms the interrogation").toBeUndefined();
	});

	it("an aborted settle neither counts a question nor gates the SPEC", async () => {
		const h = harness(grillExtension as (pi: unknown) => void);
		await h.run("grill", "add the a module");
		modelWrites(join(h.dir, "SPEC.md"), renderSpecMarkdown(SPEC), 1);
		const before = h.notes.length;
		for (let i = 0; i < HARD_QUESTION_BUDGET + 2; i++) h.fire("agent_settled", { aborted: true });
		expect(h.notes.slice(before), "an Esc is not a turn").toHaveLength(0);
		const brief = h.fire("before_agent_start")[0] as { message: { content: string } };
		expect(brief.message.content).toContain(`Question 1 of ${HARD_QUESTION_BUDGET}`);
	});

	it("disarms with an error once the question budget is spent without a gated SPEC", async () => {
		const h = harness(grillExtension as (pi: unknown) => void);
		await h.run("grill", "add the a module");
		for (let i = 0; i < HARD_QUESTION_BUDGET; i++) h.fire("agent_settled");
		const last = h.fire("before_agent_start")[0] as { message: { content: string } };
		expect(last.message.content).toContain("hard budget");
		h.fire("agent_settled");
		expect(h.notes.at(-1)?.level).toBe("error");
		expect(h.fire("before_agent_start")[0]).toBeUndefined();
	});

	it("stands down once another workflow command claims the session, and at session_start", async () => {
		const h = harness(grillExtension as (pi: unknown) => void);
		await h.run("grill", "add the a module");
		const armedNotes = h.notes.length;
		expect(h.fire("before_agent_start")[0]).toBeDefined();
		claimWorkflow("execute");
		expect(h.fire("before_agent_start")[0], "an /execute turn must not carry the grill brief").toBeUndefined();
		modelWrites(join(h.dir, "SPEC.md"), renderSpecMarkdown(SPEC), 1);
		h.fire("agent_settled");
		expect(h.notes.slice(armedNotes), "a retired run gates nothing").toHaveLength(0);

		await h.run("grill", "--resume");
		h.fire("session_start");
		expect(h.fire("before_agent_start")[0]).toBeUndefined();
	});
});

describe("/grill -- an earlier /execute ledger for the same slug", () => {
	it("refuses a fresh slug whose ledger still exists in this worktree, and hands nothing to the model", async () => {
		const h = harness(grillExtension as (pi: unknown) => void);
		appendLedger(h.repo, SLUG, { kind: "accepted", taskId: "T001", sha: "a".repeat(40), entry: "old" });
		await h.run("grill", "add the a module");
		expect(h.notes.at(-1)?.text).toContain("earlier /execute run");
		expect(h.sent).toHaveLength(0);
	});

	it("another worktree of the same repo does not inherit the slug's ledger", () => {
		const h = harness(grillExtension as (pi: unknown) => void);
		commitFile(h.repo, "README.md", "base", "base");
		appendLedger(h.repo, SLUG, { kind: "accepted", taskId: "T001", sha: "a".repeat(40), entry: "old" });
		const other = `${h.repo}-wt`;
		repos.push(other);
		expect(spawnSync("git", ["worktree", "add", "-b", "other", other], { cwd: h.repo }).status).toBe(0);
		expect(readLedger(h.repo, SLUG)).toHaveLength(1);
		expect(readLedger(other, SLUG)).toHaveLength(0);
	});
});

describe("/plan -- refuses an ungated SPEC and gates whatever PLAN.md the model wrote", () => {
	it("refuses before prompting when SPEC.md fails the ambiguity gate", async () => {
		const h = harness(planExtension as (pi: unknown) => void);
		modelWrites(join(h.dir, "SPEC.md"), UNGATED_SPEC, 0);
		await h.run("plan", SLUG);
		expect(h.sent.length).toBe(0);
		expect(h.notes.at(-1)?.text).toContain("§8");
	});

	it("re-renders a passing PLAN.md and leaves a failing one refused", async () => {
		const h = harness(planExtension as (pi: unknown) => void);
		modelWrites(join(h.dir, "SPEC.md"), renderSpecMarkdown(SPEC), 0);
		await h.run("plan", SLUG);
		expect(h.sent.length).toBe(1);

		modelWrites(join(h.dir, "PLAN.md"), "- [ ] T001 [R9] Create the a module in src/a.ts | verify: npm test\n", 1);
		h.fire("agent_settled");
		expect(h.notes.at(-1)?.text).toContain("refused");
		const retry = h.fire("before_agent_start")[0] as { message: { content: string } };
		expect(retry.message.content).toContain("refused by the gate");

		modelWrites(join(h.dir, "PLAN.md"), "- [ ] T001 [R1] Create the a module in src/a.ts | verify: npm test\n", 2);
		h.fire("agent_settled");
		expect(h.notes.at(-1)?.level).toBe("info");
		expect(readFileSync(join(h.dir, "PLAN.md"), "utf-8")).toContain("## Task List");
		expect(existsSync(join(h.dir, "PLAN.md"))).toBe(true);
	});

	it("an aborted settle neither counts a turn nor gates the PLAN", async () => {
		const h = harness(planExtension as (pi: unknown) => void);
		modelWrites(join(h.dir, "SPEC.md"), renderSpecMarkdown(SPEC), 0);
		await h.run("plan", SLUG);
		modelWrites(join(h.dir, "PLAN.md"), "- [ ] T001 [R9] Create the a module in src/a.ts | verify: npm test\n", 1);
		const before = h.notes.length;
		for (let i = 0; i < HARD_QUESTION_BUDGET + 2; i++) h.fire("agent_settled", { aborted: true });
		expect(h.notes.slice(before), "an Esc is not a turn").toHaveLength(0);
		expect(h.fire("before_agent_start")[0], "the run is still armed").toBeUndefined();
		h.fire("agent_settled", { aborted: false });
		expect(h.notes.at(-1)?.text).toContain("refused");
	});

	it("disarms with an error after the same hard turn budget as /grill", async () => {
		const h = harness(planExtension as (pi: unknown) => void);
		modelWrites(join(h.dir, "SPEC.md"), renderSpecMarkdown(SPEC), 0);
		await h.run("plan", SLUG);
		modelWrites(join(h.dir, "PLAN.md"), "- [ ] T001 [R9] Create the a module in src/a.ts | verify: npm test\n", 1);
		for (let i = 0; i < HARD_QUESTION_BUDGET; i++) h.fire("agent_settled");
		expect(h.notes.at(-1)?.text, "armed for the final write turn").not.toContain("turns passed");
		const last = h.fire("before_agent_start")[0] as { message: { content: string } };
		expect(last.message.content).toContain("This is the last turn");
		h.fire("agent_settled");
		expect(h.notes.at(-1)?.level).toBe("error");
		expect(h.notes.at(-1)?.text).toContain("turns passed");
		expect(h.fire("before_agent_start")[0], "a spent /plan injects nothing into later turns").toBeUndefined();
	});

	it("stands down once another workflow command claims the session", async () => {
		const h = harness(planExtension as (pi: unknown) => void);
		modelWrites(join(h.dir, "SPEC.md"), renderSpecMarkdown(SPEC), 0);
		await h.run("plan", SLUG);
		modelWrites(join(h.dir, "PLAN.md"), "- [ ] T001 [R9] Create the a module in src/a.ts | verify: npm test\n", 1);
		h.fire("agent_settled");
		claimWorkflow("execute");
		expect(h.fire("before_agent_start")[0]).toBeUndefined();
		modelWrites(join(h.dir, "PLAN.md"), "- [ ] T001 [R1] Create the a module in src/a.ts | verify: npm test\n", 2);
		h.fire("agent_settled");
		expect(readFileSync(join(h.dir, "PLAN.md"), "utf-8"), "a retired /plan re-renders nothing").not.toContain("## Task List");
	});
});
