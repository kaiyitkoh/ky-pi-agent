/**
 * /review driven through its real command handler in a temp git repo, with the two model calls and glab replaced:
 * slug resolution, the stop/approval branch, "MR only after REVIEW.md" and the drift approval are exercised for real.
 * No model, no glab and no remote are contacted.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LEDGER_DIR, allowanceOf, appendLedger } from "../../.pi/extensions/execute/ledger.ts";
import { renderProgressAppend } from "../../.pi/extensions/execute/progress.ts";
import { renderSpecMarkdown, type SpecArtifact } from "../../.pi/extensions/grill/spec-schema.ts";
import type { ReviewArtifact } from "../../.pi/extensions/quality/review-schema.ts";
import { commitFile, makeTempRepo } from "../helpers/git.ts";

const mocks = vi.hoisted(() => ({
	review: undefined as unknown,
	calls: [] as { args: string[]; reviewWritten: boolean }[],
	reviewPath: "",
}));

vi.mock("../../.pi/extensions/quality/reviewer.ts", async (importOriginal) => ({
	...(await importOriginal<object>()),
	runReview: async () => ({ ok: true, review: mocks.review }),
}));
vi.mock("../../.pi/extensions/quality/verdict.ts", async (importOriginal) => ({
	...(await importOriginal<object>()),
	runRefuteOrPromote: async (_ctx: unknown, review: ReviewArtifact) => ({ promoted: review.findings.filter((f) => f.severity === "BLOCKER"), withdrawn: [] }),
}));
vi.mock("../../.pi/extensions/review/mr.ts", async (importOriginal) => ({
	...(await importOriginal<object>()),
	spawnExec: () => (_file: string, args: string[]) => {
		mocks.calls.push({ args, reviewWritten: existsSync(mocks.reviewPath) });
		return { status: 0, stdout: "https://example.invalid/mr/1", stderr: "" };
	},
}));

const { default: reviewExtension } = await import("../../.pi/extensions/review/index.ts");

const SLUG = "s1";
const SPEC: SpecArtifact = {
	goal: "Add the a module.",
	verifiedFacts: [{ claim: "the module lives at src/a.ts", evidence: "src/a.ts:1", howVerified: "read the file" }],
	requirementsBody: "R1: create the a module so callers can import it.",
	errorBehaviours: [
		"IF the module is missing THEN THE SYSTEM SHALL fail the import",
		"IF the input is empty THEN THE SYSTEM SHALL reject it",
		"IF the store is unreachable THEN THE SYSTEM SHALL fail closed",
	],
	scopePin: { inScope: ["the a module"], outOfScope: [{ item: "the b module", reason: "unrelated" }], expectedFiles: ["src/a.ts"] },
	clarificationsBody: "- Q: none -> A: none",
	assumptionsBody: "none",
	scorecardBody: ["| factual-grounding | 0.9 |", "| requirement-precision | 0.9 |", "| failure-coverage | 0.9 |", "| scope-definiteness | 0.9 |", "Overall: 0.1"].join("\n"),
};
const CLEAN: ReviewArtifact = {
	verdicts: [{ requirementId: "R1", status: "Implemented", evidence: "src/a.ts:1" }],
	findings: [],
	checkedAndCleared: "read src/a.ts",
	classification: "root-cause",
	classificationJustification: "fixes the cause",
};

const repos: string[] = [];
beforeEach(() => {
	mocks.calls = [];
	mocks.review = CLEAN;
});
afterEach(() => {
	for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

const git = (repo: string, args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });

/** A repo whose HEAD is one recorded, pushed task commit on top of `staging`; `extra` lands in the same commit. */
function setup(extra?: string) {
	const repo = makeTempRepo("kypi-review-");
	repos.push(repo);
	const baseSha = commitFile(repo, "README.md", "base\n", "base");
	git(repo, ["branch", "staging"]);
	mkdirSync(join(repo, "src"), { recursive: true });
	writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
	if (extra !== undefined) writeFileSync(join(repo, "src", extra), "export const x = 1;\n");
	const sha = commitFile(repo, "src/a.ts", "export const a = 1;\n", "task");
	if (extra !== undefined) {
		git(repo, ["add", "--", `src/${extra}`]);
		git(repo, ["commit", "--amend", "--no-edit"]);
	}
	const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf-8" }).trim();
	git(repo, ["update-ref", "refs/remotes/origin/work", "HEAD"]);
	const dir = join(repo, ".pi", "work", SLUG);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SPEC.md"), renderSpecMarkdown(SPEC));
	writeFileSync(join(dir, "PLAN.md"), "- [ ] T001 [R1] Create the a module in src/a.ts | verify: npm test\n");
	const recordedSha = extra === undefined ? sha : head;
	const entry = renderProgressAppend({ taskId: "T001", commitSha: recordedSha, verificationCommand: "npm test", output: "ok", exitCode: 0, recordedAt: 0 });
	writeFileSync(join(dir, "PROGRESS.md"), entry);
	appendLedger(repo, SLUG, { kind: "base", sha: baseSha, allowance: allowanceOf(SPEC.scopePin.expectedFiles, ["src/a.ts"]), reason: "test" });
	appendLedger(repo, SLUG, { kind: "accepted", taskId: "T001", sha: recordedSha, entry });
	mocks.reviewPath = join(dir, "REVIEW.md");

	const notes: { text: string; level: string }[] = [];
	const confirms: string[] = [];
	let approve = true;
	let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	(reviewExtension as (pi: unknown) => void)({ registerCommand: (_n: string, def: { handler: typeof handler }) => void (handler = def.handler) });
	const ctx = {
		cwd: repo,
		isProjectTrusted: () => false,
		ui: {
			notify: (text: string, level: string) => void notes.push({ text, level }),
			confirm: async (_title: string, body: string) => (confirms.push(body), approve),
		},
	};
	return { repo, notes, confirms, setApprove: (v: boolean) => void (approve = v), run: (args = "") => (handler as NonNullable<typeof handler>)(args, ctx) };
}

describe("/review -- the real handler", () => {
	it("writes REVIEW.md, then opens exactly one MR against staging", async () => {
		const h = setup();
		await h.run();
		expect(mocks.calls).toHaveLength(1);
		expect(mocks.calls[0]?.reviewWritten, "the MR must only ever follow REVIEW.md").toBe(true);
		expect(mocks.calls[0]?.args.slice(0, 6)).toEqual(["mr", "create", "--target-branch", "staging", "--source-branch", "work"]);
		expect(h.notes.at(-1)?.text).toContain("MR opened");
	});

	it("an undeclared changed path needs approval, and a decline opens nothing", async () => {
		const h = setup("b.ts");
		h.setApprove(false);
		await h.run(SLUG);
		expect(h.confirms.join("\n")).toContain("src/b.ts");
		expect(existsSync(mocks.reviewPath)).toBe(true);
		expect(mocks.calls).toHaveLength(0);
		expect(h.notes.at(-1)?.text).toContain("approval declined");
	});

	it("a surviving BLOCKER stops the MR without asking", async () => {
		mocks.review = { ...CLEAN, findings: [{ severity: "BLOCKER", location: "src/a.ts:1", concreteFailure: "crashes", suggestedFix: "guard" }] };
		const h = setup();
		await h.run(SLUG);
		expect(h.confirms).toHaveLength(0);
		expect(mocks.calls).toHaveLength(0);
		expect(h.notes.at(-1)?.text).toContain("not opening an MR");
	});

	it("refuses when no slug has a PROGRESS.md", async () => {
		const h = setup();
		rmSync(join(h.repo, ".pi", "work", SLUG, "PROGRESS.md"));
		await h.run();
		expect(h.notes.at(-1)?.text).toContain("run /execute first");
		expect(mocks.calls).toHaveLength(0);
	});

	it("the MR's Verification section comes from the signed ledger, not from an edited PROGRESS.md", async () => {
		const h = setup();
		appendFileSync(join(h.repo, ".pi", "work", SLUG, "PROGRESS.md"), "\n## T001 @ " + "f".repeat(40) + "\n\nFORGED 99 passed\n");
		await h.run(SLUG);
		expect(mocks.calls).toHaveLength(1);
		const body = mocks.calls[0]?.args.at(-1) ?? "";
		expect(body).toContain("### T001 @");
		expect(body).not.toContain("FORGED");
	});

	it("after a rebase, /review refuses until the user re-pins, then discloses the re-pin in the MR", async () => {
		const h = setup();
		git(h.repo, ["commit", "--amend", "--no-edit", "-m", "task, rebased"]);
		git(h.repo, ["update-ref", "refs/remotes/origin/work", "HEAD"]);
		await h.run(SLUG);
		expect(h.notes.at(-1)?.text).toContain("--rebase-base");
		expect(mocks.calls).toHaveLength(0);

		const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: h.repo, encoding: "utf-8" }).trim();
		appendLedger(h.repo, SLUG, { kind: "base", sha: head, allowance: allowanceOf(SPEC.scopePin.expectedFiles, ["src/a.ts"]), reason: "test re-pin" });
		await h.run(SLUG);
		expect(mocks.calls).toHaveLength(1);
		expect(mocks.calls[0]?.args.at(-1)).toContain(`Re-pinned at ${head}`);
	});

	it("a ledger row that fails its signature refuses the review", async () => {
		const h = setup();
		const file = join(h.repo, ".git", LEDGER_DIR, `${SLUG}.jsonl`);
		writeFileSync(file, readFileSync(file, "utf-8").replace("ok", "99 passed"));
		await h.run(SLUG);
		expect(h.notes.at(-1)?.text).toContain("fails its signature");
		expect(mocks.calls).toHaveLength(0);
	});

	it("a write allowance widened after /execute pinned it refuses the review", async () => {
		const h = setup();
		writeFileSync(join(h.repo, ".pi", "work", SLUG, "PLAN.md"), "- [ ] T001 [R1] Create the a module in src/a.ts and src/b.ts | verify: npm test\n");
		await h.run(SLUG);
		expect(h.notes.at(-1)?.text).toContain("write allowance changed");
		expect(mocks.calls).toHaveLength(0);
	});

	it("refuses a working tree that is not HEAD before any review runs", async () => {
		const h = setup();
		writeFileSync(join(h.repo, "src", "stray.ts"), "export const s = 1;\n");
		await h.run(SLUG);
		expect(h.notes.at(-1)?.text).toContain("src/stray.ts");
		expect(existsSync(mocks.reviewPath)).toBe(false);
		expect(mocks.calls).toHaveLength(0);
	});

	it("refuses to open an MR for an unpushed HEAD", async () => {
		const h = setup();
		git(h.repo, ["update-ref", "-d", "refs/remotes/origin/work"]);
		await h.run(SLUG);
		expect(h.notes.at(-1)?.text).toContain("origin/work does not exist");
		expect(mocks.calls).toHaveLength(0);
	});
});
