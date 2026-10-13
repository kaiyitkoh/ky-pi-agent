/**
 * Credential and runtime-state paths are ignored, and harness paths stay committable; both directions, since a
 * .gitignore swallowing .pi/extensions/ would silently break `pi install`. The oracle is `git check-ignore -q
 * --no-index`, which evaluates the policy against strings (paths need not exist); `git add -f` is out of scope.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isIgnored, repoRoot, trackedFiles } from "../helpers/git.ts";

/** Must never reach a public remote: credentials, transcripts, runtime state and stray infrastructure secrets. */
const MUST_BE_IGNORED = [
	// --- Pi project-scope runtime state -----------------------------------
	".pi/sessions/s.jsonl",
	".pi/sessions/nested/deep.jsonl",
	".pi/logs/wire.jsonl",
	".pi/audit.jsonl",
	".pi/state/mode.json",
	".pi/auth.json",
	".pi/cache/x",
	".pi/settings.local.json",
	// --- Pi project-scope package installs ---------------------------------
	".pi/npm/package.json",
	".pi/npm/node_modules/x",
	".pi/git/github.com/o/r/package.json",
	// --- Ceremonial-workflow scratch artifacts ------------------------------
	".pi/work/demo-slug/SPEC.md",
	".pi/work/demo-slug/PROGRESS.md",
	// --- Generic credential shapes ------------------------------------------
	".env",
	".env.local",
	"auth.json",
	"models.local.json",
	".netrc",
	"secrets/token.txt",
	// --- Infrastructure credential artifacts --------------------------------
	".aws/credentials",
	"kubeconfig",
	"terraform.tfstate",
	"prod.tfvars",
	"x.pem",
	"x.key",
	"id_rsa",
	"id_ed25519",
	// --- Registry auth: every npmrc EXCEPT the two rooted controls ----------
	"sub/.npmrc",
	"packages/a/.npmrc",
	// --- OpenSpec scaffold from an accidental init ---
	"openspec/config.yaml",
	"openspec/changes/x/proposal.md",
	"openspec/specs/y/spec.md",
	"openspec/changes/archive/z/tasks.md",
	// --- Dependencies --------------------------------------------------------
	"node_modules/x",
] as const;

/** Must stay committable: these are the harness, and a clone missing one fails with no error. */
const MUST_BE_COMMITTABLE = [
	// --- The two supply-chain controls -------------------------------------
	".npmrc",
	".pi/npm/.npmrc",
	// --- Pi project resources, all five discovery directories ----------------
	".pi/settings.json",
	".pi/extensions/harness/index.ts",
	".pi/skills/x/SKILL.md",
	".pi/prompts/quick.md",
	".pi/themes/ky.json",
	".pi/agents/planner.md",
	".pi/templates/env.example",
	".pi/APPEND_SYSTEM.md",
	// --- Packaging and toolchain ---------------------------------------------
	"package.json",
	"package-lock.json",
	"tsconfig.json",
	"vitest.config.ts",
	".gitattributes",
	// --- Bootstrap, CI, docs --------------------------------------------------
	"bin/bootstrap.sh",
	"scripts/check-gh-unauthenticated.sh",
	".github/workflows/ci.yml",
	"docs/RUNBOOK.md",
	"CONTRIBUTING.md",
	"README.md",
	".env.example",
	// --- Tests ------------------------------------------------------------------
	"tests/unit/gitignore-policy.test.ts",
	"tests/fixtures/evil-postinstall/package.json",
	// --- Rooted openspec rule must not swallow same-named siblings elsewhere ---
	"docs/openspec-notes.md",
	"scripts/openspec-setup.sh",
] as const;

/** Registry auth patterns; `_auth\b` excludes `_authToken` so a failure names which shape leaked. */
const REGISTRY_AUTH = /_authToken|_auth\b|_password/i;

const COMMITTED_NPMRC = [".npmrc", ".pi/npm/.npmrc"] as const;

function walkFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walkFiles(full));
		} else {
			out.push(full);
		}
	}
	return out;
}

describe("BOOT-09: credential and runtime-state paths are not committable", () => {
	it("asserts a meaningful number of paths in both directions", () => {
		expect(MUST_BE_IGNORED.length).toBeGreaterThanOrEqual(24);
		expect(MUST_BE_COMMITTABLE.length).toBeGreaterThanOrEqual(19);
	});

	it.each(MUST_BE_IGNORED)("ignores %s", (path) => {
		expect(isIgnored(path), `${path} MUST be ignored but git says it is committable`).toBe(true);
	});
});

describe("BOOT-09 (reverse): the harness itself stays committable", () => {
	it.each(MUST_BE_COMMITTABLE)("does not ignore %s", (path) => {
		expect(
			isIgnored(path),
			`${path} MUST be committable but git says it is ignored -- ` +
				"a clone would be missing it and the harness would silently not load",
		).toBe(false);
	});
});

describe("committed npmrc files carry no registry credential", () => {
	it.each(COMMITTED_NPMRC)("%s contains no registry auth directive", (relative) => {
		const full = join(repoRoot(), relative);
		expect(existsSync(full), `${relative} is a BOOT-01 control and must exist`).toBe(true);

		const contents = readFileSync(full, "utf-8");
		const match = REGISTRY_AUTH.exec(contents);
		expect(
			match,
			`${relative} matched ${String(match?.[0])} -- a committed npmrc must hold ` +
				"only supply-chain settings and comments, never registry credentials",
		).toBeNull();
	});

	it("keeps every other npmrc ignored", () => {
		// The negations are rooted (`!/.npmrc`) precisely so this stays true:
		// a nested or vendored npmrc is the likely carrier of a leaked token.
		const committedNpmrc = trackedFiles(".").filter((p) => p.endsWith(".npmrc"));
		expect(committedNpmrc.sort()).toEqual([".npmrc", ".pi/npm/.npmrc"]);
	});
});

describe("openspec/ is never tracked", () => {
	it("tracks nothing under openspec/", () => {
		// `git add -f` bypasses ignore rules, so the ignore oracle alone cannot prove this.
		expect(trackedFiles("openspec")).toEqual([]);
	});
});

describe("no .gitignore may exist under .pi/extensions/", () => {
	// The package path honours .gitignore (package-manager.ts:571) but project-local discovery does not
	// (loader.ts:652-684), so an ignored file breaks one path silently.
	it("has none on disk", () => {
		const dir = join(repoRoot(), ".pi", "extensions");
		if (!existsSync(dir)) {
			return;
		}
		const offenders = walkFiles(dir).filter((p) => p.endsWith(".gitignore"));
		expect(offenders, "a .gitignore under .pi/extensions/ silently breaks `pi install`").toEqual(
			[],
		);
	});

	it("has none tracked", () => {
		const offenders = trackedFiles(".pi/extensions").filter((p) => p.endsWith(".gitignore"));
		expect(offenders).toEqual([]);
	});
});

/**
 * `.env.example` is tracked and regenerated by every full bootstrap run, which writes nothing when the output is
 * byte-identical. So the template's managed region must agree with the tracked file, or bootstrap dirties a checkout.
 */
describe("WR-10 -- the tracked .env.example cannot drift from its template", () => {
	const START = "# ky-pi-agent managed:start";
	const END = "# ky-pi-agent managed:end";

	/** The managed block, inclusive of both markers. */
	function managedRegion(text: string, label: string): string {
		const s = text.indexOf(START);
		const e = text.indexOf(END);
		expect(s, `${label} is missing ${START}`).toBeGreaterThanOrEqual(0);
		expect(e, `${label} is missing ${END}`).toBeGreaterThanOrEqual(0);
		return text.slice(s, e + END.length);
	}

	const templateRel = ".pi/templates/env.example";
	const trackedRel = ".env.example";

	it("tracks both files -- neither may quietly disappear", () => {
		expect(trackedFiles(templateRel)).toEqual([templateRel]);
		expect(trackedFiles(trackedRel)).toEqual([trackedRel]);
	});

	it("has identical managed regions, so a full bootstrap writes nothing", () => {
		const template = readFileSync(join(repoRoot(), templateRel), "utf-8");
		const tracked = readFileSync(join(repoRoot(), trackedRel), "utf-8");
		expect(
			managedRegion(tracked, trackedRel),
			`${trackedRel} has drifted from ${templateRel}. Both are tracked and ` +
				"bin/bootstrap.sh regenerates the second from the first, so a consumer " +
				"running the bootstrap would find a file they never edited modified in " +
				"their checkout. Re-run `sh bin/bootstrap.sh` and commit the result.",
		).toBe(managedRegion(template, templateRel));
	});

	it("detects a divergence when there is one (the assertion is live)", () => {
		// Against synthetic text, not by mutating a tracked file: an assertion
		// that has only ever seen matching input has not shown it can fail.
		const a = `x\n${START}\nFOO=1\n${END}\ny\n`;
		const b = `z\n${START}\nFOO=2\n${END}\n`;
		expect(managedRegion(a, "a")).not.toBe(managedRegion(b, "b"));
		expect(managedRegion(a, "a")).toBe(`${START}\nFOO=1\n${END}`);
	});
});
