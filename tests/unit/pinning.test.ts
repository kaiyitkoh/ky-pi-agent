/**
 * Nothing in the dependency surface may drift: no range operator, a tracked package-lock.json, toolchain pins matching
 * Pi core's own devDependencies, and a ref on every third-party Pi package source. CI action pinning is
 * tests/unit/ci-pinning.test.ts.
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
 * The host-provided peers: the only `"*"` ranges allowed (docs/packages.md:171), because jiti aliases each to Pi's own
 * copy at load time and bundling one breaks `instanceof`. `npm install --omit=dev` still installs them into a clone, so
 * package-lock.json is their only pin, asserted below.
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

/** Pi core's own devDependencies rather than npm latest: type compatibility with Pi's `.d.ts` is what matters. */
const REQUIRED_DEV_PINS: Record<string, string> = {
	"@earendil-works/pi-coding-agent": "1.1.0",
	"@earendil-works/pi-ai": "1.1.0",
	"@earendil-works/pi-tui": "1.1.0",
	"@earendil-works/pi-agent-core": "1.1.0",
	typebox: "1.3.27",
	vitest: "4.1.11",
	"@types/node": "24.12.4",
};

/**
 * The only runtime `dependencies` allowed, at exact versions: Pi installs with `--omit=dev`, so tool-path packages such
 * as unbash must live here, and an ungoverned block is where an unaudited package would land silently.
 */
const REQUIRED_RUNTIME_PINS: Record<string, string> = {
	typescript: "5.9.3",
	unbash: "4.0.10",
};

/**
 * True when a Pi package source cannot move under you: a versioned npm spec or a git source with `@ref`
 * (docs/packages.md:90). Known limit: a git URL with userinfo (`user@host`) is judged pinned.
 */
export function isPinnedPackageSpec(spec: string): boolean {
	return /^npm:.+@[0-9]/.test(spec) || /^(git:|https:\/\/|http:\/\/|ssh:\/\/|git:\/\/).+@.+$/.test(spec);
}

/** Our own repo, installed unrefed on purpose so `pi update` follows its default branch; third-party sources need a ref. */
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

		// An allow-list: a peer name reappearing with `*` in an installed map is not covered by it.
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
		// Shrinkwrap only matters for npm-published packages; Pi consumes this repo by clone, where the lockfile applies.
		expect(existsSync(join(ROOT, "npm-shrinkwrap.json"))).toBe(false);
		expect(trackedFiles("npm-shrinkwrap.json")).toEqual([]);
	});

	/** The lock's `@earendil-works/*` entries are the only pin the `"*"` peers have. */
	const PI_FAMILY_PIN = "1.1.0";

	interface LockEntry {
		readonly version?: string;
		readonly dev?: boolean;
	}

	const lockPackages = (readJson("package-lock.json").packages ?? {}) as Record<string, LockEntry>;

	/** `node_modules/@earendil-works/<pkg>` lock entries, path -> version. */
	const runtimePiEntries = Object.entries(lockPackages).filter(
		([path]) => /^node_modules\/@earendil-works\/[^/]+$/.test(path),
	);
	// No dev filter: without a Pi shrinkwrap npm marks every Pi-family entry dev:true, yet they remain the only pin.

	it("locks at least one @earendil-works entry", () => {
		// Without this the loop below could pass over an empty set.
		expect(
			runtimePiEntries.length,
			"no @earendil-works entry in package-lock.json; either the lock " +
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

	it("locks typebox at the audited pin", () => {
		const typebox = lockPackages["node_modules/typebox"];
		expect(typebox, "typebox is a `\"*\"` peer and must be present in the lock").toBeDefined();
		expect(typebox?.version).toBe(REQUIRED_DEV_PINS.typebox);
	});
});

describe("BOOT-08.3 -- the toolchain matches Pi core 1.1.0, not the registry", () => {
	const dev = depMap("devDependencies");

	for (const [name, version] of Object.entries(REQUIRED_DEV_PINS)) {
		it(`pins ${name} at ${version}`, () => {
			expect(dev[name]).toBe(version);
		});
	}

	it("declares no dev dependency beyond the audited pins", () => {
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
		// Anything extra has not been through the Package Legitimacy Audit, and this is what `--omit=dev` installs.
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
	// Proven against a table so the lint runs even while settings carry no packages.
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
			// Legitimately absent; the table above proves the rule.
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
