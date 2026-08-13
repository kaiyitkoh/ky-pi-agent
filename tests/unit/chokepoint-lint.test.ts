/**
 * DIAG-03 — bypassing the chokepoint is a build failure, not a code review note.
 *
 * THE RULE. DIAG-02 says every model invocation in this harness routes through
 * `callModel()` in `.pi/extensions/diagnostics/call-model.ts`. A rule written in
 * markdown and asserted nowhere is a rule the next phase breaks: Phase 5's
 * router and Phase 8's quality gates both want to call a model, and the cheapest
 * way to do that is the direct one. This file is what makes the cheap way fail.
 *
 * WHY A GREP AND NOT A LINTER. `no-restricted-syntax` under ESLint has the
 * correct AST semantics and the wrong price. `tests/unit/pinning.test.ts:253`
 * asserts `Object.keys(devDependencies)` equals exactly six audited pins, so
 * adding `eslint` + `typescript-eslint` + a config package fails that test and
 * requires a Package Legitimacy Audit of each — in a repo whose Phase 1 thesis
 * is supply-chain minimalism. A tsc-level trick cannot express "this symbol may
 * only be referenced from this directory" at all. So: zero dependencies, the
 * same shape as `tests/unit/contributing-boundary.test.ts` (BOOT-10), which has
 * held this exact kind of line since Phase 1. (02-RESEARCH.md §9.2.)
 *
 * SCOPE, STATED RATHER THAN IMPLIED. This gate applies to tracked `.ts` under
 * `.pi/extensions/` and to nothing else. `docs/`, `CONTRIBUTING.md` and
 * everything under `tests/` may discuss and even perform these calls freely —
 * the negative control in `tests/integration/call-model.test.ts` has to make a
 * bare completion, or it would not be a control. A later phase that genuinely
 * needs a direct call does not delete this file: it adds the path to
 * {@link CHOKEPOINT_BYPASS_ALLOWLIST} below, in the same commit, with the
 * written justification beside it. Making the exception visible and argued is
 * the whole point.
 *
 * NAMING DISCIPLINE. The patterns are matched against RAW SOURCE, comments
 * included, exactly as BOOT-10's `registerTool` substring is. That is
 * deliberate — a substring is the only form that survives `ctx["modelRegistry"]`,
 * a destructured alias or a `const m = "complete"` indirection — and the price
 * is real: no extension file outside `diagnostics/` may spell these calls even
 * in prose. Describe them instead, the way `.pi/extensions/harness/index.ts`
 * says "the tool-registration call". Inside `diagnostics/` the discipline does
 * not apply, because the exemption is by DIRECTORY: `wire.ts` already names
 * `modelRegistry.complete` and the model runtime class in its docstring, and
 * narrowing the exemption to `call-model.ts` alone would have made that a build
 * failure for describing the very trap it warns about (02-PATTERNS blocker B4).
 *
 * THE VACUOUS-PASS GUARD. Phase 1 tripped this class twice — a `check-ignore`
 * without `--no-index`, and an npm probe that read its launcher's environment.
 * A grep over an empty file set is a green run that verified nothing, and a
 * regex set that matches nothing is the same failure one level down. So there
 * are three guards, not one: the scanned set is asserted non-empty, the set
 * REMAINING AFTER the `diagnostics/` exemption is asserted non-empty (otherwise
 * moving every extension into `diagnostics/` would turn the gate green while
 * proving nothing), and every pattern is run against an inline offending fixture
 * and asserted to fire.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";

/** The scanned tree. Everything outside it is out of scope by design. */
const EXT_DIR = ".pi/extensions";

/**
 * The exempt directory — note the trailing slash, so it is a prefix and not a
 * substring of some future `.pi/extensions/diagnostics-experiments/`.
 *
 * Exempting the DIRECTORY rather than `call-model.ts` alone is what lets the
 * chokepoint's siblings document the trap. See NAMING DISCIPLINE above.
 */
const CHOKEPOINT_DIR = ".pi/extensions/diagnostics/";

/** The file the whole rule points at. Asserted to exist and to be exempt. */
const CHOKEPOINT_FILE = ".pi/extensions/diagnostics/call-model.ts";

/** The sanctioned call, spelled once, in the one place allowed to spell it. */
const SANCTIONED_CALL = "modelRegistry.complete";

/**
 * Extension files permitted to bypass `callModel()`.
 *
 * EMPTY BY DESIGN. The chokepoint's own directory is exempt structurally, so no
 * diagnostics file will ever need an entry here — which means an entry appearing
 * in this array is always a real architectural decision.
 *
 * To add one you must, in the same commit, write beside it: (a) which model call
 * this is, (b) why `callModel()` cannot carry it, and (c) how the call will be
 * measured instead, given that it will produce no `turns-*` row. Without (c) the
 * cost accounting in Phase 8 silently under-reports and nothing anywhere says so.
 */
const CHOKEPOINT_BYPASS_ALLOWLIST: readonly string[] = [];

/**
 * The bypass routes, each with the reason it is banned.
 *
 * Exactly the 02-RESEARCH.md §9.3 set. Every `modelRegistry` pattern tolerates
 * optional chaining and arbitrary whitespace around the dot, because
 * `modelRegistry ?. complete` is the same call and a gate defeated by a
 * formatter is not a gate.
 *
 * DELIBERATELY NOT BANNED: `modelRegistry.find`, `.getAvailable`, `.getAll`,
 * `.hasConfiguredAuth`, `.getProviderAuthStatus` and `.registerProvider`. Phase
 * 5's capability guard needs all six, and banning the whole `modelRegistry`
 * substring would force that phase to gut the allowlist — an allowlist everyone
 * edits is not a control. The line drawn here is "reaches a model", not
 * "mentions the registry".
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

/**
 * A synthetic source carrying one offending form per pattern.
 *
 * INLINE, and asserted below never to be read from disk. A fixture file under
 * `.pi/extensions/` would be enumerated by the scan itself and fail the gate it
 * exists to prove; a fixture anywhere else would be one more thing to keep in
 * sync. It also exercises the whitespace and optional-chaining tolerance the
 * patterns claim, rather than only the tidy spelling.
 */
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
		// A regex set proven only against a clean tree is a set that could be
		// uniformly broken — a stray `^` anchor, an escaping slip during a rename —
		// and never noticed, because a dead pattern and a clean repository produce
		// byte-identical output. Each pattern must fire against something.
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
		// A fixture file under `.pi/extensions/` would be enumerated by the scan
		// above and fail the very gate it exists to prove; one outside would be a
		// second copy of the rule to keep in sync. Asserting the shape rather than
		// the mechanism, since the fixture is a `const` two screens up.
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
		// Without this, renaming the directory turns the gate green — everything
		// becomes non-matching prose — and nothing anywhere goes red. Here the
		// rename makes THIS case fail instead, which is the loud half of the pair.
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
