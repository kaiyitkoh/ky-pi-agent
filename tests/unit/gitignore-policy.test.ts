/**
 * BOOT-09 -- credential and runtime-state paths are not committable, and
 * harness paths still are.
 *
 * The oracle is `git check-ignore -q --no-index` (see ../helpers/git.ts for why
 * both flags are load-bearing). Two properties of that command shape this file:
 *
 *   - it evaluates rules against a STRING, so none of the paths below need to
 *     exist on disk. This table is deliberately full of files that do not and
 *     should never exist -- `.pi/auth.json`, `id_rsa`, `terraform.tfstate`.
 *   - it reports the ignore POLICY. `git add -f` bypasses ignore rules
 *     entirely, so a green run here means "the declared rules classify every
 *     path correctly", not "nothing can ever be committed". Forcing a
 *     credential into the index is a different control's problem.
 *
 * Both directions are asserted with equal weight, and that is the point.
 * A one-directional test would go green on a `.gitignore` that swallowed
 * `.pi/extensions/` -- which would silently break the `pi install` path
 * (BOOT-02) while leaving the dogfood path (BOOT-05) working, the worst
 * possible failure shape. [threats T-01-05, T-01-06]
 *
 * Path inventory read at source: pi 0.84.1 src/config.ts:516-566 (agent dir,
 * auth.json, sessions, debug log), src/core/package-manager.ts:2004,2084
 * (project-scope npm/ and git/ install roots), docs/settings.md:216
 * (`sessionDir: ".pi/sessions"` is the documented example value).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isIgnored, repoRoot, trackedFiles } from "../helpers/git.ts";

/**
 * Must never reach a public remote. Credentials, transcripts, runtime state,
 * and infrastructure secrets the developer's other tooling leaves lying around.
 */
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
	// --- Ceremonial-workflow scratch artifacts (plan 09-03, FLOW-10) --------
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
	// --- Dependencies --------------------------------------------------------
	"node_modules/x",
] as const;

/**
 * Must stay committable. These ARE the harness: if `.gitignore` swallows one,
 * `pi install https://github.com/kaiyitkoh/ky-pi-agent` gets a clone that is
 * missing the thing it was installing, with no error message anywhere.
 */
const MUST_BE_COMMITTABLE = [
	// --- The two supply-chain controls (BOOT-01) ----------------------------
	".npmrc",
	".pi/npm/.npmrc",
	// --- Pi project resources, all five discovery directories ----------------
	".pi/settings.json",
	".pi/extensions/harness/index.ts",
	".pi/skills/x/SKILL.md",
	".pi/prompts/quick.md",
	".pi/themes/ky.json",
	".pi/agents/reviewer.md",
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
] as const;

/** Registry auth patterns. `_auth\b` deliberately excludes `_authToken`, which
 * its own alternative covers -- keeping them separate makes a failure message
 * say which shape leaked. */
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
		expect(MUST_BE_IGNORED.length).toBeGreaterThanOrEqual(20);
		expect(MUST_BE_COMMITTABLE.length).toBeGreaterThanOrEqual(17);
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

describe("no .gitignore may exist under .pi/extensions/", () => {
	// Pi's two discovery paths DISAGREE about ignore files, silently:
	// the package path honours .gitignore (package-manager.ts:571) while
	// project-local discovery is a plain readdirSync that does not
	// (loader.ts:652-684, 710-712). One file here makes BOOT-05 pass and
	// BOOT-02 fail with no error emitted by either.
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
 * WR-10. `.env.example` is TRACKED and also GENERATED by every full
 * `bin/bootstrap.sh` run, which is why two integration tests have to snapshot
 * its bytes and restore them in a `finally` for the suite to be worktree-safe.
 * That restore dance is a tell.
 *
 * Keeping it tracked is deliberate -- it is the file a reader of the repo looks
 * for, `.gitignore` has an explicit `!.env.example` negation for it, and
 * untracking it would mean a fresh clone has no env template until bootstrap
 * runs. The hazard is not the tracking; it is DIVERGENCE. `write_env_template`
 * is already a no-op when the output would be byte-identical
 * (`bin/bootstrap.sh`, the `fs.readFileSync(dst) === out` guard), so while the
 * managed region of the template and the tracked file agree, a consumer's
 * `sh bin/bootstrap.sh` writes nothing and leaves their checkout clean. The
 * moment they diverge, it dirties a file the user never edited.
 *
 * So assert agreement here, cheaply and offline, rather than discovering it
 * from a dirty worktree.
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
