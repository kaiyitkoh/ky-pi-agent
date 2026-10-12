import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { changedFilesSince, compareScope } from "../../.pi/extensions/review/scope-drift.ts";
import { commitFile, headSha, makeTempRepo } from "../helpers/git.ts";

const repos: string[] = [];
function repo(): string {
	const r = makeTempRepo("scope-drift-");
	repos.push(r);
	return r;
}
afterEach(() => {
	for (const r of repos.splice(0)) {
		rmSync(r, { recursive: true, force: true });
	}
});

describe("scope drift against a real git diff", () => {
	it("an in-scope commit is not drift", () => {
		const r = repo();
		commitFile(r, "base.txt", "base\n", "baseline");
		const base = headSha(r);
		commitFile(r, "a.ts", "a\n", "declared change");
		const changed = changedFilesSince(r, base);
		expect(changed).toEqual(["a.ts"]);
		const report = compareScope({ changed, specExpectedFiles: ["a.ts"], planFilesTouched: [] });
		expect(report.drifted).toEqual([]);
		expect(report.undelivered).toEqual([]);
	});

	it("a commit touching an undeclared path is flagged", () => {
		const r = repo();
		commitFile(r, "base.txt", "base\n", "baseline");
		const base = headSha(r);
		commitFile(r, "a.ts", "a\n", "declared change");
		commitFile(r, "rogue.ts", "x\n", "undeclared change");
		const changed = changedFilesSince(r, base);
		expect(changed).toContain("rogue.ts");
		expect(compareScope({ changed, specExpectedFiles: ["a.ts"], planFilesTouched: [] }).drifted).toEqual(["rogue.ts"]);
	});

	it("a rename reports both the source and the destination path", () => {
		const r = repo();
		commitFile(r, "old.ts", "line one\nline two\nline three\nline four\n", "baseline");
		const base = headSha(r);
		execFileSync("git", ["mv", "old.ts", "new.ts"], { cwd: r });
		execFileSync("git", ["commit", "-m", "rename"], { cwd: r, stdio: "ignore" });
		expect([...changedFilesSince(r, base)].sort()).toEqual(["new.ts", "old.ts"]);
		expect(compareScope({ changed: changedFilesSince(r, base), specExpectedFiles: ["new.ts"], planFilesTouched: [] }).drifted).toEqual(["old.ts"]);
	});

	it("a rename is reported in full even when diff.renames is configured on", () => {
		const r = repo();
		commitFile(r, "infra.tf", "line one\nline two\nline three\nline four\n", "baseline");
		const base = headSha(r);
		execFileSync("git", ["config", "diff.renames", "copies"], { cwd: r });
		execFileSync("git", ["mv", "infra.tf", "allowed.ts"], { cwd: r });
		execFileSync("git", ["commit", "-m", "move"], { cwd: r, stdio: "ignore" });
		expect([...changedFilesSince(r, base)].sort()).toEqual(["allowed.ts", "infra.tf"]);
	});

	it("reports a non-ASCII path verbatim rather than git's quoted octal form", () => {
		const r = repo();
		commitFile(r, "base.txt", "base\n", "baseline");
		const base = headSha(r);
		commitFile(r, "é.ts", "x\n", "non-ascii");
		expect(changedFilesSince(r, base)).toEqual(["é.ts"]);
	});

	it("throws, and never returns an empty list, when git fails", () => {
		const r = repo();
		commitFile(r, "base.txt", "base\n", "baseline");
		expect(() => changedFilesSince(r, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef")).toThrow(/git diff --name-only/);
	});

	it("rejects a base that is not a SHA", () => {
		const r = repo();
		commitFile(r, "base.txt", "base\n", "baseline");
		expect(() => changedFilesSince(r, "--output=x")).toThrow(/commit SHA/);
	});
});
