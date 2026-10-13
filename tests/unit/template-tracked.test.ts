/**
 * The shipped config templates survive a fresh clone: .gitignore swallows `auth.json` and `auth.*.json` anywhere
 * (.gitignore:46-47), so a rename to either would ship a clone with no credential template and no error. Both
 * directions: the shipped names are committable and tracked, and the two trap names stay ignored. Git is the oracle.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isIgnored, repoRoot, trackedFiles } from "../helpers/git.ts";

/** The directory whose tracked contents the positive half is drawn from. */
const TEMPLATE_DIR = ".pi/templates";

/** The shipped names; bootstrap reads them from the clone, so both must be committable and tracked. */
const MUST_BE_SHIPPED = [
	".pi/templates/models-template.json",
	".pi/templates/auth-template.json",
] as const;

/** The two trap names, each with the rule that eats it: a one-word rename no other test would notice. */
const MUST_BE_SWALLOWED = [
	{ path: ".pi/templates/auth.json", rule: ".gitignore:46 (`auth.json`)" },
	{ path: ".pi/templates/auth.example.json", rule: ".gitignore:47 (`auth.*.json`)" },
] as const;

describe("PROV-01 / Trap T1 — the shipped templates reach a clone", () => {
	it("asserts a meaningful number of paths in both directions", () => {
		expect(
			MUST_BE_SHIPPED.length,
			"both shipped templates must be listed; a table of one leaves the other free to be " +
				"renamed into a swallowed name with nothing to notice",
		).toBe(2);
		expect(
			MUST_BE_SWALLOWED.length,
			"both rejected names must be listed — they are eaten by two DIFFERENT rules " +
				"(`auth.json` and `auth.*.json`), and asserting one would let a tidy-up delete " +
				"the other while this file stayed green",
		).toBe(2);
	});

	it.each(MUST_BE_SHIPPED)("does not ignore %s", (path) => {
		expect(
			isIgnored(path),
			`${path} MUST be committable but git says it is ignored. A fresh clone would be missing ` +
				"the file bin/bootstrap.sh installs into ~/.pi/agent/, so the provider it defines would " +
				"simply not exist — with no error from git, from bootstrap or from Pi",
		).toBe(false);
	});

	it("finds a non-empty tracked file list for the template directory", () => {
		// Non-empty first, so a mis-scoped pathspec cannot make the membership loop vacuous.
		const tracked = trackedFiles(TEMPLATE_DIR);
		expect(
			tracked.length,
			`git ls-files reported nothing under ${TEMPLATE_DIR}. Every assertion about tracked-ness ` +
				"reads this list, so an empty or mis-scoped one makes them meaningless",
		).toBeGreaterThan(0);
		expect(
			tracked.every((p) => p.startsWith(`${TEMPLATE_DIR}/`)),
			`git ls-files -- ${TEMPLATE_DIR} returned paths outside it (${tracked.join(", ")}), so the ` +
				"pathspec is not scoping anything and membership below proves less than it appears to",
		).toBe(true);
	});

	it.each(MUST_BE_SHIPPED)("tracks %s in the index, not merely on disk", (path) => {
		expect(
			trackedFiles(TEMPLATE_DIR),
			`${path} is not in git's index. This is the failure the "is it ignored?" question cannot ` +
				"see: the file exists on this machine, every test that reads it passes, and it is absent " +
				"from every clone anyone else makes. Run `git add " +
				path +
				"` and commit it",
		).toContain(path);
	});
});

describe("PROV-01 / Trap T1 — the rejected filenames really are swallowed", () => {
	it.each(MUST_BE_SWALLOWED)("ignores $path", ({ path, rule }) => {
		expect(
			isIgnored(path),
			`${path} is NOT ignored, so ${rule} no longer matches it. That rule is what makes the ` +
				"`-template.json` naming a requirement rather than a style choice; with it loosened, a " +
				"future rename to this name would ship a clone with no credential template while the " +
				"whole suite stayed green. If the loosening was deliberate, this test must be the same " +
				"commit that argues for it",
		).toBe(true);
	});

	it("says a normal source file is NOT ignored (the oracle is live)", () => {
		// Asserts the false direction: the negative half above is the one an always-true isIgnored would pass.
		expect(
			isIgnored("README.md"),
			"git reported README.md as ignored. That cannot be right, so the oracle itself is broken " +
				"-- a wrong cwd, a misread exit code, a failed spawn -- and every `toBe(true)` above is " +
				"meaningless rather than reassuring",
		).toBe(false);
	});
});

describe("the env templates list what the code reads", () => {
	const templates = [".pi/templates/env.example", ".env.example"] as const;
	const variableNames = (text: string): string[] =>
		[...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1] ?? "");
	const read = (path: string): string => readFileSync(join(repoRoot(), path), "utf-8");

	const qoderNamesRead = (): string[] => {
		const found = new Set<string>();
		for (const path of trackedFiles(".pi")) {
			if (!path.endsWith(".ts")) continue;
			for (const match of read(path).matchAll(/"(QODER_[A-Z0-9_]+)"/g)) found.add(match[1] ?? "");
		}
		return [...found].sort();
	};

	it("finds the Qoder variables the code reads", () => {
		expect(qoderNamesRead().length).toBeGreaterThanOrEqual(4);
	});

	it.each(templates)("%s lists every Qoder variable read under .pi", (path) => {
		const declared = variableNames(read(path));
		expect(qoderNamesRead().filter((name) => !declared.includes(name))).toEqual([]);
	});

	it.each(templates)("%s does not call Qoder ruled out", (path) => {
		expect(read(path)).not.toMatch(/ruled out/i);
	});

	it("both files declare the same variable names", () => {
		const [a, b] = templates.map((path) => variableNames(read(path)).sort());
		expect(a).toEqual(b);
	});
});
