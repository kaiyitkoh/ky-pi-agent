/**
 * FLOW-10 -- `.pi/lib/work-artifacts.ts`'s two exports: `ARTIFACT_FILES` (the
 * fixed four-file set, each with a named consumer) and `workDir` (the
 * two-layer confined path builder for `.pi/work/<slug>/`).
 *
 * This module is pure (no I/O, registers nothing, never reaches a model) --
 * see its own docstring for the BOUNDARY RULE / CHOKEPOINT HYGIENE
 * disclosures this file does not need to re-assert; `contributing-boundary
 * .test.ts` and `chokepoint-lint.test.ts` already cover every tracked source
 * under `.pi/extensions/`, and `.pi/lib/` besides, with no exemption
 * required here.
 */
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { ARTIFACT_FILES, SLUG_PATTERN, workDir } from "../../.pi/lib/work-artifacts.ts";

describe("ARTIFACT_FILES -- the fixed four-file ceremonial-workflow artifact set", () => {
	it("has exactly four entries, no fifth", () => {
		expect(ARTIFACT_FILES.length).toBe(4);
	});

	it("names SPEC.md, PLAN.md, REVIEW.md and PROGRESS.md, and no other file", () => {
		const names = ARTIFACT_FILES.map((a) => a.name).sort();
		expect(names).toEqual(["PLAN.md", "PROGRESS.md", "REVIEW.md", "SPEC.md"]);
	});

	it.each(ARTIFACT_FILES.map((a) => a.name))("%s carries a non-empty consumer", (name) => {
		const entry = ARTIFACT_FILES.find((a) => a.name === name);
		expect(entry).toBeDefined();
		expect(entry?.consumer.length, `${name}'s consumer string must be non-empty -- FEATURES.md Part 2's own rule`).toBeGreaterThan(0);
	});

	it("is frozen -- a caller cannot mutate the registry at runtime", () => {
		expect(Object.isFrozen(ARTIFACT_FILES)).toBe(true);
		for (const entry of ARTIFACT_FILES) {
			expect(Object.isFrozen(entry)).toBe(true);
		}
	});
});

describe("SLUG_PATTERN -- the legal .pi/work/<slug>/ shape", () => {
	const LEGAL = ["demo-slug", "a", "feature-123", "x".repeat(64)] as const;
	it.each(LEGAL)("accepts %j", (slug) => {
		expect(SLUG_PATTERN.test(slug)).toBe(true);
	});

	const ILLEGAL = [
		["..", "a bare traversal token"],
		["a/b", "a path separator"],
		["", "the empty string"],
		["x".repeat(65), "over the 64-character bound"],
		["../evil", "a leading traversal segment"],
		["a\\b", "a backslash path separator"],
		["-leading-hyphen", "a leading hyphen, not alphanumeric"],
		["Demo-Slug", "uppercase, not lowercase-only"],
		["demo.slug", "a dot"],
	] as const;
	it.each(ILLEGAL)("rejects %j (%s)", (slug) => {
		expect(SLUG_PATTERN.test(slug)).toBe(false);
	});
});

describe("workDir -- fail-closed confinement over a model-supplied slug [threat T-09-03-02]", () => {
	const CWD = resolve("C:/fake-repo-root");

	it("returns a path contained under <cwd>/.pi/work/ for a legal slug", () => {
		const result = workDir(CWD, "demo-slug");
		const root = resolve(join(CWD, ".pi", "work"));
		expect(result).toBe(join(root, "demo-slug"));
		expect(result.startsWith(root + sep), "the returned path must sit inside the work root").toBe(true);
	});

	it("returns a DIFFERENT path for a different legal slug -- not a constant", () => {
		expect(workDir(CWD, "alpha")).not.toBe(workDir(CWD, "beta"));
	});

	const ILLEGAL_SLUGS = ["..", "a/b", "", "x".repeat(65), "../evil", "a\\b"] as const;
	it.each(ILLEGAL_SLUGS)("throws on the illegal slug %j -- fail closed, not defaulted through", (slug) => {
		expect(() => workDir(CWD, slug)).toThrow();
	});

	it("the thrown message names SLUG_PATTERN, so a caller can tell why it was refused", () => {
		expect(() => workDir(CWD, "..")).toThrow(/SLUG_PATTERN/);
	});
});

describe("workDir is a pure path computation -- no I/O", () => {
	it("never creates the directory it names", async () => {
		const { existsSync } = await import("node:fs");
		const cwd = resolve("C:/another-fake-root-workdir-purity-check");
		const dir = workDir(cwd, "never-created");
		expect(existsSync(dir), "workDir must not create the directory as a side effect").toBe(false);
	});
});
