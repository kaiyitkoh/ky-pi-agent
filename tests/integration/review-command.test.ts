/**
 * /review driven through its real command handler in a temp git repo, with the two model calls and glab replaced:
 * slug resolution, the stop/approval branch, "MR only after REVIEW.md" and the drift approval are exercised for real.
 * No model, no glab and no remote are contacted.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { allowanceOf, appendLedger, ledgerFile, specDigest, tasksOf } from "../../.pi/extensions/execute/ledger.ts";
import { validatePlan } from "../../.pi/extensions/plan-ceremony/plan-schema.ts";
import { renderProgressAppend } from "../../.pi/extensions/execute/progress.ts";
import { renderSpecMarkdown, type SpecArtifact } from "../../.pi/extensions/grill/spec-schema.ts";
import { setQuickGateExecOverrideForTests, typecheckAtCommit, typecheckBaseline } from "../../.pi/extensions/quality/index.ts";
import { buildReviewerContext } from "../../.pi/extensions/quality/reviewer.ts";
import type { ReviewArtifact } from "../../.pi/extensions/quality/review-schema.ts";
import { commitFile, makeTempRepo } from "../helpers/git.ts";

/** The pin /execute would write for the SPEC and PLAN currently on disk. */
function livePin(repo: string): { tasks: ReturnType<typeof tasksOf>; specHash: string } {
	const dir = join(repo, ".pi", "work", SLUG);
	const plan = validatePlan(readFileSync(join(dir, "PLAN.md"), "utf-8"), ["R1"]);
	if (!plan.ok) throw new Error(plan.reason);
	return { tasks: tasksOf(plan.plan.tasks), specHash: specDigest(readFileSync(join(dir, "SPEC.md"), "utf-8")) };
}

const mocks = vi.hoisted(() => ({
	review: undefined as unknown,
	designCalls: 0,
	designNotice: undefined as string | undefined,
	context: "",
	calls: [] as { args: string[]; reviewWritten: boolean }[],
	reviewPath: "",
}));

vi.mock("../../.pi/extensions/quality/reviewer.ts", async (importOriginal) => ({
	...(await importOriginal<object>()),
	runReview: async (_ctx: unknown, input: { contract: Parameters<typeof buildReviewerContext>[0] }) => {
		mocks.context = buildReviewerContext(input.contract);
		return { ok: true, review: mocks.review };
	},
}));
vi.mock("../../.pi/extensions/quality/design-review.ts", async (importOriginal) => ({
	...(await importOriginal<object>()),
	runDesignReview: async () => {
		mocks.designCalls += 1;
		if (mocks.designNotice !== undefined) return { findings: [], notice: mocks.designNotice };
		return { findings: [{ severity: "WARNING", location: "src/a.ts:1", concreteFailure: "quadratic scan", suggestedFix: "index it" }] };
	},
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
	mocks.designCalls = 0;
	mocks.designNotice = undefined;
	mocks.review = CLEAN;
});
afterEach(() => {
	setQuickGateExecOverrideForTests(undefined);
	for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

const git = (repo: string, args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });

/** A repo whose HEAD is one recorded, pushed task commit on top of `staging`; `extra` lands in the same commit. */
function setup(extra?: string, aSource = "export const a = 1;\n", opts: { aName?: string; deleteOld?: boolean; tsconfig?: boolean } = {}) {
	const aName = opts.aName ?? "a.ts";
	const extras = extra === undefined ? [] : extra.split(",");
	const repo = makeTempRepo("kypi-review-");
	repos.push(repo);
	let baseSha = commitFile(repo, "README.md", "base\n", "base");
	if (opts.tsconfig) baseSha = commitFile(repo, "tsconfig.json", '{"compilerOptions":{},"files":["src/a.ts"]}\n', "tsconfig");
	mkdirSync(join(repo, "src"), { recursive: true });
	if (opts.deleteOld) commitFile(repo, "src/old.ts", "old\n", "old");
	git(repo, ["branch", "staging"]);
	if (!opts.deleteOld) writeFileSync(join(repo, "src", aName), aSource);
	for (const e of extras) writeFileSync(join(repo, "src", e), "const x = 1;\n");
	let sha: string;
	if (opts.deleteOld) {
		git(repo, ["rm", "-q", "--", "src/old.ts"]);
		git(repo, ["commit", "-q", "-m", "task"]);
		sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf-8" }).trim();
	} else {
		sha = commitFile(repo, `src/${aName}`, aSource, "task");
	}
	if (extras.length > 0) {
		git(repo, ["add", "--", ...extras.map((e) => `src/${e}`)]);
		git(repo, ["commit", "--amend", "--no-edit"]);
	}
	const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf-8" }).trim();
	git(repo, ["update-ref", "refs/remotes/origin/work", "HEAD"]);
	const dir = join(repo, ".pi", "work", SLUG);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SPEC.md"), renderSpecMarkdown(SPEC));
	writeFileSync(join(dir, "PLAN.md"), "- [ ] T001 [R1] Create the a module in src/a.ts | verify: npm test\n");
	const recordedSha = extras.length === 0 ? sha : head;
	const entry = renderProgressAppend({ taskId: "T001", commitSha: recordedSha, verificationCommand: "npm test", output: "ok", exitCode: 0, recordedAt: 0 });
	writeFileSync(join(dir, "PROGRESS.md"), entry);
	appendLedger(repo, SLUG, { kind: "base", sha: baseSha, allowance: allowanceOf(SPEC.scopePin.expectedFiles, ["src/a.ts"]), ...livePin(repo), reason: "test" });
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
	it("a Terraform-only change reviews through to REVIEW.md with the import graph marked empty", async () => {
		const h = setup(undefined, 'resource "null_resource" "a" {}\n', { aName: "main.tf" });
		await h.run(SLUG);
		expect(existsSync(mocks.reviewPath), h.notes.map((n) => n.text).join("; ")).toBe(true);
		expect(mocks.context).toContain("none: no JavaScript or TypeScript file changed");
	});

	it("a deletion-only change reviews through to REVIEW.md with the deleted path listed", async () => {
		const h = setup(undefined, "", { deleteOld: true });
		await h.run(SLUG);
		expect(existsSync(mocks.reviewPath), h.notes.map((n) => n.text).join("; ")).toBe(true);
		expect(mocks.context).toContain("(deleted in this change)");
		expect(mocks.context, "a deleted file was never read, so its imports were not measured").not.toContain("src/old.ts: (no declared imports)");
	});

	it("refuses with the branch name and a fetch hint when staging exists nowhere", async () => {
		const h = setup();
		git(h.repo, ["branch", "-D", "staging"]);
		await h.run(SLUG);
		expect(existsSync(mocks.reviewPath)).toBe(false);
		const last = h.notes.at(-1);
		expect(last?.level).toBe("error");
		expect(last?.text).toContain('"staging"');
		expect(last?.text).toContain("git fetch");
	});

	it("measures against the remote-tracking staging ref, not a stale local branch", async () => {
		const h = setup();
		git(h.repo, ["update-ref", "refs/remotes/origin/staging", "HEAD"]);
		await h.run(SLUG);
		expect(existsSync(mocks.reviewPath), "origin/staging is HEAD, so nothing changed against it; a local-branch base would have reviewed a.ts").toBe(false);
		expect(mocks.calls).toHaveLength(0);
	});

	it("a Missing requirement verdict needs approval, and a decline opens nothing", async () => {
		mocks.review = { ...CLEAN, verdicts: [{ requirementId: "R1", status: "Missing", evidence: "src/a.ts:1" }] };
		const h = setup();
		h.setApprove(false);
		await h.run(SLUG);
		expect(h.confirms.join("\n")).toContain("R1: Missing");
		expect(mocks.calls).toHaveLength(0);
	});

	it("an approved Missing verdict opens the MR and the body lists the verdict", async () => {
		mocks.review = { ...CLEAN, verdicts: [{ requirementId: "R1", status: "Partial", evidence: "src/a.ts:1" }] };
		const h = setup();
		await h.run(SLUG);
		expect(mocks.calls).toHaveLength(1);
		const body = mocks.calls[0]?.args.at(-1) ?? "";
		expect(body).toContain("- R1: Partial (src/a.ts:1)");
	});

	it("an eight-file change runs the design pass once and REVIEW.md carries its section and findings", async () => {
		const h = setup("b.ts,c.ts,d.ts,e.ts,f.ts,g.ts,h.ts", "const a = 1;\n");
		await h.run(SLUG);
		expect(mocks.designCalls).toBe(1);
		const md = readFileSync(mocks.reviewPath, "utf-8");
		expect(md).toContain("## Design review");
		expect(md).toContain("Ran:");
		expect(md).toContain("[design] quadratic scan");
	});

	it("a one-file change makes no design call and REVIEW.md says why", async () => {
		const h = setup(undefined, "const a = 1;\n");
		await h.run(SLUG);
		expect(mocks.designCalls).toBe(0);
		const md = readFileSync(mocks.reviewPath, "utf-8");
		expect(md).toContain("Did not fire: no signal fired");
		expect(md).toContain("filesTouched=1");
	});

	it("an added export fires the design pass on a one-file change", async () => {
		const h = setup();
		await h.run(SLUG);
		expect(mocks.designCalls).toBe(1);
	});

	it("a design pass that failed asks before the MR opens, and a refusal opens none", async () => {
		mocks.designNotice = "the design pass failed (aborted); it added no findings";
		const h = setup();
		h.setApprove(false);
		await h.run(SLUG);
		expect(mocks.designCalls).toBe(1);
		expect(h.confirms.join("\n")).toContain("the design pass failed");
		expect(mocks.calls).toHaveLength(0);
	});

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

	it("refuses when PLAN.md's verification command no longer matches the one /execute pinned", async () => {
		const h = setup();
		writeFileSync(join(h.repo, ".pi", "work", SLUG, "PLAN.md"), "- [ ] T001 [R1] Create the a module in src/a.ts | verify: true\n");
		await h.run(SLUG);
		expect(h.notes.at(-1)?.text).toContain("changed since /execute pinned them");
		expect(mocks.calls).toHaveLength(0);
	});

	it("refuses when SPEC.md changed after /execute pinned it, and a --repin row clears it without reading as a rebase", async () => {
		const h = setup();
		const specFile = join(h.repo, ".pi", "work", SLUG, "SPEC.md");
		writeFileSync(specFile, readFileSync(specFile, "utf-8").replace("create the a module so callers", "create the a module so nobody"));
		await h.run(SLUG);
		expect(h.notes.at(-1)?.text).toContain("SPEC.md changed since /execute pinned them");
		expect(mocks.calls).toHaveLength(0);

		appendLedger(h.repo, SLUG, { kind: "pin", allowance: allowanceOf(SPEC.scopePin.expectedFiles, ["src/a.ts"]), ...livePin(h.repo), reason: "test re-pin" });
		await h.run(SLUG);
		expect(mocks.calls).toHaveLength(1);
		expect(mocks.calls[0]?.args.at(-1)).not.toContain("Re-pinned at");
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
		appendLedger(h.repo, SLUG, { kind: "base", sha: head, allowance: allowanceOf(SPEC.scopePin.expectedFiles, ["src/a.ts"]), ...livePin(h.repo), reason: "test re-pin" });
		await h.run(SLUG);
		expect(mocks.calls).toHaveLength(1);
		expect(mocks.calls[0]?.args.at(-1)).toContain(`Re-pinned at ${head}`);
	});

	it("a ledger row that fails its signature refuses the review", async () => {
		const h = setup();
		const file = ledgerFile(h.repo, SLUG);
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

	it("harness state the checkpoint store and the logs write into the work repo does not count as dirty", async () => {
		const h = setup();
		for (const f of [".pi/state/checkpoints.json", ".pi/logs/wire-x.jsonl"]) {
			mkdirSync(join(h.repo, f, ".."), { recursive: true });
			writeFileSync(join(h.repo, f), "[]");
		}
		await h.run(SLUG);
		expect(mocks.calls).toHaveLength(1);
	});

	it("refuses to open an MR for an unpushed HEAD", async () => {
		const h = setup();
		git(h.repo, ["update-ref", "-d", "refs/remotes/origin/work"]);
		await h.run(SLUG);
		expect(h.notes.at(-1)?.text).toContain("origin/work does not exist");
		expect(mocks.calls).toHaveLength(0);
	});

	describe("the typecheck baseline", () => {
		const fakeTsc = (opts: { baseFails: boolean }) => {
			const cwds: string[] = [];
			setQuickGateExecOverrideForTests((cmd, _args, cwd) => {
				if (cmd !== "tsc") throw new Error("not installed");
				cwds.push(cwd);
				const atBase = cwd.includes("ky-review-base-");
				return atBase && !opts.baseFails ? { code: 0, stdout: "", stderr: "" } : { code: 1, stdout: "src/a.ts(1,1): error TS2322: boom", stderr: "" };
			});
			return cwds;
		};

		it("refuses when the typecheck fails at HEAD but passes at the merge base", async () => {
			const h = setup(undefined, undefined, { tsconfig: true });
			const cwds = fakeTsc({ baseFails: false });
			await h.run(SLUG);
			expect(h.notes.at(-1)?.text).toContain("the change breaks the typecheck");
			expect(existsSync(mocks.reviewPath)).toBe(false);
			expect(cwds.filter((c) => c.includes("ky-review-base-"))).toHaveLength(1);
		});

		it("asks, saying the failure predates the change, when the merge base fails too", async () => {
			const h = setup(undefined, undefined, { tsconfig: true });
			fakeTsc({ baseFails: true });
			await h.run(SLUG);
			expect(h.confirms.join("\n")).toContain("already failed at the merge base");
		});

		it("never builds the base worktree when HEAD passes", async () => {
			const h = setup(undefined, undefined, { tsconfig: true });
			const calls: string[] = [];
			setQuickGateExecOverrideForTests((cmd, _args, cwd) => {
				if (cmd !== "tsc") throw new Error("not installed");
				calls.push(cwd);
				return { code: 0, stdout: "", stderr: "" };
			});
			await h.run(SLUG);
			expect(calls).toHaveLength(1);
		});

		it("asks, saying the merge base could not be checked, when tsc cannot run there", async () => {
			const h = setup(undefined, undefined, { tsconfig: true });
			setQuickGateExecOverrideForTests((cmd, _args, cwd) => {
				if (cmd !== "tsc" || cwd.includes("ky-review-base-")) throw new Error("tsc not spawnable");
				return { code: 1, stdout: "src/a.ts(1,1): error TS2322: boom", stderr: "" };
			});
			await h.run(SLUG);
			expect(h.notes.map((n) => n.text).join("\n")).not.toContain("the change breaks the typecheck");
			expect(h.confirms.join("\n")).toContain("could not be checked");
			expect(h.confirms.join("\n")).toContain("tsc not spawnable");
		});

		it("a merge base the worktree cannot be built from is an error, never a pass", () => {
			const h = setup(undefined, undefined, { tsconfig: true });
			fakeTsc({ baseFails: false });
			const missing = "0".repeat(40);
			const atBase = typecheckAtCommit(h.repo, missing, false);
			expect(typeof atBase === "object" && atBase.error).toContain("git worktree add");
			const baseline = typecheckBaseline(h.repo, missing, false, "report");
			expect(baseline.refusal).toBeUndefined();
			expect(baseline.doubt).toContain("could not be checked");
			expect(readdirSync(join(h.repo, ".git")).filter((n) => n.startsWith("ky-review-base-"))).toEqual([]);
		});

		it("leaves no worktree behind", async () => {
			const h = setup(undefined, undefined, { tsconfig: true });
			fakeTsc({ baseFails: false });
			await h.run(SLUG);
			const listed = execFileSync("git", ["worktree", "list"], { cwd: h.repo, encoding: "utf-8" });
			expect(listed).not.toContain("ky-review-base-");
		});
	});
});
