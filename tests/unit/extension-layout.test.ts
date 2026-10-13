/**
 * The precondition for `/reload`: hot-reload works only for auto-discovered locations, so every entry point under
 * `.pi/extensions/` must be `<name>.ts` or `<dir>/index.ts`. The live `/reload` check needs a TTY and is OUTSTANDING
 * in docs/RUNBOOK.md. A file with a default export is an entry point; one without is an imported module, which may
 * live in a subdirectory but never at the flat shape Pi would try to load.
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

/** Where a non-entry-point module may live: any subdirectory, never the flat top level. */
const NESTED_MODULE = /^\.pi\/extensions\/[^/]+\/.+\.ts$/;

/**
 * A default export at statement position: Pi's loader calls `mod.default`. Anchored per line so a comment mentioning
 * it does not count; a bare `export default` line inside a block comment still matches, a known limit.
 */
const DEFAULT_EXPORT = /^[ \t]*export[ \t]+default[ \t]*(async[ \t]+function|function|class|\(|[A-Za-z_$])/m;

/** True for an extension entry point; exported so inline fixtures prove it answers both ways. */
export function isEntryPoint(source: string): boolean {
	return DEFAULT_EXPORT.test(source);
}

/** Glob metacharacters, forbidden in the manifest: glob entries run `globSync` with `dot: false`, fragile around `.pi`. */
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

	// Partition by content read from disk; the path set comes from the index.
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
		// The package path honours .gitignore and the project-local path does not, so one such file breaks BOOT-02 silently.
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
 * The discriminator against inline fixtures, both directions: a predicate answering false for everything would empty
 * the entry-point list and make the shape check vacuous. Inline, because a fixture under .pi/extensions/ would be scanned.
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
