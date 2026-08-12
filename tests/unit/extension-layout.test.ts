/**
 * BOOT-05 (`/reload`) — structural precondition for hot-reload.
 *
 * OFFLINE PROXY, NOT THE THING ITSELF. `/reload` is a slash command with no
 * non-interactive equivalent, so exercising it needs an interactive TTY that CI
 * does not have. The live behavioural check — `cd ky-pi-agent && pi`, edit the
 * sentinel string, `/reload`, confirm the new value in `--list-models` — is
 * recorded in `docs/RUNBOOK.md` and its status is **OUTSTANDING**. It must
 * never be reported as passed on the strength of this file.
 *
 * What is asserted here is the documented *precondition*: hot-reload works only
 * for auto-discovered locations, and `pi -e ./path.ts` is for quick tests only
 * [CITED: pi 0.84.1 docs/extensions.md:7]. If a shipped extension sits anywhere
 * else, `/reload` cannot possibly pick it up — and that much is checkable
 * offline, today, with no TTY.
 *
 * The four auto-discovered extension shapes
 * [CITED: docs/extensions.md:115-120]
 * [VERIFIED: src/core/extensions/loader.ts:652-684, 710-712]:
 *
 *   ~/.pi/agent/extensions/<name>.ts       global, flat
 *   ~/.pi/agent/extensions/<dir>/index.ts  global, nested index
 *   .pi/extensions/<name>.ts               project-local, flat
 *   .pi/extensions/<dir>/index.ts          project-local, nested index
 *
 * Only the two project-local shapes can appear in this repo, so those are what
 * every tracked `.ts` under `.pi/extensions/` must match. A helper module that
 * is itself an entry point, or an extension wired only through `pi -e`, is not
 * auto-discovered and therefore cannot hot-reload.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot, trackedFiles } from "../helpers/git.ts";

const EXT_DIR = ".pi/extensions";

/** `.pi/extensions/<name>.ts` — flat form. */
const FLAT = /^\.pi\/extensions\/[^/]+\.ts$/;
/** `.pi/extensions/<dir>/index.ts` — nested-index form. */
const NESTED_INDEX = /^\.pi\/extensions\/[^/]+\/index\.ts$/;

/**
 * Glob metacharacters, forbidden in the manifest entry.
 *
 * Non-glob manifest entries go through `resolve(root, entry)` and then
 * directory collection; glob entries go through `globSync(entry, {cwd: root,
 * dot: false})`, and `dot: false` makes behaviour around the dot-prefixed `.pi`
 * segment fragile [VERIFIED: src/core/package-manager.ts:2290-2305].
 */
const GLOB_CHARS = ["*", "?", "[", "!"];

interface PiManifest {
	pi?: { extensions?: unknown };
}

function readPackageJson(): PiManifest {
	return JSON.parse(readFileSync(join(repoRoot(), "package.json"), "utf-8")) as PiManifest;
}

/** Every file beneath `rel` on disk, as repo-relative forward-slash paths. */
function walkOnDisk(rel: string): string[] {
	const abs = join(repoRoot(), rel);
	if (!existsSync(abs)) {
		return [];
	}
	const out: string[] = [];
	for (const entry of readdirSync(abs, { withFileTypes: true })) {
		const child = `${rel}/${entry.name}`;
		if (entry.isDirectory()) {
			out.push(...walkOnDisk(child));
		} else {
			out.push(child);
		}
	}
	return out;
}

describe("BOOT-05 — every shipped extension sits at a hot-reloadable path", () => {
	// The index, not the disk: what a consumer receives is what git committed.
	const sources = trackedFiles(EXT_DIR)
		.filter((p) => p.endsWith(".ts"))
		.sort();

	it("finds at least one shipped extension source (guards against a vacuous pass)", () => {
		expect(
			sources.length,
			`no tracked .ts files under ${EXT_DIR}/ — without this guard the shape assertion ` +
				"below would pass by asserting nothing at all",
		).toBeGreaterThanOrEqual(1);
	});

	it("has every tracked source at an auto-discovered path", () => {
		const offenders = sources.filter((p) => !FLAT.test(p) && !NESTED_INDEX.test(p));
		expect(
			offenders,
			"these paths are not auto-discovered, so `/reload` cannot hot-reload them; " +
				"move each to `.pi/extensions/<name>.ts` or `.pi/extensions/<dir>/index.ts`, " +
				"or make it a non-entry-point imported by one",
		).toEqual([]);
	});

	it("has no ignore file at any level under .pi/extensions/", () => {
		// The two discovery paths disagree: the package path honours `.gitignore`
		// in the directory it scans (package-manager.ts:249,571) while the
		// project-local path does not (loader.ts:652-684). One such file makes
		// BOOT-05 green and BOOT-02 red with no error message anywhere.
		const onDisk = walkOnDisk(EXT_DIR).filter((p) => p.endsWith("/.gitignore"));
		expect(onDisk, "delete it — see the comment above").toEqual([]);

		const tracked = trackedFiles(EXT_DIR).filter((p) => p.endsWith("/.gitignore"));
		expect(tracked, "remove it from the index — see the comment above").toEqual([]);
	});

	it("declares the extensions directory as a literal manifest entry, not a glob", () => {
		const entries = readPackageJson().pi?.extensions;
		expect(Array.isArray(entries), "package.json pi.extensions must be an array").toBe(true);

		const list = entries as string[];
		expect(list).toContain(`./${EXT_DIR}`);

		for (const entry of list) {
			for (const char of GLOB_CHARS) {
				expect(
					entry.includes(char),
					`pi.extensions entry ${JSON.stringify(entry)} contains the glob character ` +
						`${JSON.stringify(char)}; see GLOB_CHARS above for why that is not safe here`,
				).toBe(false);
			}
		}
	});
});
