/**
 * BOOT-08: nothing in this repo's dependency surface may drift.
 *
 * Four independent claims, each asserted so that breaking it goes red:
 *
 *   1. No range operator anywhere in the dependency maps.
 *   2. `package-lock.json` is tracked (and `npm-shrinkwrap.json` is not used).
 *   3. The six toolchain pins match Pi core 0.84.1's own devDependencies.
 *   4. Every third-party package source recorded for Pi carries a ref.
 *
 * Scope boundary: CI action SHA pinning is a real BOOT-08 obligation and it is
 * NOT asserted here -- it belongs to Plan 08's `tests/unit/ci-pinning.test.ts`.
 * Keeping it out means this file never has to tolerate a missing workflow file,
 * and "tolerating absence" is how a pinning test becomes a vacuous pass.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";

const ROOT = repoRoot();

function readJson(relPath: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(ROOT, relPath), "utf-8")) as Record<string, unknown>;
}

const manifest = readJson("package.json");

function depMap(field: string): Record<string, string> {
	const value = manifest[field];
	if (value === undefined) {
		return {};
	}
	return value as Record<string, string>;
}

/**
 * The five host-provided peers.
 *
 * These are the ONLY keys in the whole manifest allowed to carry `"*"`, and only
 * inside `peerDependencies`. This is not a pin regression and a future reader
 * must not "fix" it:
 *
 *   - `docs/packages.md:171` mandates the `"*"` range for peers.
 *   - At RUNTIME none of them is ours: jiti aliases every one to Pi's own
 *     bundled copy at load time (`loader.ts:118-140`), so the version that
 *     actually executes is the host's, whatever we wrote here.
 *   - Bundling or pinning them creates a SECOND module instance and breaks
 *     `instanceof` across the extension boundary.
 *
 * What this comment USED to say, and what is false: "Peers are never installed
 * by us." npm 7+ installs the root project's own `peerDependencies`, and
 * `npm install --omit=dev` -- the exact command Pi runs inside a clone of this
 * repo (`package-manager.ts:1829`) -- adds 101 packages to a fresh clone,
 * including four of the five peers (`pi-coding-agent` alone is resolved through
 * the devDependency edge and marked `dev` in the lock), plus the AWS SDK,
 * `openai` and `@anthropic-ai/sdk` [VERIFIED: executed 2026-08-13, fresh clone,
 * npm 11.13.0]. Every consumer of `pi install <this repo url>` downloads them.
 *
 * So the BOOT-08 obligation for these five is discharged by
 * `package-lock.json`, and ONLY by it -- the lock's non-dev entries are the one
 * thing standing between a `"*"` range and "whatever is latest today". That is
 * asserted below rather than assumed. `devDependencies` pins what the
 * development machine builds against, which is a different guarantee.
 * [RESEARCH.md 8.3 tension 1]
 */
const PEER_NAMES = [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"typebox",
] as const;

/**
 * Range operators. `^` and `~` are the drift everyone thinks of; `*`, `>`, `<`,
 * `||` and the ` - ` hyphen range are the ones that get through review.
 */
const RANGE_OPERATOR = /[\^~*><]|\|\||\s-\s/;

/** Maps that must be exact. `peerDependencies` is deliberately excluded. */
const EXACT_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

/**
 * Pi core 0.84.1's own devDependencies, taken deliberately over the registry
 * latest. At research time (2026-08-13) the latest published versions were
 * typescript 7.0.2, vitest 4.1.10, @types/node 26.2.0 and typebox 1.3.13 --
 * all rejected. Type-only compatibility with Pi's shipped `.d.ts` is what
 * matters, so we match Pi rather than npm. Recorded here as literals so that
 * moving off them is a decision someone makes, not an accident someone commits.
 * [RESEARCH.md "Standard Stack"]
 */
const REQUIRED_DEV_PINS: Record<string, string> = {
	"@earendil-works/pi-coding-agent": "0.84.1",
	"@earendil-works/pi-ai": "0.84.1",
	typebox: "1.3.7",
	typescript: "5.9.3",
	vitest: "4.1.9",
	"@types/node": "24.12.4",
};

/**
 * `dependencies` (runtime, installed by `npm install --omit=dev`) mirrors
 * `REQUIRED_DEV_PINS`' shape for exactly one package, `unbash@4.0.10`.
 *
 * Why this cannot live in `devDependencies`: Pi installs a consumer's clone
 * with `npm install --omit=dev` (CLAUDE.md, "Runtime deps must be in
 * `dependencies`"; `docs/packages.md`), so anything in `devDependencies`
 * simply never reaches a machine that installs this repo as a Pi package.
 * `unbash` is the AST parser Phase 4's safety guard runs on every `bash`
 * tool call -- it sits in the tool-execution path, not the dev toolchain.
 *
 * Why this is governed at all: `unbash` is the one package audited in
 * `.planning/phases/04-safety-deployment-guardrails/04-RESEARCH.md`
 * ("Package Legitimacy Audit" -- Approved, slopcheck `[OK]`). An ungoverned
 * `dependencies` block is exactly where the next, unaudited package would
 * land silently -- the same reasoning `REQUIRED_DEV_PINS` above already
 * states for the six toolchain pins. `EXACT_FIELDS` (`:84`) already forbids
 * a range operator on `dependencies`; this constant additionally pins WHICH
 * keys are allowed to be there, and at what version.
 */
const REQUIRED_RUNTIME_PINS: Record<string, string> = {
	unbash: "4.0.10",
};

/**
 * True when a Pi package source cannot silently move under you.
 *
 * `pi update --extensions` reconciles an existing install to the configured
 * ref; versioned npm specs are pinned and skipped, and only `…@ref` git forms
 * are pinned at all (`docs/packages.md:90`). Anything else is a moving target
 * that ships new code onto a laptop holding live cloud credentials.
 *
 * Exported because Phase 7 needs exactly this lint when the real extension set
 * is written into `.pi/settings.json`; writing it now costs nothing and means
 * Phase 7 inherits a proven function instead of a fresh regex.
 *
 * Known limitation, stated rather than hidden: the git branch accepts any `@`
 * after the scheme, so a URL carrying userinfo (`https://user@host/o/r`) would
 * be judged pinned. Pi's own accepted forms do not use userinfo, and tightening
 * it risks rejecting legitimate refs; the residual is documented instead.
 */
export function isPinnedPackageSpec(spec: string): boolean {
	return /^npm:.+@[0-9]/.test(spec) || /^(git:|https:\/\/|http:\/\/|ssh:\/\/|git:\/\/).+@.+$/.test(spec);
}

/**
 * The single documented exemption.
 *
 * BOOT-02 mandates the literal command `pi install
 * https://github.com/kaiyitkoh/ky-pi-agent`, and for our OWN repo an unrefed
 * source is the desired behaviour -- we control the default branch and want
 * `pi update` to reconcile to it. Every THIRD-PARTY source must carry a ref.
 * [RESEARCH.md 8.3 tension 2]
 */
const OWN_REPO_URL = "https://github.com/kaiyitkoh/ky-pi-agent";

function isOwnRepo(spec: string): boolean {
	return spec === OWN_REPO_URL || spec === `${OWN_REPO_URL}.git`;
}

describe("BOOT-08.1 -- no range may drift", () => {
	for (const field of EXACT_FIELDS) {
		it(`${field} carries only exact versions`, () => {
			const entries = Object.entries(depMap(field));
			for (const [name, range] of entries) {
				expect(
					RANGE_OPERATOR.test(range),
					`${field}["${name}"] = "${range}" is a RANGE, not a pin -- ` +
						"the installed tree can change without a commit",
				).toBe(false);
			}
		});
	}

	it("permits `*` only for the five host-provided peers, only in peerDependencies", () => {
		const peers = depMap("peerDependencies");
		expect(Object.keys(peers).sort()).toEqual([...PEER_NAMES].sort());
		for (const name of PEER_NAMES) {
			expect(peers[name]).toBe("*");
		}

		// The allow-list is an allow-list: a peer name reappearing with `*` in a
		// map we install from is not covered by it.
		for (const field of EXACT_FIELDS) {
			for (const [name, range] of Object.entries(depMap(field))) {
				expect(
					range,
					`${field}["${name}"] is "*"; the peer allow-list applies to peerDependencies only`,
				).not.toBe("*");
			}
		}
	});
});

describe("BOOT-08.2 -- the resolved tree is under version control", () => {
	it("tracks exactly one package-lock.json", () => {
		expect(trackedFiles("package-lock.json")).toEqual(["package-lock.json"]);
	});

	it("does not use npm-shrinkwrap.json", () => {
		// Shrinkwrap only matters for packages published to npm, which is a
		// Deferred Idea. Pi consumes this repo by `git clone` + `npm install` at
		// the clone root, where the lockfile already applies.
		// [RESEARCH.md "Standard Stack" > Alternatives considered]
		expect(existsSync(join(ROOT, "npm-shrinkwrap.json"))).toBe(false);
		expect(trackedFiles("npm-shrinkwrap.json")).toEqual([]);
	});

	/**
	 * The lock's NON-DEV `@earendil-works/*` entries are the whole pin for the
	 * `"*"` peers.
	 *
	 * `npm install --omit=dev` in a clone installs the root's peerDependencies
	 * -- 101 packages, four of the five peers among them
	 * [VERIFIED: executed 2026-08-13, fresh clone, npm 11.13.0]. `"*"` means
	 * "whatever is latest" the instant the lock stops constraining it, so this
	 * is where the BOOT-08 obligation for those packages actually lives. Only
	 * non-dev entries are checked: a dev-only tree is not what a consumer of
	 * `pi install <url>` receives.
	 */
	const PI_FAMILY_PIN = "0.84.1";

	interface LockEntry {
		readonly version?: string;
		readonly dev?: boolean;
	}

	const lockPackages = (readJson("package-lock.json").packages ?? {}) as Record<string, LockEntry>;

	/** Non-dev `node_modules/@earendil-works/<pkg>` entries, path -> version. */
	const runtimePiEntries = Object.entries(lockPackages).filter(
		([path, entry]) => /^node_modules\/@earendil-works\/[^/]+$/.test(path) && entry.dev !== true,
	);

	it("locks at least one non-dev @earendil-works entry", () => {
		// Without this, the loop below passes over an empty set -- the exact
		// vacuity this file exists to avoid. A lock format change that renames
		// `packages` would otherwise go unnoticed.
		expect(
			runtimePiEntries.length,
			"no non-dev @earendil-works entry in package-lock.json; either the lock " +
				"format changed or `npm install --omit=dev` no longer installs the peers, " +
				"and in both cases the claim in CONTRIBUTING.md needs re-verifying",
		).toBeGreaterThan(0);
	});

	for (const [path, entry] of runtimePiEntries) {
		it(`locks ${path} at ${PI_FAMILY_PIN}`, () => {
			expect(
				entry.version,
				`${path} is what a consumer's \`npm install --omit=dev\` downloads, and the ` +
					`manifest range for it is "*". The lockfile is the only pin it has.`,
			).toBe(PI_FAMILY_PIN);
		});
	}

	it("locks the non-dev typebox at the audited pin", () => {
		const typebox = lockPackages["node_modules/typebox"];
		expect(typebox, "typebox is a `\"*\"` peer and must be present in the lock").toBeDefined();
		expect(typebox?.dev).not.toBe(true);
		expect(typebox?.version).toBe(REQUIRED_DEV_PINS.typebox);
	});
});

describe("BOOT-08.3 -- the toolchain matches Pi core 0.84.1, not the registry", () => {
	const dev = depMap("devDependencies");

	for (const [name, version] of Object.entries(REQUIRED_DEV_PINS)) {
		it(`pins ${name} at ${version}`, () => {
			expect(dev[name]).toBe(version);
		});
	}

	it("declares no dev dependency beyond the six audited pins", () => {
		// Anything extra has not been through the Package Legitimacy Audit.
		expect(Object.keys(dev).sort()).toEqual(Object.keys(REQUIRED_DEV_PINS).sort());
	});
});

describe("BOOT-08.5 -- the runtime dependencies block is governed exactly like devDependencies", () => {
	const runtime = depMap("dependencies");

	for (const [name, version] of Object.entries(REQUIRED_RUNTIME_PINS)) {
		it(`pins ${name} at ${version}`, () => {
			expect(runtime[name]).toBe(version);
		});
	}

	it("declares no runtime dependency beyond the audited pin", () => {
		// Same reasoning as BOOT-08.3's dev-pin equivalent: anything extra has not
		// been through the Package Legitimacy Audit, and `dependencies` is what a
		// consumer's `npm install --omit=dev` actually installs.
		expect(Object.keys(runtime).sort()).toEqual(Object.keys(REQUIRED_RUNTIME_PINS).sort());
	});

	it("carries no range operator on the runtime pin (belt-and-suspenders with BOOT-08.1)", () => {
		for (const [name, version] of Object.entries(runtime)) {
			expect(RANGE_OPERATOR.test(version), `dependencies["${name}"] = "${version}" is a RANGE, not a pin`).toBe(
				false,
			);
		}
	});
});

describe("BOOT-08.4 -- package sources carry a ref", () => {
	// Proven against a table so the lint is live today, while
	// `.pi/settings.json` still has no `packages` array. A lint that only runs
	// when data happens to exist is a lint nobody has ever executed.
	const PINNED: string[] = [
		"npm:pi-subagents@0.47.1",
		"npm:@scope/pkg@1.2.3",
		"https://github.com/o/r@v1",
		"git:github.com/o/r@abc1234",
		"ssh://git@github.com/o/r@v2.0.0",
	];

	const UNPINNED: string[] = [
		"npm:pi-subagents",
		"npm:@scope/pkg",
		"https://github.com/o/r",
		"git:github.com/o/r",
		"npm:pi-subagents@latest",
		"",
	];

	for (const spec of PINNED) {
		it(`treats "${spec}" as pinned`, () => {
			expect(isPinnedPackageSpec(spec)).toBe(true);
		});
	}

	for (const spec of UNPINNED) {
		it(`treats "${spec}" as unpinned`, () => {
			expect(isPinnedPackageSpec(spec)).toBe(false);
		});
	}

	it("accepts our own repo URL as the one exemption, and nobody else's", () => {
		expect(isOwnRepo(OWN_REPO_URL)).toBe(true);
		expect(isPinnedPackageSpec(OWN_REPO_URL)).toBe(false);
		expect(isOwnRepo("https://github.com/someone-else/ky-pi-agent")).toBe(false);
	});

	it("every third-party entry in .pi/settings.json packages[] carries a ref", () => {
		const settingsPath = join(ROOT, ".pi", "settings.json");
		expect(
			existsSync(settingsPath),
			".pi/settings.json is missing -- its presence is the project-trust trigger",
		).toBe(true);

		const settings = readJson(join(".pi", "settings.json"));
		const packages = settings.packages;
		if (packages === undefined) {
			// Legitimately empty today (Plan 01 created `{}`); the lint above is
			// what proves the rule, and this branch is what applies it later.
			expect(packages).toBeUndefined();
			return;
		}

		expect(Array.isArray(packages)).toBe(true);
		for (const spec of packages as string[]) {
			if (isOwnRepo(spec)) {
				continue;
			}
			expect(
				isPinnedPackageSpec(spec),
				`.pi/settings.json packages[] entry "${spec}" carries no version or git ref -- ` +
					"it can ship new code onto this machine on any `pi update`",
			).toBe(true);
		}
	});
});
