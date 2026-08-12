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
 *   - Peers are never installed by us. jiti aliases every one of them to Pi's
 *     own bundled copy at load time (`loader.ts:118-140`), so the version that
 *     actually executes is the host's, whatever we wrote here.
 *   - Bundling or pinning them creates a SECOND module instance and breaks
 *     `instanceof` across the extension boundary.
 *   - The exact version we develop and test against is pinned in
 *     `devDependencies` and locked in `package-lock.json`. That is where the
 *     BOOT-08 obligation is discharged. [RESEARCH.md 8.3 tension 1]
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
