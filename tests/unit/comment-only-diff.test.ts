import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { authoredFiles, emitWithoutComments } from "../helpers/comment-scan.ts";
import { repoRoot } from "../helpers/git.ts";

const REF = process.env.COMMENT_BASE_REF ?? "";

const NEVER_THROWS = /NEVER THROWS|never throws/g;
const QUALITY_ALLOW = /quality-allow:/g;
const VENDOR_MARKER = /VENDORED\b|vendored from|Re-authored from Pi's own bundled example/;
const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;

function gitShow(ref: string, path: string): string | undefined {
	const r = spawnSync("git", ["show", `${ref}:${path}`], {
		cwd: repoRoot(),
		encoding: "utf-8",
		maxBuffer: 64 * 1024 * 1024,
	});
	return r.status === 0 ? r.stdout : undefined;
}

describe.skipIf(REF === "")("comment-only diff vs COMMENT_BASE_REF", () => {
	const verify = spawnSync("git", ["rev-parse", "--verify", `${REF}^{commit}`], { cwd: repoRoot(), encoding: "utf-8" });
	const pairs: { path: string; before: string; after: string }[] = [];
	const deleted: string[] = [];
	const added: string[] = [];
	if (verify.status === 0) {
		for (const path of authoredFiles()) {
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
		if (added.length > 0) console.info(`comment-only-diff: new since ref, skipped: ${added.join(", ")}`);
		console.info(`comment-only-diff: compared ${pairs.length} files against ${REF}`);
	});

	it("keeps every file present at the ref", () => {
		expect(deleted, "deleted since the ref").toEqual([]);
	});

	it("emits identical code once comments are removed", () => {
		const changed = pairs.filter((p) => emitWithoutComments(p.before) !== emitWithoutComments(p.after)).map((p) => p.path);
		expect(changed, `behaviour changed in:\n${changed.join("\n")}`).toEqual([]);
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
