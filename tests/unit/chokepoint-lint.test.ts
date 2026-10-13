/**
 * Bypassing the callModel() chokepoint in .pi/extensions/ is a build failure. A grep, not ESLint, because adding a
 * linter means new audited devDependencies. Patterns match raw source, comments included, since only a substring
 * survives aliases and indirection; diagnostics/ is exempt by directory so its files can describe the trap. Three
 * vacuity guards: the scanned set and the post-exemption set are non-empty, and every pattern fires on a fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";

/** The scanned tree. Everything outside it is out of scope by design. */
const EXT_DIR = ".pi/extensions";

/** The exempt directory, with a trailing slash so it is a prefix, not a substring of a future sibling. */
const CHOKEPOINT_DIR = ".pi/extensions/diagnostics/";

/** The file the whole rule points at. Asserted to exist and to be exempt. */
const CHOKEPOINT_FILE = ".pi/extensions/diagnostics/call-model.ts";

/** The sanctioned call, spelled once, in the one place allowed to spell it. */
const SANCTIONED_CALL = "modelRegistry.complete";

/**
 * Extension files permitted to bypass callModel(): empty by design. An entry needs, beside it, which call it is, why
 * callModel() cannot carry it, and how it is measured instead, since it produces no turns-* row.
 */
const CHOKEPOINT_BYPASS_ALLOWLIST: readonly string[] = [];

/**
 * The bypass routes, each tolerant of optional chaining and whitespace so a formatter cannot defeat the gate.
 * modelRegistry's non-calling members (find, getAvailable, ...) stay allowed: the line is 'reaches a model'.
 */
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly why: string }[] = [
	{
		pattern: /\bmodelRegistry\s*(?:\?\.|\.)\s*complete\b/,
		why: "the documented direct completion — this is the exact call callModel() wraps",
	},
	{
		pattern: /\bmodelRegistry\s*(?:\?\.|\.)\s*completeSimple\b/,
		why: "the simple-options sibling of complete(); same bypass, different overload",
	},
	{
		pattern: /\bmodelRegistry\s*(?:\?\.|\.)\s*(?:stream|streamSimple)\b/,
		why: "the streaming siblings: same request, no finalized message anyone recorded",
	},
	{
		pattern: /\bmodelRegistry\s*(?:\?\.|\.)\s*getProvider\b/,
		why: "hands back a Provider whose .stream() bypasses every hook and every callback",
	},
	{
		pattern: /getRegisteredNativeProvider/,
		why: "the other route to a raw Provider object (pi src/core/model-registry.ts:143-145)",
	},
	{
		pattern: /from\s+["']@earendil-works\/pi-ai\/api\//,
		why: "deep-imports an adapter's stream directly, skipping the registry entirely",
	},
	{
		pattern: /\bModelRuntime\b/,
		why: "the runtime class is a public export (pi src/index.ts:184) and can be driven directly",
	},
];

/** One offending form per pattern, inline: a fixture file under .pi/extensions/ would fail the gate it proves. */
const OFFENDING_FIXTURE = [
	'import { streamOpenAiCompletions } from "@earendil-works/pi-ai/api/openai-completions.ts";',
	"const a = await ctx.modelRegistry.complete(model, context);",
	"const b = await ctx.modelRegistry ?. completeSimple(model, context);",
	"const c = ctx.modelRegistry  .  stream(model, context);",
	"const d = ctx.modelRegistry.streamSimple(model, context);",
	"const e = ctx.modelRegistry?.getProvider('deepseek');",
	"const f = runtime.getRegisteredNativeProvider('faux');",
	"const g = new ModelRuntime();",
	"",
].join("\n");

/** Tracked `.ts` sources under `.pi/extensions/`, read from the index's view. */
function extensionSources(): { path: string; text: string }[] {
	return trackedFiles(EXT_DIR)
		.filter((p) => p.endsWith(".ts"))
		.sort()
		.map((path) => ({ path, text: readFileSync(join(repoRoot(), path), "utf-8") }));
}

describe("DIAG-03 — no extension bypasses the callModel() chokepoint", () => {
	const sources = extensionSources();
	const scanned = sources.filter(
		(s) => !s.path.startsWith(CHOKEPOINT_DIR) && !CHOKEPOINT_BYPASS_ALLOWLIST.includes(s.path),
	);

	it("finds at least one tracked extension source (guards against a vacuous pass)", () => {
		expect(
			sources.length,
			`no tracked .ts under ${EXT_DIR}/ — every assertion below scans this set, so an empty ` +
				"one turns the whole gate into a pass that verified nothing",
		).toBeGreaterThanOrEqual(1);
	});

	it("has at least one non-exempt file left to scan after the diagnostics exemption", () => {
		expect(
			scanned.length,
			`every tracked .ts under ${EXT_DIR}/ is exempt — either under ${CHOKEPOINT_DIR} or in ` +
				"CHOKEPOINT_BYPASS_ALLOWLIST. The negative assertion below would then iterate an empty " +
				"list and pass while enforcing nothing on anybody. Moving the whole extension tree into " +
				"the exempt directory is exactly how this gate gets neutralised without anyone deleting it",
		).toBeGreaterThanOrEqual(1);
	});

	it(`reaches the model API from nowhere under ${EXT_DIR}/ except the chokepoint`, () => {
		const offenders: string[] = [];
		for (const source of scanned) {
			for (const { pattern, why } of FORBIDDEN) {
				if (pattern.test(source.text)) {
					offenders.push(`${source.path}: matched ${String(pattern)} — ${why}`);
				}
			}
		}

		expect(
			offenders,
			"these files reach the model API without going through the chokepoint, so their calls " +
				"produce no wire records and no turns row and are invisible to every cost, latency and " +
				`quality number this project makes decisions on. Route the call through callModel() from ${CHOKEPOINT_FILE} ` +
				"instead of adding a CHOKEPOINT_BYPASS_ALLOWLIST entry — the allowlist is for a call that " +
				"genuinely cannot be routed, and answering (a)/(b)/(c) beside it is part of the price. " +
				"If the match is in a COMMENT, reword it: these patterns are matched against raw source " +
				"on purpose, and describing the call in prose is the documented alternative",
		).toEqual([]);
	});

	it("proves every forbidden pattern is live against an inline offending fixture", () => {
		// A dead pattern and a clean tree produce identical output, so each pattern must fire on something.
		const dead = FORBIDDEN.filter(({ pattern }) => !pattern.test(OFFENDING_FIXTURE)).map(
			({ pattern, why }) => `${String(pattern)} — ${why}`,
		);

		expect(
			dead,
			"these patterns matched NOTHING in the synthetic offending source, so they are dead and " +
				"the negative assertion above is passing for them no matter what the tree contains. " +
				"Either the pattern is broken or OFFENDING_FIXTURE no longer carries a form of it",
		).toEqual([]);

		expect(
			FORBIDDEN.length,
			"the forbidden set shrank below the six bypass routes 02-RESEARCH.md §9.3 enumerates. " +
				"Removing one is an architectural decision, not a cleanup",
		).toBeGreaterThanOrEqual(6);
	});

	it("keeps the offending fixture inline rather than reading it from disk", () => {
		expect(
			OFFENDING_FIXTURE.includes(SANCTIONED_CALL),
			"the inline fixture no longer contains the sanctioned call it is meant to exercise",
		).toBe(true);

		expect(
			OFFENDING_FIXTURE.split("\n").length,
			"the fixture must carry one offending line per pattern plus the deep import; a shrunken " +
				"fixture is how a pattern quietly stops being exercised while the liveness case above " +
				"still passes on the ones that remain",
		).toBeGreaterThanOrEqual(FORBIDDEN.length + 1);
	});

	it("has a chokepoint that is tracked, exempt, and actually makes the call", () => {
		// Without this, renaming the directory would turn the gate green.
		const chokepoint = sources.find((s) => s.path === CHOKEPOINT_FILE);

		expect(
			chokepoint,
			`${CHOKEPOINT_FILE} is not tracked. The rule enforced above points every model call at a ` +
				"file that does not exist in the index, which makes the whole gate an instruction " +
				"nobody can follow",
		).toBeDefined();

		expect(
			CHOKEPOINT_FILE.startsWith(CHOKEPOINT_DIR),
			`${CHOKEPOINT_FILE} sits outside ${CHOKEPOINT_DIR}, so the directory exemption does not ` +
				"cover it and the chokepoint would be reported as its own worst offender",
		).toBe(true);

		expect(
			chokepoint?.text.includes(SANCTIONED_CALL),
			`${CHOKEPOINT_FILE} does not contain ${SANCTIONED_CALL}. Either the chokepoint stopped ` +
				"calling the model — in which case every route to a model is now banned and none is " +
				"sanctioned — or the call was renamed and the FORBIDDEN patterns above are watching " +
				"for a spelling that no longer exists anywhere",
		).toBe(true);
	});
});
