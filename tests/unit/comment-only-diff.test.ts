import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AUTHORED_ROOTS, authoredFiles, codeTokens, isExempt } from "../helpers/comment-scan.ts";
import { repoRoot } from "../helpers/git.ts";

// Opt-in on purpose: it proves a claimed comment-only range, and ordinary code work would fail it.
// Run: COMMENT_BASE_REF=<ref> npx vitest run tests/unit/comment-only-diff.test.ts --maxWorkers=2
const REF = process.env.COMMENT_BASE_REF ?? "";
// Comma-separated paths whose code changed or that were added on purpose; changed ones still get the marker checks.
const EXEMPT = (process.env.COMMENT_DIFF_EXEMPT ?? "")
	.split(",")
	.map((p) => p.trim())
	.filter((p) => p !== "");

const NEVER_THROWS = /NEVER THROWS|never throws/g;
const QUALITY_ALLOW = /quality-allow:/g;
const VENDOR_MARKER = /VENDORED\b|vendored from|Re-authored from Pi's own bundled example/;
const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;

function git(args: string[]): { status: number | null; stdout: string } {
	const r = spawnSync("git", args, { cwd: repoRoot(), encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
	return { status: r.status, stdout: r.stdout };
}

function gitShow(ref: string, path: string): string | undefined {
	const r = git(["show", `${ref}:${path}`]);
	return r.status === 0 ? r.stdout : undefined;
}

/** First index where two token streams diverge, for a readable failure. */
function firstDiff(a: string[], b: string[]): string {
	const n = Math.max(a.length, b.length);
	for (let i = 0; i < n; i++) if (a[i] !== b[i]) return `token ${i}: ${JSON.stringify(a[i])} -> ${JSON.stringify(b[i])}`;
	return "identical";
}

describe("comment-only diff self-tests", () => {
	it("ignores comment edits but sees type, modifier and literal edits", () => {
		const base = 'const s: string = "a//b"; // one\nconst r = /\\/\\//;\n';
		expect(codeTokens(base)).toEqual(codeTokens('/** doc */\nconst s: string = "a//b"; // two, longer\nconst r = /\\/\\//;\n'));
		expect(codeTokens(base)).not.toEqual(codeTokens('const s: number = "a//b"; // one\nconst r = /\\/\\//;\n'));
		expect(codeTokens(base)).not.toEqual(codeTokens('const s: string = "a//c"; // one\nconst r = /\\/\\//;\n'));
		expect(codeTokens(base)).not.toEqual(codeTokens('const s: string = "a//b"; // one\nconst r = /\\/x\\//;\n'));
		expect(codeTokens("const a = [1] as const;")).not.toEqual(codeTokens("const a = [1];"));
		expect(codeTokens("interface I { readonly a: 1 }")).not.toEqual(codeTokens("interface I { a: 1 }"));
	});
});

describe.skipIf(REF === "")("comment-only diff vs COMMENT_BASE_REF", () => {
	const verify = git(["rev-parse", "--verify", `${REF}^{commit}`]);
	const pairs: { path: string; before: string; after: string }[] = [];
	const deleted: string[] = [];
	const added: string[] = [];
	if (verify.status === 0) {
		const atRef = git(["ls-tree", "-r", "--name-only", REF, "--", ...AUTHORED_ROOTS])
			.stdout.split("\n")
			.map((l) => l.trim())
			.filter((p) => p.endsWith(".ts") && !isExempt(p));
		for (const path of [...new Set([...atRef, ...authoredFiles()])].sort()) {
			const before = gitShow(REF, path);
			if (before === undefined) {
				added.push(path);
				continue;
			}
			if (!existsSync(join(repoRoot(), path))) {
				deleted.push(path);
				continue;
			}
			pairs.push({ path, before, after: readFileSync(join(repoRoot(), path), "utf-8") });
		}
	}

	it("resolves the base ref and compares enough files", () => {
		expect(verify.status, `COMMENT_BASE_REF=${REF} is not a valid commit`).toBe(0);
		expect(pairs.length).toBeGreaterThanOrEqual(40);
		console.info(`comment-only-diff: compared ${pairs.length} files against ${REF}`);
	});

	it("keeps every file present at the ref", () => {
		expect(deleted, "deleted since the ref").toEqual([]);
	});

	// A new extension file changes runtime behaviour without touching any compared file.
	it("adds no authored file unless COMMENT_DIFF_EXEMPT declares it", () => {
		const undeclared = added.filter((p) => !EXEMPT.includes(p));
		expect(undeclared, "new authored files since the ref; list them in COMMENT_DIFF_EXEMPT").toEqual([]);
	});

	it("names only compared or added files in COMMENT_DIFF_EXEMPT", () => {
		const unknown = EXEMPT.filter((p) => !added.includes(p) && !pairs.some((pair) => pair.path === p));
		expect(unknown, "COMMENT_DIFF_EXEMPT entries that match no compared or added file").toEqual([]);
	});

	it("keeps every code token identical once comments are removed", () => {
		const changed: string[] = [];
		for (const { path, before, after } of pairs) {
			if (EXEMPT.includes(path)) continue;
			const a = codeTokens(before);
			const b = codeTokens(after);
			if (a.length !== b.length || a.some((t, i) => t !== b[i])) changed.push(`${path} (${firstDiff(a, b)})`);
		}
		if (EXEMPT.length > 0) console.info(`comment-only-diff: exempt from the token check: ${EXEMPT.join(", ")}`);
		expect(changed, `code changed in:\n${changed.join("\n")}`).toEqual([]);
	});

	it("preserves the NEVER THROWS, quality-allow and vendoring markers", () => {
		const broken: string[] = [];
		for (const { path, before, after } of pairs) {
			if (count(after, NEVER_THROWS) < count(before, NEVER_THROWS)) broken.push(`${path}: NEVER THROWS dropped`);
			if (count(after, QUALITY_ALLOW) !== count(before, QUALITY_ALLOW)) broken.push(`${path}: quality-allow changed`);
			if (VENDOR_MARKER.test(after) !== VENDOR_MARKER.test(before)) broken.push(`${path}: vendoring marker changed`);
		}
		expect(broken, broken.join("\n")).toEqual([]);
	});
});
