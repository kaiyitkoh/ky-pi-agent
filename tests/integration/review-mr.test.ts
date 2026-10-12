/**
 * The /review MR step, driven against an injected executor and a stubbed glab on PATH. No real glab runs.
 *
 * Proves: the harness's classification of glab invocations (target must be explicit and non-protected, merge is
 * refused) and the exact argv it would send, with a blocked call producing zero executions; the MR body's
 * contents. Injected-executor cases prove classification; the PATH-stub case proves the argv really reaches a
 * binary with no shell in between.
 * Does not prove: that GitLab accepts the request, that the
 * target branch exists, or that server-side branch protection is configured. Those need the work laptop.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SpecArtifact } from "../../.pi/extensions/grill/spec-schema.ts";
import type { PlanArtifact } from "../../.pi/extensions/plan-ceremony/plan-schema.ts";
import type { ReviewArtifact } from "../../.pi/extensions/quality/review-schema.ts";
import { renderProgressAppend } from "../../.pi/extensions/execute/progress.ts";
import {
	AI_AUTHORSHIP_DISCLOSURE, MAX_MR_BODY_CHARS, MR_BODY_FLAG, MR_TARGET_BRANCH, buildMrBody, historyMismatch, mrCreateArgv, openMr, spawnExec, upstreamMismatch, type MrExec,
} from "../../.pi/extensions/review/mr.ts";
import { classifyGlabInvocation } from "../../.pi/extensions/safety/git.ts";
import { PROTECTED_BRANCHES } from "../../.pi/extensions/safety/index.ts";
import { commitFile, makeTempRepo } from "../helpers/git.ts";
import { withStubBin } from "../helpers/stub-bin.ts";

const isWindows = process.platform === "win32";
const BODY_TEXT = "UNIQUE-BODY-TEXT-7f3a";

const SPEC = {
	goal: "Add the a module.",
	verifiedFacts: [],
	requirementsBody: "R1: create the a module so callers can import it.",
	errorBehaviours: [],
	scopePin: { inScope: ["a"], outOfScope: [{ item: "the b module", reason: "unrelated" }], expectedFiles: ["src/a.ts"] },
	clarificationsBody: "",
	assumptionsBody: "",
	scorecardBody: "",
} as unknown as SpecArtifact;

const PLAN = { tasks: [], coverageMatrix: new Map([["R1", ["T001"]]]), filesTouched: ["src/a.ts"] } as unknown as PlanArtifact;

const PROGRESS = renderProgressAppend({
	taskId: "T001", commitSha: "abc1234", verificationCommand: "npm test", output: "Tests 3 passed (3)", exitCode: 0, recordedAt: 0,
});

const REVIEW: ReviewArtifact = {
	verdicts: [{ requirementId: "R1", status: "Implemented", evidence: "src/a.ts:1" }],
	findings: [{ severity: "WARNING", location: "src/a.ts:9", concreteFailure: "unchecked input", suggestedFix: "validate" }],
	checkedAndCleared: "read src/a.ts in full",
	classification: "root-cause",
	classificationJustification: "fixes the cause",
};

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function recorder(): { exec: MrExec; calls: { file: string; args: string[] }[] } {
	const calls: { file: string; args: string[] }[] = [];
	return { calls, exec: (file, args) => (calls.push({ file, args }), { status: 0, stdout: "https://example.invalid/mr/1", stderr: "" }) };
}

const input = (targetBranch: string) => ({ targetBranch, title: "Add the a module", body: "## Why" });

describe("openMr classification (injected executor)", () => {
	it("allows an explicit staging target and sends it", () => {
		const r = recorder();
		const out = openMr(input("staging"), { exec: r.exec });
		expect(out.kind).toBe("opened");
		expect(r.calls).toHaveLength(1);
		const sent = [r.calls[0]?.file, ...(r.calls[0]?.args ?? [])].join(" ");
		expect(sent).toContain("--target-branch staging");
	});

	it.each(["main", "MAIN", "master", ""])("refuses target %j and executes nothing", (target) => {
		const r = recorder();
		const out = openMr(input(target), { exec: r.exec });
		expect(out.kind).toBe("refused");
		if (out.kind === "refused") expect(out.reason.length).toBeGreaterThan(0);
		expect(r.calls).toHaveLength(0);
	});

	it("MR_TARGET_BRANCH is not a protected branch", () => {
		const r = recorder();
		expect(openMr(input(MR_TARGET_BRANCH), { exec: r.exec }).kind).toBe("opened");
	});

	it("the classifier openMr relies on refuses mr merge even with a staging target", () => {
		const v = classifyGlabInvocation({ subcommand: "mr", args: ["merge", "--target-branch", "staging"] }, PROTECTED_BRANCHES);
		expect(v.kind).toBe("block");
	});

	it("passes the whole body as the single argv element after --description, straight to glab", () => {
		const r = recorder();
		const full = buildMrBody({ spec: { ...SPEC, goal: `${BODY_TEXT} %PATH% & "q"` }, plan: PLAN, progress: PROGRESS, review: REVIEW });
		expect(openMr({ targetBranch: "staging", title: "T", body: full }, { exec: r.exec }).kind).toBe("opened");
		expect(r.calls[0]?.file).toBe("glab");
		const args = r.calls[0]?.args ?? [];
		expect(args[args.indexOf(MR_BODY_FLAG) + 1]).toBe(full);
		expect(args.slice(0, 4)).toEqual(["mr", "create", "--target-branch", "staging"]);
	});

	it("refuses an over-long body rather than truncating the evidence", () => {
		const r = recorder();
		const out = openMr({ targetBranch: "staging", title: "T", body: "x".repeat(MAX_MR_BODY_CHARS + 1) }, { exec: r.exec });
		expect(out.kind).toBe("refused");
		expect(r.calls).toHaveLength(0);
	});

	it("counts quotes and backslashes twice, as Windows argv quoting does", () => {
		const r = recorder();
		const out = openMr({ targetBranch: "staging", title: "T", body: '"'.repeat(MAX_MR_BODY_CHARS / 2 + 1) }, { exec: r.exec });
		expect(out.kind).toBe("refused");
		expect(r.calls).toHaveLength(0);
	});

	it("mrCreateArgv always carries an explicit target", () => {
		expect(mrCreateArgv(input("anything"))).toContain("--target-branch");
	});
});

describe("buildMrBody", () => {
	const body = buildMrBody({ spec: SPEC, plan: PLAN, progress: PROGRESS, review: REVIEW });

	it("carries the disclosure, all six headings and the PROGRESS evidence", () => {
		expect(body).toContain(AI_AUTHORSHIP_DISCLOSURE);
		for (const h of ["## Why", "## What", "## Verification", "## Risk / look-here", "## Out of scope", "## Disclosure"]) {
			expect(body).toContain(h);
		}
		expect(body).toContain("Tests 3 passed (3)");
		expect(body).toContain("T001 @ abc1234");
	});

	it("is not derived from a diff", () => {
		expect(body).not.toMatch(/^(@@|\+\+\+|---) /m);
		expect(body).not.toContain("diff --git");
	});

	it("records the proper fix and deferral for a workaround", () => {
		const wb = buildMrBody({
			spec: SPEC, plan: PLAN, progress: PROGRESS,
			review: { ...REVIEW, classification: "workaround", properFix: "rewrite the cache layer", deferralReason: "needs a migration window" },
		});
		expect(wb).toContain("rewrite the cache layer");
		expect(wb).toContain("needs a migration window");
	});
});

describe("MR preconditions against a real temp repo (no remote)", () => {
	const entry = (taskId: string, sha: string) => renderProgressAppend({ taskId, commitSha: sha, verificationCommand: "npm test", output: "ok", exitCode: 0, recordedAt: 0 });
	const git = (repo: string, args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
	function repo(): string {
		const r = makeTempRepo("kypi-mrpre-");
		dirs.push(r);
		return r;
	}

	it("refuses a PLAN task with no PROGRESS entry", () => {
		const r = repo();
		const a = commitFile(r, "a.ts", "a\n", "a");
		expect(historyMismatch(r, ["T001", "T002"], entry("T001", a))).toContain("T002");
	});

	it("refuses commits after the last recorded entry, and accepts when the last entry is HEAD", () => {
		const r = repo();
		const a = commitFile(r, "a.ts", "a\n", "a");
		expect(historyMismatch(r, ["T001"], entry("T001", a))).toBeUndefined();
		commitFile(r, "b.ts", "b\n", "unrecorded");
		expect(historyMismatch(r, ["T001"], entry("T001", a))).toContain("no verification covers");
	});

	it("refuses a recorded commit that is not on HEAD's history", () => {
		const r = repo();
		commitFile(r, "base.txt", "base\n", "base");
		git(r, ["checkout", "-b", "side"]);
		const side = commitFile(r, "s.ts", "s\n", "side");
		git(r, ["checkout", "work"]);
		const a = commitFile(r, "a.ts", "a\n", "a");
		expect(historyMismatch(r, ["T001", "T002"], entry("T001", side) + entry("T002", a))).toContain("not on HEAD's history");
	});

	it("needs an upstream that equals HEAD", () => {
		const r = repo();
		commitFile(r, "a.ts", "a\n", "a");
		expect(upstreamMismatch(r)).toContain("no upstream");
		git(r, ["branch", "pushed"]);
		git(r, ["branch", "--set-upstream-to=pushed"]);
		expect(upstreamMismatch(r)).toBeUndefined();
		commitFile(r, "b.ts", "b\n", "b");
		expect(upstreamMismatch(r)).toContain("push first");
	});
});

describe("stubbed glab on PATH", () => {
	// The stub is a .cmd on Windows; without a shell it is not found, which is the refusal the executor promises.
	it.skipIf(isWindows)("receives the exact argv for an allowed mr create, and the stub's own log proves it", () => {
		const dir = mkdtempSync(join(tmpdir(), "kypi-mrlog-"));
		dirs.push(dir);
		mkdirSync(dir, { recursive: true });
		const logTo = join(dir, "calls.log");
		const out = withStubBin(
			{ glab: { logTo, match: [{ when: ["mr", "create"], stdout: "https://example.invalid/mr/1\n" }, { when: ["merge"], exitCode: 9 }] } },
			(env) => openMr({ targetBranch: "staging", title: "Add the a module", body: "## Why" }, { exec: spawnExec(dir, env) }),
		);
		expect(out.kind).toBe("opened");
		const log = readFileSync(logTo, "utf-8").trim().split("\n");
		expect(log).toHaveLength(1);
		expect(log[0]).toContain("glab mr create --target-branch staging --title");
		expect(log[0]).toContain("--description");
	});

	it.runIf(isWindows)("a .cmd shim glab is reported as not startable without a shell, never run through cmd.exe", () => {
		const dir = mkdtempSync(join(tmpdir(), "kypi-mrlog-"));
		dirs.push(dir);
		const logTo = join(dir, "calls.log");
		const out = withStubBin({ glab: { logTo } }, (env) => openMr(input("staging"), { exec: spawnExec(dir, env) }));
		expect(out.kind).toBe("failed");
		if (out.kind === "failed") expect(out.stderr).toContain("without a shell");
		let log = "";
		try { log = readFileSync(logTo, "utf-8"); } catch { /* never created */ }
		expect(log).toBe("");
	});

	it("a missing binary is reported as not installed, a timeout as possibly already created", () => {
		const dir = mkdtempSync(join(tmpdir(), "kypi-mrlog-"));
		dirs.push(dir);
		expect(spawnExec(dir, undefined)("kypi-no-such-glab", []).stderr).toContain("native executable");
		const slow = spawnExec(dir, undefined, 200)(process.execPath, ["-e", "setTimeout(() => {}, 5000)"]);
		expect(slow.status).toBeNull();
		expect(slow.stderr).toContain("may already have created the MR");
		expect(slow.stderr).not.toContain("native executable");
	});

	it("a blocked target never reaches the stub", () => {
		const dir = mkdtempSync(join(tmpdir(), "kypi-mrlog-"));
		dirs.push(dir);
		const logTo = join(dir, "calls.log");
		const out = withStubBin({ glab: { logTo } }, (env) => openMr(input("main"), { exec: spawnExec(dir, env) }));
		expect(out.kind).toBe("refused");
		let log = "";
		try { log = readFileSync(logTo, "utf-8"); } catch { /* never created */ }
		expect(log).toBe("");
	});
});
