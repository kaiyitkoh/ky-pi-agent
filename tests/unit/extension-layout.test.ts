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
 *
 * ENTRY POINTS vs IMPORTED MODULES — added in Phase 2, and a gap closed rather
 * than a requirement relaxed. The original shape assertion required *every*
 * tracked `.ts` to match one of the two shapes, while its own failure message
 * already sanctioned "a non-entry-point imported by one". The regex never
 * implemented that half; only `index.ts` was ever tested. So the first sibling
 * module under `.pi/extensions/diagnostics/` — a directory that ships a
 * redactor, a JSONL writer and a chokepoint alongside its `index.ts` — would
 * have turned Phase 1's suite red over a file Pi never even tries to load.
 *
 * `isEntryPoint` below is the discriminator. A file carrying a default export
 * is something Pi would attempt to load, so it must sit at an auto-discovered
 * path. A file with none cannot be an extension wherever it sits, and is only
 * reachable through an import — but it still may not sit at the FLAT shape,
 * because that is the path Pi *would* try to load. Deliberately NOT done:
 * widening the regex to `[^/]+\/.*\.ts`. That deletes the requirement instead
 * of expressing it.
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
 * `.pi/extensions/<dir>/…/<name>.ts` — where a non-entry-point module may live.
 *
 * Not an auto-discovered shape and not meant to be: Pi never loads these, an
 * `index.ts` imports them. The only thing this rules out is a module at the
 * flat top level, which would collide with the FLAT entry-point shape.
 */
const NESTED_MODULE = /^\.pi\/extensions\/[^/]+\/.+\.ts$/;

/**
 * A default export at statement position — Pi's own criterion for a loadable
 * extension.
 *
 * Every documented extension shape is `export default function (pi) { … }`
 * [CITED: docs/extensions.md:115-120], and the loader reads `mod.default` and
 * calls it [VERIFIED: src/core/extensions/loader.ts:710-712]. A file without
 * one cannot be an entry point no matter where it sits: there is nothing for
 * Pi to call.
 *
 * Anchored per-line with `m` so prose that merely mentions the phrase — a `//`
 * comment, a jsdoc ` * ` line — is not counted. KNOWN LIMIT, stated rather than
 * hidden: an `export default` alone on its own line inside a block comment
 * still matches. That is the deliberate price of a regex over a parser, and a
 * file written that way is asking to be treated as an entry point.
 */
const DEFAULT_EXPORT = /^[ \t]*export[ \t]+default[ \t]*(async[ \t]+function|function|class|\(|[A-Za-z_$])/m;

/**
 * Is this source an extension entry point rather than an imported module?
 *
 * Exported so the fixtures at the bottom of this file can prove it live. A
 * discriminator that silently answered `false` for everything would classify
 * the whole tree as modules and re-open exactly the hole this function closes,
 * and the shape assertion above it would then assert nothing.
 */
export function isEntryPoint(source: string): boolean {
	return DEFAULT_EXPORT.test(source);
}

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

	// Partition by what the file IS, not by where it sits. Read from disk
	// because git's index has no opinion about default exports; the path set
	// still comes from the index.
	const entryPoints = sources.filter((p) => isEntryPoint(readFileSync(join(repoRoot(), p), "utf-8")));
	const modules = sources.filter((p) => !entryPoints.includes(p));

	it("finds at least one shipped extension source (guards against a vacuous pass)", () => {
		expect(
			sources.length,
			`no tracked .ts files under ${EXT_DIR}/ — without this guard the shape assertion ` +
				"below would pass by asserting nothing at all",
		).toBeGreaterThanOrEqual(1);
	});

	it("finds at least one entry point (guards against a vacuous pass)", () => {
		expect(
			entryPoints.length,
			`no tracked .ts under ${EXT_DIR}/ carries a default export. The shape assertion below ` +
				"constrains entry points only, so a tree of modules and no entry point would satisfy " +
				"it while asserting nothing — and Pi would in fact load no extension at all",
		).toBeGreaterThanOrEqual(1);
	});

	it("has every entry point at an auto-discovered path", () => {
		const offenders = entryPoints.filter((p) => !FLAT.test(p) && !NESTED_INDEX.test(p));
		expect(
			offenders,
			"these paths are not auto-discovered, so `/reload` cannot hot-reload them; " +
				"move each to `.pi/extensions/<name>.ts` or `.pi/extensions/<dir>/index.ts`, " +
				"or make it a non-entry-point imported by one",
		).toEqual([]);
	});

	it("has every imported module inside an extension directory", () => {
		const offenders = modules.filter((p) => !NESTED_MODULE.test(p));
		expect(
			offenders,
			"these files carry no default export yet sit at `.pi/extensions/<name>.ts`, which is " +
				"the FLAT entry-point shape — Pi would try to load each as an extension and find " +
				"nothing to call. Move each under `.pi/extensions/<dir>/` and import it from that " +
				"directory's index.ts, or give it a default export",
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

/**
 * The discriminator, proven live against inline fixtures.
 *
 * The partition above is only as honest as this predicate. If `isEntryPoint`
 * returned `false` for everything, every file would land in `modules`, the
 * auto-discovered-path assertion would iterate an empty list and pass, and the
 * BOOT-05 precondition would be enforced nowhere — the exact vacuous-pass shape
 * this phase keeps tripping over. Four cases, both directions, so neither a
 * dead regex nor an over-eager one can hide here.
 *
 * Fixtures are inline strings rather than files: a fixture on disk under
 * `.pi/extensions/` would itself be enumerated by the suite above.
 */
describe("isEntryPoint — the entry-point discriminator is live", () => {
	it("treats a default-exported function as an entry point", () => {
		expect(
			isEntryPoint("import type { ExtensionAPI } from \"x\";\nexport default function (pi) {}\n"),
			"this is the shape every documented Pi extension has; if it does not read as an entry " +
				"point then nothing does and the path assertion above checks an empty set",
		).toBe(true);
	});

	it("treats a default-exported class as an entry point", () => {
		expect(isEntryPoint("export default class Foo {}\n"), "`export default class` is still a default export").toBe(
			true,
		);
	});

	it("treats a module with only named exports as a module", () => {
		expect(
			isEntryPoint("export const A = 1;\nexport function b() {}\n"),
			"a file with no default export has nothing for Pi to call, so it is an imported module " +
				"and is allowed to sit beside an index.ts",
		).toBe(false);
	});

	it("does not count the phrase when it appears in a comment", () => {
		const source = [
			"// This module is imported by index.ts; it has no export default of its own.",
			" * A jsdoc line may also say export default function without being one.",
			"export const REDACTED = \"x\";",
			"",
		].join("\n");
		expect(
			isEntryPoint(source),
			"the phrase must be at statement position; matching it in prose would classify every " +
				"module that documents the rule as an entry point and demand it move to index.ts",
		).toBe(false);
	});
});
