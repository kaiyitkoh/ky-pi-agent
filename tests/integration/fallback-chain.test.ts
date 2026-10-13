/**
 * The fallback chain advances exactly one hop on quota, rate limit and outage, and spends nothing on a 400; the fatal
 * control runs in the same session, since an implementation that always advances passes every positive. A probe parks
 * the live ExtensionContext on globalThis (jiti isolates module registries; session_start does not fire headless).
 * Native faux providers replace the built-in `deepseek`, and each run checks the resolved model is this run's faux.
 * The error strings are fixtures; the retryable/fatal split is Pi's own predicate, re-checked in case 7.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, isRetryableAssistantError } from "@earendil-works/pi-ai";
import type { ExtensionContext, ModelRuntime } from "@earendil-works/pi-coding-agent";

import { beforeAll, describe, expect, it } from "vitest";

import { logPath } from "../../.pi/extensions/diagnostics/jsonl.ts";
import { TURNS_LOG_BASE, type RowKind } from "../../.pi/extensions/diagnostics/schema.ts";
import { callWithFallback, classifyFailure, type HopGuard } from "../../.pi/extensions/providers/fallback.ts";
import { CHAIN, QUOTA_PATTERN, type FailureClass } from "../../.pi/extensions/providers/schema.ts";
import {
	CLASS_FIXTURES,
	DASHSCOPE_QUOTA_FIXTURES,
	NON_QUOTA_BILLING_FIXTURES,
	QUOTA_ALTERNATIVE_FIXTURES,
	SSO_FIXTURES,
} from "../fixtures/provider-errors.ts";
import { wrapFauxWithPayload, wrapFauxWithStatus } from "../helpers/faux.ts";
import { repoRoot } from "../helpers/git.ts";
import { readTornSafe } from "../helpers/logs.ts";
import { withModelsConfig } from "../helpers/models.ts";
import { withFauxSession } from "../helpers/session.ts";

/** Where the probe parks the live `ExtensionContext`. See the header. */
const CTX_KEY = "__kypiFallbackChainExtensionContext";

/**
 * A regex source's top-level alternatives, by a character walk tracking groups, classes and escapes (a splitting regex
 * breaks as groups are added). Lets case 3c tie QUOTA_PATTERN to its fixture table in both directions.
 */
function topLevelAlternatives(source: string): string[] {
	const out: string[] = [];
	let current = "";
	let depth = 0;
	let inClass = false;

	for (let i = 0; i < source.length; i += 1) {
		const ch = source[i] as string;

		// An escape consumes the next character, so an escaped `|`, `[`, `(` or `)` never changes state.
		if (ch === "\\") {
			current += ch + (source[i + 1] ?? "");
			i += 1;
			continue;
		}
		if (inClass) {
			if (ch === "]") {
				inClass = false;
			}
			current += ch;
			continue;
		}
		if (ch === "[") {
			inClass = true;
			current += ch;
			continue;
		}
		if (ch === "(") {
			depth += 1;
			current += ch;
			continue;
		}
		if (ch === ")") {
			depth -= 1;
			current += ch;
			continue;
		}
		if (ch === "|" && depth === 0) {
			out.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	out.push(current);
	return out;
}

/** Absolute path of the diagnostics extension this repository ships. */
const DIAGNOSTICS_ENTRY = `${repoRoot()}/.pi/extensions/diagnostics/index.ts`;

/** The shipped models template — the composed registry case 6 asserts over. */
const MODELS_TEMPLATE = join(repoRoot(), ".pi", "templates", "models-template.json");

/**
 * The real diagnostics extension (case 5 reads its logs) plus a probe on three hooks, so a change in Pi's emit order
 * cannot silently leave the probe empty.
 */
const PROBE_SOURCE = [
	"// Generated for tests/integration/fallback-chain.test.ts. Lives in a temp dir.",
	`import diagnostics from ${JSON.stringify(DIAGNOSTICS_ENTRY)};`,
	"",
	'const HOOKS = ["session_start", "before_agent_start", "before_provider_headers"];',
	"",
	"export default function (pi) {",
	"\tdiagnostics(pi);",
	"\tfor (const hook of HOOKS) {",
	"\t\tpi.on(hook, (_event, ctx) => {",
	`\t\t\tglobalThis[${JSON.stringify(CTX_KEY)}] = ctx;`,
	"\t\t});",
	"\t}",
	"}",
].join("\n");

/** The HTTP status each class's first provider reports, via `wrapFauxWithStatus`. */
const CLASS_STATUS: Readonly<Record<FailureClass, number>> = {
	quota: 429,
	transient: 429,
	unavailable: 503,
	fatal: 400,
};

/** What the second provider says when it is reached. Distinctive on purpose. */
const SECOND_PROVIDER_REPLY = "the second hop answered";

/** What the first provider says when it is the one that succeeds (case 4). */
const FIRST_PROVIDER_REPLY = "the first hop answered";

/** A turns row as this file reads it back off disk. */
interface TurnsRow {
	kind?: RowKind;
	role?: string;
	provider?: string;
	model?: string;
	httpStatus?: number;
	outcome?: string;
}

/** One walk of the chain, recorded per provider. */
interface ChainRun {
	/** Attempts against the FIRST chain entry. */
	first: number;
	/** Attempts against the SECOND chain entry. */
	second: number;
	/** What `callWithFallback` returned. */
	message: AssistantMessage;
	/** `api` id of the model the chain resolved for hop 1 — the identity guard. */
	resolvedFirstApi: string | undefined;
	/** `api` id of the model the chain resolved for hop 2. */
	resolvedSecondApi: string | undefined;
	/** `api` id this run's own faux handle for hop 1 was built with. */
	expectedFirstApi: string;
	/** `api` id this run's own faux handle for hop 2 was built with. */
	expectedSecondApi: string;
	/** The role this walk ran under, which is the turns-row join key. */
	role: string;
}

/** What a walk against a deliberately-rejecting registry facade did. */
interface RejectionRun {
	/** How many hops actually reached the facade before the chain gave up. */
	calls: number;
	/** The message of the value that came back out, or `undefined` if none did. */
	thrown: string | undefined;
}

/** Everything the one session produced, read once and asserted on by every case. */
interface Fixture {
	sawContext: boolean;
	runs: Record<string, ChainRun>;
	turns: TurnsRow[];
	turnsFileExisted: boolean;
	/** What an unresolved chain entry produced: a throw, or nothing at all. */
	unresolved: { threw: boolean; message: string };
	/** A rejection whose text is fatal-shaped: must stop at the first hop. */
	rejectFatal: RejectionRun;
	/** A rejection whose text is transient-shaped: must reach both hops. */
	rejectTransient: RejectionRun;
	/** First hop fails with a transient 429 while the second hop has no configured auth. */
	authSkip: ChainRun | undefined;
	/** First hop fails transiently while the guard refuses the second hop. */
	guardSkip: ChainRun | undefined;
	/** What a guard that refuses every hop produced. */
	guardAll: { calls: number; thrown: string | undefined };
}

/** A scripted provider failure carrying exactly the text under test. */
function failure(text: string): AssistantMessage {
	return fauxAssistantMessage("", { stopReason: "error", errorMessage: text });
}

/**
 * Walks the chain once against two freshly registered faux providers. Fresh handles keep every `callCount` absolute;
 * re-registering an id replaces the previous registration.
 */
async function walkChain(
	ctx: ExtensionContext,
	modelRuntime: ModelRuntime,
	spec: {
		role: string;
		firstResponse: AssistantMessage;
		secondResponse: AssistantMessage;
		status: number;
		guard?: HopGuard;
	},
): Promise<ChainRun> {
	const [firstEntry, secondEntry] = CHAIN;
	if (firstEntry === undefined || secondEntry === undefined) {
		throw new Error(
			"walkChain: CHAIN no longer has two entries. This fixture scripts one provider per hop, " +
				"so a chain of a different length needs the fixture updated rather than the assertion " +
				"loosened",
		);
	}

	const firstFaux = fauxProvider({
		provider: firstEntry.provider,
		models: [{ id: firstEntry.id, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } }],
	});
	const secondFaux = fauxProvider({
		provider: secondEntry.provider,
		models: [{ id: secondEntry.id, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } }],
	});

	firstFaux.setResponses([spec.firstResponse]);
	secondFaux.setResponses([spec.secondResponse]);

	// `wrapFauxWithStatus` is the only way a non-200 reaches the turns row.
	modelRuntime.registerNativeProvider(
		wrapFauxWithStatus(wrapFauxWithPayload(firstFaux), spec.status),
	);
	modelRuntime.registerNativeProvider(wrapFauxWithStatus(wrapFauxWithPayload(secondFaux), 200));

	const message = await callWithFallback(ctx, {
		role: spec.role,
		messages: [{ role: "user", content: `walk the chain: ${spec.role}`, timestamp: Date.now() }],
	}, spec.guard);

	return {
		first: firstFaux.state.callCount,
		second: secondFaux.state.callCount,
		message,
		// Read through the session's registry facade, the object the chain used.
		resolvedFirstApi: ctx.modelRegistry.find(firstEntry.provider, firstEntry.id)?.api,
		resolvedSecondApi: ctx.modelRegistry.find(secondEntry.provider, secondEntry.id)?.api,
		expectedFirstApi: firstFaux.api,
		expectedSecondApi: secondFaux.api,
		role: spec.role,
	};
}

/**
 * The real context with one member shadowed via `Object.create`, which keeps getters live where a spread would
 * snapshot them. Model lookup still goes to the real facade.
 */
function withShadowedRegistry(
	ctx: ExtensionContext,
	registry: Record<string, unknown>,
): ExtensionContext {
	return Object.create(ctx, {
		modelRegistry: {
			value: {
				find: (provider: string, id: string) => ctx.modelRegistry.find(provider, id),
				hasConfiguredAuth: () => true,
				complete: (...args: Parameters<ExtensionContext["modelRegistry"]["complete"]>) =>
					ctx.modelRegistry.complete(...args),
				...registry,
			},
		},
	}) as ExtensionContext;
}

/**
 * Walks the chain against a facade that rejects. Nothing in Pi reaches this branch on its own, but the chokepoint
 * rethrows facade rejections for the caller to decide, so the catch must be tested.
 */
async function walkRejecting(ctx: ExtensionContext, text: string): Promise<RejectionRun> {
	let calls = 0;
	const rejecting = withShadowedRegistry(ctx, {
		complete: () => {
			calls += 1;
			return Promise.reject(new Error(text));
		},
	});

	let thrown: string | undefined;
	try {
		await callWithFallback(rejecting, {
			role: "chain-rejection",
			messages: [{ role: "user", content: "reject me", timestamp: Date.now() }],
		});
	} catch (error) {
		thrown = error instanceof Error ? error.message : String(error);
	}
	return { calls, thrown };
}

async function runFixture(): Promise<Fixture> {
	// A stale context from another file in this worker would fake the probe guard.
	(globalThis as Record<string, unknown>)[CTX_KEY] = undefined;

	return await withFauxSession(
		{
			extensionSource: PROBE_SOURCE,
			// One response: the warm-up prompt that hands the probe a live context.
			responses: [fauxAssistantMessage("warm", { stopReason: "stop" })],
		},
		async ({ cwd, session, modelRuntime }) => {
			await session.prompt("warm up");

			const parkedCtx = (globalThis as Record<string, unknown>)[CTX_KEY] as
				| ExtensionContext
				| undefined;
			// Faux providers carry no credential, so the registry would report no configured auth for every hop.
			const ctx = parkedCtx === undefined ? undefined : withShadowedRegistry(parkedCtx, {});

			const turnsFile = logPath(cwd, TURNS_LOG_BASE);
			const runs: Record<string, ChainRun> = {};

			const noRun: RejectionRun = { calls: 0, thrown: undefined };

			if (ctx === undefined) {
				// Return, not throw, so case 0 fails with its own message.
				return {
					sawContext: false,
					runs,
					turns: [],
					turnsFileExisted: false,
					unresolved: { threw: false, message: "" },
					rejectFatal: noRun,
					rejectTransient: noRun,
					authSkip: undefined,
					guardSkip: undefined,
					guardAll: { calls: 0, thrown: undefined },
				};
			}

			// The three advancing classes, then the fatal control, in one session.
			for (const name of ["quota", "transient", "unavailable", "fatal"] as const) {
				runs[name] = await walkChain(ctx, modelRuntime, {
					role: `chain-${name}`,
					firstResponse: failure(CLASS_FIXTURES[name].text),
					secondResponse: fauxAssistantMessage(SECOND_PROVIDER_REPLY, { stopReason: "stop" }),
					status: CLASS_STATUS[name],
				});
			}

			// The chain must not call ahead when the first hop answers.
			runs.success = await walkChain(ctx, modelRuntime, {
				role: "chain-success",
				firstResponse: fauxAssistantMessage(FIRST_PROVIDER_REPLY, { stopReason: "stop" }),
				secondResponse: fauxAssistantMessage(SECOND_PROVIDER_REPLY, { stopReason: "stop" }),
				status: 200,
			});

			// An unresolved entry (as a renamed upstream id would look) must be an error, never a skipped hop.
			const unresolvedCtx = withShadowedRegistry(ctx, { find: () => undefined });
			let unresolved = { threw: false, message: "" };
			try {
				await callWithFallback(unresolvedCtx, {
					role: "chain-unresolved",
					messages: [{ role: "user", content: "nothing resolves", timestamp: Date.now() }],
				});
			} catch (error) {
				unresolved = {
					threw: true,
					message: error instanceof Error ? error.message : String(error),
				};
			}

			// The catch branch both ways: fatal-shaped stops at hop 1, advancing reaches both.
			const rejectFatal = await walkRejecting(
				ctx,
				"Error code: 400 - {'error': {'message': 'Invalid request from the facade'}}",
			);
			const rejectTransient = await walkRejecting(ctx, "fetch failed while dialling the provider");

			const secondHop = CHAIN[1];
			const noSecondAuth = withShadowedRegistry(ctx, {
				hasConfiguredAuth: (model: { provider: string }) => model.provider !== secondHop?.provider,
			});
			const authSkip = await walkChain(noSecondAuth, modelRuntime, {
				role: "chain-auth-skip",
				firstResponse: failure(CLASS_FIXTURES.transient.text),
				secondResponse: fauxAssistantMessage(SECOND_PROVIDER_REPLY, { stopReason: "stop" }),
				status: CLASS_STATUS.transient,
			});

			const secondProvider = CHAIN[1]?.provider;
			const guardSkip = await walkChain(ctx, modelRuntime, {
				role: "chain-guard-skip",
				firstResponse: failure(CLASS_FIXTURES.transient.text),
				secondResponse: fauxAssistantMessage(SECOND_PROVIDER_REPLY, { stopReason: "stop" }),
				status: CLASS_STATUS.transient,
				guard: (m) => (m.provider === secondProvider ? { ok: false, reason: "context window too small" } : { ok: true }),
			});
			let guardAll: Fixture["guardAll"] = { calls: 0, thrown: undefined };
			try {
				await walkChain(ctx, modelRuntime, {
					role: "chain-guard-all",
					firstResponse: fauxAssistantMessage(FIRST_PROVIDER_REPLY, { stopReason: "stop" }),
					secondResponse: fauxAssistantMessage(SECOND_PROVIDER_REPLY, { stopReason: "stop" }),
					status: 200,
					guard: (m) => ({ ok: false, reason: `refuses ${m.id}` }),
				});
			} catch (error) {
				guardAll = { calls: 0, thrown: error instanceof Error ? error.message : String(error) };
			}

			const turnsFileExisted = existsSync(turnsFile);
			const { records, unparseable } = turnsFileExisted
				? readTornSafe(turnsFile)
				: { records: [], unparseable: [] };
			if (unparseable.length > 0) {
				throw new Error(
					`${turnsFile} holds ${unparseable.length} unparseable line(s): ${unparseable[0]}`,
				);
			}

			return {
				sawContext: true,
				runs,
				turns: records as TurnsRow[],
				turnsFileExisted,
				unresolved,
				rejectFatal,
				rejectTransient,
				authSkip,
				guardSkip,
				guardAll,
			};
		},
	);
}

let fixture: Fixture;

/** The run for `name`, or a throw naming what is missing. */
function run(name: string): ChainRun {
	const found = fixture.runs[name];
	if (found === undefined) {
		throw new Error(
			`the fixture recorded no '${name}' walk, so the assertions below would read undefined. ` +
				"The likeliest cause is the session returning early because the probe never handed over " +
				"an ExtensionContext — see case 0",
		);
	}
	return found;
}

describe("PROV-08 — the DeepSeek-direct -> DashScope chain, against its fatal control", () => {
	beforeAll(async () => {
		fixture = await runFixture();
	}, 60_000);

	it("case 0 — the probe really handed over a live ExtensionContext", () => {
		expect(
			fixture.sawContext,
			"the user-scope probe never parked an ExtensionContext, so `callWithFallback` was never " +
				"called and every case below is asserting over an empty record. The likeliest cause is " +
				"the extension not loading at all: it must sit at USER scope, because project-scoped " +
				"`.pi/extensions` is gated behind project trust and that resolves false headless with no " +
				"UI to answer the prompt",
		).toBe(true);
	});

	it("case 1 — every hop resolved THIS fixture's faux provider, not the real catalogue", () => {
		// Without native registration the chain would resolve the real built-in entry. The loop is floored itself: an
		// empty `fixture.runs` would otherwise pass exactly when the identity guard matters most.
		expect(
			Object.keys(fixture.runs).length,
			"no chain walk was recorded, so the identity guard below iterates nothing and " +
				"passes without checking a single hop [IN-06]",
		).toBeGreaterThanOrEqual(5);

		for (const name of Object.keys(fixture.runs)) {
			const walk = run(name);
			expect(
				walk.resolvedFirstApi,
				`the '${name}' walk resolved ${CHAIN[0]?.provider}/${CHAIN[0]?.id} to a model whose api ` +
					`id is not this run's faux provider. The registration did not replace the built-in, so ` +
					`the chain was pointed at the real catalogue entry`,
			).toBe(walk.expectedFirstApi);
			expect(
				walk.resolvedSecondApi,
				`the '${name}' walk resolved ${CHAIN[1]?.provider}/${CHAIN[1]?.id} to something other ` +
					"than this run's faux provider",
			).toBe(walk.expectedSecondApi);
		}
	});

	it.each(["quota", "transient", "unavailable"] as const)(
		"case 2 — a %s failure advances exactly one hop, with no same-provider retry",
		(name) => {
			const walk = run(name);

			expect(
				walk.first,
				`the first provider was attempted ${walk.first} times on a ${name} failure. Exactly 1 is ` +
					"required: 0 means the chain never called it and this whole class is untested; more " +
					"than 1 means something retried the SAME provider, which cannot help against a quota " +
					"wall and doubles the wall-clock of an outage",
			).toBe(1);

			expect(
				walk.second,
				`the second provider was attempted ${walk.second} times on a ${name} failure. Exactly 1 ` +
					"is required: 0 means the chain did not advance and PROV-08 is unmet, more than 1 " +
					"means the second hop was retried too",
			).toBe(1);

			expect(
				walk.message.stopReason,
				`a ${name} failure on the first provider did not end with the second provider's ` +
					"successful message. The chain advanced but returned the wrong one",
			).toBe("stop");

			expect(
				JSON.stringify(walk.message.content),
				`the returned message is not the second provider's reply, so the caller would act on a ` +
					`message that did not come from the hop that succeeded`,
			).toContain(SECOND_PROVIDER_REPLY);

			expect(
				classifyFailure(CLASS_FIXTURES[name].text),
				`the '${name}' fixture no longer classifies as '${name}'. The attempt counts above would ` +
					"still be green under whatever class it landed in, which is exactly how a taxonomy " +
					"quietly stops being the thing under test",
			).toBe(name);
		},
	);

	it("case 3 — THE CONTROL: a fatal failure does not spend a second provider", () => {
		const advanced = run("quota");
		const walk = run("fatal");

		// The paired positive first, in the same session: a chain that never advances satisfies the zero below.
		expect(
			advanced.second,
			"the quota walk did not advance either, so 'the second provider was not attempted' below " +
				"is a property of a chain that never advances rather than evidence about fatal errors. " +
				"This is the pairing that makes the control a control",
		).toBe(1);

		expect(
			walk.first,
			"the first provider was not attempted exactly once on a fatal failure, so the walk under " +
				"test did not happen the way the control assumes",
		).toBe(1);

		expect(
			walk.second,
			"THE SECOND PROVIDER WAS DIALLED AFTER A 400. A malformed request is malformed at every " +
				"vendor, so this spent a second provider to be rejected a second time — and it forwarded " +
				"the user's prompt, system prompt and tool schemas to a vendor their request was never " +
				"aimed at. The same path is what a 401 or an expired credential would take " +
				"[threat T-03-10-01, T-03-10-02]",
		).toBe(0);

		expect(
			walk.message.errorMessage,
			"the fatal walk did not return the failing message, so the caller cannot see what went " +
				"wrong or decide what to do about it",
		).toBe(CLASS_FIXTURES.fatal.text);

		expect(walk.message.stopReason, "the returned fatal message is no longer error-stopped").toBe(
			"error",
		);

		// A bare `billing` alternative means "forward the prompt to another vendor" here, the inverse of Pi's "do not
		// retry", so a 400 that merely mentions billing must stay fatal.
		expect(
			NON_QUOTA_BILLING_FIXTURES.length,
			"the non-quota billing table is empty, so the loop below iterates nothing and the " +
				"only control on QUOTA_PATTERN's borrowed tokens is gone with nothing red",
		).toBeGreaterThanOrEqual(2);

		for (const billingFixture of NON_QUOTA_BILLING_FIXTURES) {
			expect(
				classifyFailure(billingFixture.text),
				`${JSON.stringify(billingFixture.text.slice(0, 56))}... classifies as advancing. ` +
					"It merely MENTIONS billing: it is not a quota wall, it fails identically at " +
					"every vendor, and advancing forwards the user's prompt, system prompt and tool " +
					"schemas to a second vendor to be rejected a second time. This is a prompt " +
					"disclosure, not a wasted call [CR-03, threat T-03-10-01, T-03-10-02]",
			).toBe("fatal");
		}

		// Paired positive: a real quota wall that mentions billing still advances.
		expect(
			classifyFailure(CLASS_FIXTURES.quota.text),
			"the real quota fixture stopped classifying as quota. The anchoring of the borrowed " +
				"billing token has narrowed the pattern past the failure it exists to catch, which " +
				"is the opposite mistake and just as costly: the chain would stop on the one " +
				"failure a second provider is most certain to survive",
		).toBe("quota");
	});

	it("case 3b — every QUOTA_PATTERN alternative is live, and each is the only one that matches its fixture", () => {
		// One fixture per alternative, so each can be killed individually; alternatives otherwise cover for each other.
		expect(
			QUOTA_ALTERNATIVE_FIXTURES.length,
			"the per-alternative table is empty or truncated, so alternatives can be deleted " +
				"from QUOTA_PATTERN with nothing red — which is how the pattern quietly stops " +
				"matching the failure it was widened for",
		).toBeGreaterThanOrEqual(7);

		for (const { alternative, text } of QUOTA_ALTERNATIVE_FIXTURES) {
			expect(
				classifyFailure(text),
				`the fixture written for the '${alternative}' alternative no longer classifies as ` +
					"quota, so that alternative has been removed or narrowed. Pi calls every quota " +
					"string non-retryable, so losing one collapses it into `fatal` and the chain " +
					"stops on the single failure a second provider is most certain to survive",
			).toBe("quota");

			// Minimality against the real pattern: removing this alternative from QUOTA_PATTERN.source must stop the
			// fixture matching, so an alternative absent from the table is still checked.
			const withoutThis = topLevelAlternatives(QUOTA_PATTERN.source)
				.filter((entry) => entry !== alternative)
				.join("|");
			expect(
				new RegExp(withoutThis, "i").test(text),
				`the fixture for '${alternative}' is ALSO matched by another alternative of ` +
					"QUOTA_PATTERN, so deleting this one would leave the row above green and the " +
					"alternative dead. Pick a string whose only quota wording is this alternative",
			).toBe(false);
		}
	});

	it("case 3c — WR-02: the fixture table and QUOTA_PATTERN's alternatives are the SAME set", () => {
		// The addition direction: every alternative in QUOTA_PATTERN needs a fixture, because a widened pattern forwards
		// prompts to another vendor (e.g. `|exceeded` would match a context-length error).
		const declared = topLevelAlternatives(QUOTA_PATTERN.source);

		expect(
			[...declared].sort(),
			"QUOTA_PATTERN's alternatives and QUOTA_ALTERNATIVE_FIXTURES have diverged. If an " +
				"alternative appears on the left and not on the right it was added to the pattern " +
				"with no minimal fixture, so it is unpinned in both directions and case 3b's " +
				"minimality verdict excludes it. If it appears on the right and not on the left it " +
				"was removed from the pattern and its fixture is now asserting a different " +
				"alternative's behaviour. Add or remove the fixture in the SAME commit as the " +
				"pattern edit [CR-03, WR-02]",
		).toEqual([...QUOTA_ALTERNATIVE_FIXTURES.map((entry) => entry.alternative)].sort());
	});

	it("case 3d — the alternation splitter case 3c depends on really splits", () => {
		// The splitter's contract, pinned on inputs independent of QUOTA_PATTERN, so the equality above cannot be met by
		// adjusting the splitter.
		expect(
			topLevelAlternatives("a|b|c"),
			"a flat alternation must split on every bar",
		).toEqual(["a", "b", "c"]);

		expect(
			topLevelAlternatives("a|b (?:x|y)|c"),
			"a bar INSIDE a group is not a top-level alternative: splitting there would invent " +
				"alternatives that do not exist and let a real one hide among them",
		).toEqual(["a", "b (?:x|y)", "c"]);

		expect(
			topLevelAlternatives("a[|]b|c"),
			"a bar inside a character class is a literal bar, not an alternation",
		).toEqual(["a[|]b", "c"]);

		expect(
			topLevelAlternatives(String.raw`a\|b|c`),
			"an ESCAPED bar is a literal bar. Treating it as a separator would silently halve " +
				"an alternative and case 3c would then demand a fixture for each half",
		).toEqual([String.raw`a\|b`, "c"]);

		expect(topLevelAlternatives("solo"), "a pattern with no bar is one alternative").toEqual([
			"solo",
		]);
	});

	it("case 4 — the chain does not call ahead when the first hop answers", () => {
		const walk = run("success");

		expect(
			walk.first,
			"the first provider was not attempted exactly once on a successful walk",
		).toBe(1);

		expect(
			walk.second,
			"the second provider was dialled even though the first one answered. That is an " +
				"unconditional broadcast to two vendors, not a fallback: every request would cost twice " +
				"and disclose twice [threat T-03-10-01]",
		).toBe(0);

		expect(
			JSON.stringify(walk.message.content),
			"a successful first hop did not return the first provider's own message",
		).toContain(FIRST_PROVIDER_REPLY);
	});

	it("case 5 — every hop went through the Phase 2 chokepoint and left its own row", () => {
		expect(
			fixture.turnsFileExisted,
			"no turns log exists at all, so the row assertions below would iterate an empty array and " +
				"pass while proving nothing. The chain is supposed to reach models through `callModel`, " +
				"which appends a row per call",
		).toBe(true);

		const quotaRows = fixture.turns.filter(
			(row) => row.kind === "nested" && row.role === "chain-quota",
		);

		expect(
			quotaRows.map((row) => row.provider),
			"the quota walk did not leave exactly one nested row per hop, in chain order. A hop that " +
				"reaches a model outside the chokepoint produces no row at all, which makes the fallback " +
				"invisible to every cost and latency figure this project decides on [threat T-03-10-07]",
		).toEqual([CHAIN[0]?.provider, CHAIN[1]?.provider]);

		expect(
			quotaRows[0]?.httpStatus,
			`the first hop's row does not carry the ${CLASS_STATUS.quota} the provider reported. ` +
				"Either the status wrapper is not installed — in which case every class is being " +
				"exercised against faux's hard-coded 200 — or the row was written by something other " +
				"than the call that failed",
		).toBe(CLASS_STATUS.quota);

		expect(
			quotaRows[1]?.httpStatus,
			"the second hop's row does not carry a 200, so the hop that actually answered is recorded " +
				"as something other than a success",
		).toBe(200);

		const successRows = fixture.turns.filter(
			(row) => row.kind === "nested" && row.role === "chain-success",
		);

		expect(
			successRows.length,
			"a walk whose first hop answered still wrote more than one nested row, so a call was made " +
				"that case 4's attempt counts did not see",
		).toBe(1);
	});

	it("case 6 — every CHAIN entry resolves in a registry composed from the shipped template", async () => {
		// The registry Pi would compose on a real machine (catalogue plus template), not the faux one: a renamed id would
		// otherwise skip the hop silently.
		await withModelsConfig({ models: MODELS_TEMPLATE }, ({ registry }) => {
			// Vacuity guard: the composed registry really holds both halves.
			expect(
				registry.getAll().length,
				"the composed registry holds no models at all, so 'this entry is missing' below would " +
					"be a statement about an empty registry rather than about the chain",
			).toBeGreaterThan(0);

			const missing = CHAIN.filter(
				(entry) => registry.find(entry.provider, entry.id) === undefined,
			).map((entry) => `${entry.provider}/${entry.id}`);

			expect(
				missing,
				"these chain entries do not exist in the registry Pi composes from the shipped template " +
					"plus its own catalogue. On a real machine `callWithFallback` throws on them by " +
					"design — the alternative, skipping the hop, would report a one-provider failure as a " +
					"chain failure — so this is a broken chain, not a broken test. Assumption A7 (the " +
					"second hop serves the same model id) is the thing that just expired",
			).toEqual([]);
		});
	});

	it("case 6a — a hop without configured auth is skipped and the first real failure surfaces", () => {
		const walk = fixture.authSkip;
		expect(walk, "the auth-skip walk was not recorded").toBeDefined();
		expect(walk?.second, "a hop with no configured auth must not be called").toBe(0);
		expect(walk?.first, "the first hop is the only one attempted").toBe(1);
		expect(
			walk?.message.errorMessage,
			"the surfaced error must be the first hop's own failure, not a later hop's auth error",
		).toContain(CLASS_FIXTURES.transient.text.slice(0, 30));
	});

	it("case 6a2 — a hop the capability guard refuses is never called and the first failure surfaces", () => {
		const walk = fixture.guardSkip;
		expect(walk, "the guard-skip walk was not recorded").toBeDefined();
		expect(walk?.second, "a guard-refused hop must not receive the prompt").toBe(0);
		expect(walk?.first).toBe(1);
		expect(walk?.message.errorMessage).toContain(CLASS_FIXTURES.transient.text.slice(0, 30));
	});

	it("case 6a3 — a guard that refuses every hop throws an error listing each hop's reason", () => {
		const thrown = fixture.guardAll.thrown;
		expect(thrown, "refusing every hop must throw").toBeDefined();
		for (const entry of CHAIN) expect(thrown).toContain(`${entry.provider}/${entry.id} (capability guard: refuses ${entry.id})`);
	});

	it("case 6b — an unresolved chain entry throws with the remedy, and is never skipped", () => {
		expect(
			fixture.unresolved.threw,
			"a chain whose entries resolve to nothing returned instead of throwing. That is the silent " +
				"skip Assumption A7 warns about: a renamed model id would turn a two-provider chain into " +
				"a one-provider chain that still reports itself as a chain, and the failure would read " +
				"as 'both vendors are down' [threat T-03-10-05]",
		).toBe(true);

		// The remedy, not just the fact.
		expect(
			fixture.unresolved.message,
			"the unresolved-entry error does not name the entry that failed, so nobody reading it " +
				"knows which hop is broken",
		).toContain(`${CHAIN[0]?.provider}/${CHAIN[0]?.id}`);

		expect(
			fixture.unresolved.message,
			"the unresolved-entry error does not point at the file holding CHAIN, so the remedy is " +
				"left to the reader at the exact moment they are least able to guess it",
		).toContain("schema.ts");
	});

	it("case 6c — a REJECTION is classified by the same rule, both directions", () => {
		// Only injection reaches this branch; the chokepoint rethrows facade rejections for this caller to decide.
		expect(
			fixture.rejectTransient.calls,
			"a transient-shaped REJECTION did not reach both hops. Either the try/catch is missing — " +
				"in which case the rejection escaped and no fallback happened at all — or a rejection is " +
				"being classified by a different rule than a returned failure, which is how the same " +
				"outage advances down one path and stops down the other",
		).toBe(2);

		expect(
			fixture.rejectFatal.calls,
			"a fatal-shaped REJECTION reached the second provider. A 400 from the facade is a 400 " +
				"everywhere, and this spent a second vendor on it",
		).toBe(1);

		expect(
			fixture.rejectFatal.thrown,
			"the fatal rejection did not come back out. Converting it into a synthetic message would " +
				"hand the caller a failure no provider produced and erase the stack that says where it " +
				"came from",
		).toContain("Invalid request from the facade");

		expect(
			fixture.rejectTransient.thrown,
			"the last hop's rejection did not come back out after the chain was exhausted",
		).toContain("fetch failed");
	});

	it("case 7 — Pi still returns the verdict every class fixture records", () => {
		// Pi's recorded verdicts on these strings; a Pi bump that moves one names the expired claim.
		for (const [name, fixtureEntry] of Object.entries(CLASS_FIXTURES)) {
			expect(
				isRetryableAssistantError(failure(fixtureEntry.text)),
				`Pi's own predicate no longer reports the '${name}' fixture as ` +
					`retryable=${String(fixtureEntry.retryableToday)}. The harness derives its ` +
					"retryable/fatal split from that predicate, so this string has just changed class " +
					"underneath the chain",
			).toBe(fixtureEntry.retryableToday);
		}

		// quota and fatal are both non-retryable to Pi yet take opposite chain actions.
		expect(
			isRetryableAssistantError(failure(CLASS_FIXTURES.quota.text)),
			"the quota fixture is retryable to Pi, so the quota table is no longer distinguishing " +
				"anything Pi's predicate does not already say and the ordering rule in classifyFailure " +
				"is untested",
		).toBe(isRetryableAssistantError(failure(CLASS_FIXTURES.fatal.text)));
	});

	it("case 8 — DashScope's own quota wording advances, and a dead credential does not", () => {
		// A floor on the table first: emptying it would drop the DashScope wording proof and leave the suite green.
		expect(
			DASHSCOPE_QUOTA_FIXTURES.length,
			"the DashScope quota table is the only reason QUOTA_PATTERN carries wording Pi's " +
				"limit table does not. Shrinking it removes coverage without turning anything " +
				"red, which is the one way a guard fails silently [WR-03]",
		).toBeGreaterThanOrEqual(2);

		expect(
			SSO_FIXTURES.length,
			"the credential table is the disclosure control below: an emptied one makes 'no " +
				"credential failure advances the chain' true of nothing [WR-03]",
		).toBeGreaterThanOrEqual(6);

		for (const quotaFixture of DASHSCOPE_QUOTA_FIXTURES) {
			expect(
				classifyFailure(quotaFixture.text),
				`DashScope's '${quotaFixture.text.slice(0, 32)}...' no longer classifies as quota. Pi's ` +
					"limit table does not carry this wording, so without the local table it falls through " +
					"to fatal and a chain that could have survived an arrears failure stops instead",
			).toBe("quota");
		}

		// An expired SSO credential is dead everywhere, so it must never forward the prompt to another vendor.
		for (const ssoFixture of SSO_FIXTURES) {
			expect(
				classifyFailure(ssoFixture.text),
				`the credential failure '${ssoFixture.text.slice(0, 40)}...' classifies as something ` +
					"other than fatal, so the chain would forward the user's whole prompt to a second " +
					"vendor because a credential expired. Nothing about a second vendor fixes an expired " +
					"AWS session",
			).toBe("fatal");
		}

		// An empty failure is fatal, not a reason to try another vendor.
		expect(
			classifyFailure(""),
			"an untextured failure classifies as advancing, so the chain would forward the prompt to a " +
				"second vendor on the strength of knowing nothing about why the first one failed",
		).toBe("fatal");
	});
});
