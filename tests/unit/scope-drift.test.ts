import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MAX_TOUCHED_FILE_BYTES, compareScope, readTouchedFiles, resolveBaseRef } from "../../.pi/extensions/review/scope-drift.ts";
import { commitFile, headSha, makeTempRepo } from "../helpers/git.ts";

interface Row {
	readonly name: string;
	readonly why: string;
	readonly changed: string[];
	readonly spec: string[];
	readonly plan: string[];
	readonly drifted: string[];
	readonly undelivered: string[];
}

const ROWS: Row[] = [
	{
		name: "in-scope diff",
		why: "negative control: without it, drifted = changed would pass every positive row",
		changed: ["src/a.ts"],
		spec: ["src/a.ts"],
		plan: [],
		drifted: [],
		undelivered: [],
	},
	{
		name: "one path outside the union",
		why: "the undeclared path, and only it, is drift",
		changed: ["src/a.ts", "src/rogue.ts"],
		spec: ["src/a.ts"],
		plan: [],
		drifted: ["src/rogue.ts"],
		undelivered: [],
	},
	{
		name: "declared but never changed",
		why: "a SPEC declaring five files and delivering one must not read clean",
		changed: ["src/a.ts"],
		spec: ["src/a.ts", "src/b.ts"],
		plan: [],
		drifted: [],
		undelivered: ["src/b.ts"],
	},
	{
		name: "both directions at once",
		why: "the two lists are independent",
		changed: ["src/rogue.ts"],
		spec: ["src/b.ts"],
		plan: [],
		drifted: ["src/rogue.ts"],
		undelivered: ["src/b.ts"],
	},
	{
		name: "declared only in PLAN, changed",
		why: "the allowance is the union, so narrowing it to an intersection must turn this red",
		changed: ["src/p.ts"],
		spec: ["src/a.ts"],
		plan: ["src/p.ts"],
		drifted: [],
		undelivered: ["src/a.ts"],
	},
	{
		name: "declared only in SPEC, changed",
		why: "the other half of the union",
		changed: ["src/s.ts"],
		spec: ["src/s.ts"],
		plan: ["src/p.ts"],
		drifted: [],
		undelivered: ["src/p.ts"],
	},
	{
		name: "backslash and ./ forms",
		why: "one normalisation shared with driftAbort",
		changed: ["src\\a.ts", "./src/b.ts"],
		spec: ["./src/a.ts", "src\\b.ts"],
		plan: [],
		drifted: [],
		undelivered: [],
	},
	{
		name: "empty declaration",
		why: "fail closed: nothing declared means every change is drift, as with driftAbort",
		changed: ["src/a.ts"],
		spec: [],
		plan: [],
		drifted: ["src/a.ts"],
		undelivered: [],
	},
];

describe("compareScope", () => {
	for (const row of ROWS) {
		it(`${row.name} (${row.why})`, () => {
			const report = compareScope({ changed: row.changed, specExpectedFiles: row.spec, planFilesTouched: row.plan });
			expect(report.drifted).toEqual(row.drifted);
			expect(report.undelivered).toEqual(row.undelivered);
		});
	}
});

const scratch: string[] = [];
afterEach(() => {
	for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});
const git = (repo: string, args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });

describe("resolveBaseRef", () => {
	it("prefers the remote-tracking staging ref over a stale local branch", () => {
		const repo = makeTempRepo("kypi-base-");
		scratch.push(repo);
		commitFile(repo, "a.txt", "1", "one");
		git(repo, ["branch", "staging"]);
		commitFile(repo, "a.txt", "2", "two");
		git(repo, ["update-ref", "refs/remotes/origin/staging", headSha(repo)]);
		expect(resolveBaseRef(repo, "staging")).toEqual({ ok: true, ref: "refs/remotes/origin/staging" });
	});

	it("falls back to a local staging branch when there is no remote-tracking ref", () => {
		const repo = makeTempRepo("kypi-base-");
		scratch.push(repo);
		commitFile(repo, "a.txt", "1", "one");
		git(repo, ["branch", "staging"]);
		expect(resolveBaseRef(repo, "staging")).toEqual({ ok: true, ref: "refs/heads/staging" });
	});

	it("refuses with the branch name and the fetch command when staging exists nowhere", () => {
		const repo = makeTempRepo("kypi-base-");
		scratch.push(repo);
		commitFile(repo, "a.txt", "1", "one");
		const r = resolveBaseRef(repo, "staging");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.reason).toContain('"staging"');
			expect(r.reason).toContain("git fetch origin staging");
		}
	});
});

describe("readTouchedFiles", () => {
	function dir(): string {
		const d = mkdtempSync(join(tmpdir(), "kypi-touched-"));
		scratch.push(d);
		return d;
	}

	it("returns text in full and notes a deleted path instead of throwing", () => {
		const d = dir();
		writeFileSync(join(d, "a.ts"), "const a = 1;\n");
		const [a, gone] = readTouchedFiles(d, ["a.ts", "gone.ts"]);
		expect(a).toEqual({ path: "a.ts", contents: "const a = 1;\n" });
		expect(gone?.contents).toContain("deleted");
	});

	it("omits a binary file's bytes and says so with its size", () => {
		const d = dir();
		writeFileSync(join(d, "img.bin"), Buffer.from([1, 2, 0, 3, 4]));
		const [bin] = readTouchedFiles(d, ["img.bin"]);
		expect(bin?.contents).toBe("(content omitted: binary, 5 bytes)");
	});

	it.each(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "poetry.lock"])("omits the %s lockfile", (name) => {
		const d = dir();
		mkdirSync(join(d, "sub"));
		writeFileSync(join(d, "sub", name), "x".repeat(50));
		const [lock] = readTouchedFiles(d, [`sub/${name}`]);
		expect(lock?.contents).toBe("(content omitted: lockfile, 50 bytes)");
	});

	it("cuts a text file over the cap and marks the cut", () => {
		const d = dir();
		writeFileSync(join(d, "big.txt"), "y".repeat(MAX_TOUCHED_FILE_BYTES + 500));
		const [big] = readTouchedFiles(d, ["big.txt"]);
		expect(big?.contents.length).toBeLessThan(MAX_TOUCHED_FILE_BYTES + 200);
		expect(big?.contents).toContain(`truncated: first ${MAX_TOUCHED_FILE_BYTES} of ${MAX_TOUCHED_FILE_BYTES + 500} bytes`);
	});
});
