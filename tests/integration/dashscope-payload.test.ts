/**
 * PROV-03 / PROV-10 — the DashScope compat block, asserted on the WIRE.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * Every other PROV-03 assertion in this repository stops one layer short.
 * `tests/unit/dashscope-compat.test.ts` proves what Pi COMPOSES from the shipped
 * template — a real answer to Trap T6, and still not a statement about bytes.
 * `tests/helpers/faux.ts` says at length why a `fauxProvider` payload cannot
 * close the gap: it is a fixture this repository wrote, so asserting on it
 * proves that our fixture builder agrees with our assertion.
 *
 * This file closes the gap. It stands `tests/helpers/loopback.ts`'s `node:http`
 * server on `127.0.0.1`, points the SHIPPED template's provider at it with only
 * `baseUrl` and `apiKey` overridden, and lets Pi's REAL `openai-completions`
 * adapter build, encode and send the request. Every assertion below runs against
 * bytes Pi produced.
 *
 * Why a loopback URL is evidence about DashScope: `detectCompat` keys entirely
 * on `model.provider` against a fixed provider-id list and on
 * `model.baseUrl.includes(...)` against a fixed host-substring list
 * [VERIFIED: pi-ai 0.84.1 `dist/api/openai-completions.js:1161-1221`]. Neither
 * `http://127.0.0.1:<port>/v1` nor a DashScope base URL matches any of them —
 * the standing canary in `tests/unit/dashscope-compat.test.ts` re-checks that
 * absence against the installed artifact on every run. So the emission path here
 * is byte-for-byte the DashScope path except for the URL string.
 *
 * IT PROVES WHAT PI EMITS. IT SAYS NOTHING ABOUT WHAT DASHSCOPE ACCEPTS.
 * A body captured perfectly here may still be rejected by the real gateway — a
 * spelling the gateway refuses, a model id absent from the caller's workspace, a
 * parameter its compatibility table does not list. Those are `RB-03-01` (an
 * ordinary DashScope turn returns 200 and the wire dump shows this same field
 * set) and `RB-03-02` (the SECOND turn of a tool-calling sequence returns 200
 * rather than the `reasoning_content` 400) in `docs/RUNBOOK.md`. Both are
 * **OUTSTANDING**, this file is the offline proxy `RB-03-02` names, and nothing
 * green here may be read as discharging either of them (Trap T12).
 *
 * ---------------------------------------------------------------------------
 * THE PROV-10 MECHANISM, STATED ONCE
 * ---------------------------------------------------------------------------
 * `convertMessages` inserts `reasoning_content: ""` on a replayed assistant
 * message when `compat.requiresReasoningContentOnAssistantMessages && model.reasoning`
 * and the key is not already set [pi-ai `openai-completions.ts:1223-1229`]. The
 * value `""` is correct and expected — Pi is the thing that puts it there. Its
 * ABSENCE is what returns HTTP 400 on the second turn of a tool sequence while
 * the first turn succeeds, which is why the failure reads as intermittent rather
 * than as a misconfiguration. Two controls below prove the assertion can fail.
 *
 * ---------------------------------------------------------------------------
 * NO REQUEST IN THIS FILE LEAVES 127.0.0.1
 * ---------------------------------------------------------------------------
 * `withLoopbackCompletions` refuses to hand out a non-loopback `baseUrl`
 * (Trap T11), and {@link captureOne} additionally runs `assertLoopbackUrl` over
 * the COMPOSED `model.baseUrl` — the string the adapter will actually dial —
 * BEFORE any completion is issued. A real provider host is never spelled in this
 * file, not even in a comment. [threat T-03-09-01]
 *
 * The API key written into the fixture is an obviously synthetic literal. No
 * credential exists on this machine to substitute for it and none is needed: the
 * loopback server never inspects the `Authorization` header.
 * [threat T-03-09-02]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssistantMessage, Context, Message, Tool } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { beforeAll, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { assertLoopbackUrl, withLoopbackCompletions } from "../helpers/loopback.ts";
import { withModelsConfig } from "../helpers/models.ts";

/** The template plan 03-02 shipped. The object under test is derived from it. */
const TEMPLATE = join(repoRoot(), ".pi", "templates", "models-template.json");

/** The provider and model the template defines. `requireModel` throws if renamed. */
const PROVIDER_ID = "dashscope";
const MODEL_ID = "deepseek-v4-flash";

/**
 * Obviously synthetic, and it never leaves the machine. Written as one literal
 * so a reader grepping this repository for a credential shape finds a string
 * that says what it is. [threat T-03-09-02]
 */
const SYNTHETIC_API_KEY = "kypi-synthetic-fixture-key-not-a-credential";

/**
 * Deliberately not a round number and not the template's own `maxTokens`: the
 * `max_tokens` assertion compares the emitted VALUE, so a body that echoed the
 * model's cap by some other route could not satisfy it by coincidence.
 */
const FIXTURE_MAX_TOKENS = 1234;

/** Set so `prompt_cache_key` has something to be clamped from — see PRESENCE 4. */
const FIXTURE_SESSION_ID = "kypi-fixture-session";

/** The one tool every capture declares. `strict` rides on tool entries or not at all. */
const FIXTURE_TOOL: Tool = {
	name: "read_file",
	description: "Read a file from disk. A fixture; nothing executes it.",
	parameters: Type.Object({ path: Type.String() }),
};

/**
 * The options every capture passes, chosen so each field under test has a reason
 * to appear:
 *   - `reasoningEffort` — `enable_thinking` is `!!options?.reasoningEffort` and
 *     `reasoning_effort` is emitted only when it is set [`:761-768`];
 *   - `maxTokens` — Pi emits a token cap ONLY when the caller sets this
 *     [`:715-721`], so without it the `max_tokens` assertion would be vacuous;
 *   - `cacheRetention: "long"` + `sessionId` — this is what makes the
 *     `prompt_cache_*` ABSENCE attributable to `supportsLongCacheRetention:
 *     false` rather than to nobody having asked for long retention [`:699-704`].
 *     Without them the absence assertion would hold with the compat field
 *     deleted, which is the definition of a test that proves nothing.
 */
const REQUEST_OPTIONS = {
	reasoningEffort: "high",
	maxTokens: FIXTURE_MAX_TOKENS,
	cacheRetention: "long",
	sessionId: FIXTURE_SESSION_ID,
} as const;

/** One user message. The ordinary-turn shape `RB-03-01` describes. */
const ONE_TURN: Message[] = [{ role: "user", content: "hello", timestamp: 1 }];

const TOOL_CALL_ID = "call_kypi_fixture_1";

/**
 * A replayed two-turn tool sequence, built by hand.
 *
 * The assistant entry carries a tool call and NOTHING resembling reasoning
 * content — pi-ai's `AssistantMessage` has no `reasoning_content` field at all
 * [pi-ai 0.84.1 `dist/types.d.ts:295-310`], so the fixture is structurally
 * incapable of supplying the key the PROV-10 case asserts. Whatever appears on
 * the wire was put there by the adapter. The two controls prove that claim
 * rather than resting on it. [threat T-03-09-05]
 */
const TWO_TURN: Message[] = [
	{ role: "user", content: "read package.json", timestamp: 1 },
	{
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: TOOL_CALL_ID,
				name: FIXTURE_TOOL.name,
				arguments: { path: "package.json" },
			},
		],
		api: "openai-completions",
		provider: PROVIDER_ID,
		model: MODEL_ID,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 2,
	} satisfies AssistantMessage,
	{
		role: "toolResult",
		toolCallId: TOOL_CALL_ID,
		toolName: FIXTURE_TOOL.name,
		content: [{ type: "text", text: '{"name":"fixture"}' }],
		isError: false,
		timestamp: 3,
	},
];

/**
 * Parse the models template the way `bin/bootstrap.sh` does: WHOLE-LINE `//`
 * only, which is what the template's own header promises. A naive strip of every
 * `//` would eat the `https://` inside a base URL.
 *
 * Duplicated from `tests/integration/templates-install.test.ts:178-185`
 * deliberately — that file deep-equals the INSTALLED provider block against its
 * own parse, so the two strips drifting apart fails there rather than silently
 * changing what this file believes the template says.
 */
function parseModelsTemplate(): Record<string, unknown> {
	return JSON.parse(
		readFileSync(TEMPLATE, "utf-8")
			.split("\n")
			.filter((line) => !/^\s*\/\//.test(line))
			.join("\n"),
	) as Record<string, unknown>;
}

/** The shipped provider block, as JSON. Read fresh per call; callers mutate. */
function templateProvider(): Record<string, unknown> {
	const providers = parseModelsTemplate().providers as Record<string, unknown> | undefined;
	const block = providers?.[PROVIDER_ID];
	if (block === undefined) {
		throw new Error(
			`${TEMPLATE} has no providers.${PROVIDER_ID} block, so there is nothing to test. ` +
				"Every capture in this file is derived from it; a renamed provider key must " +
				"fail here rather than produce an empty fixture that satisfies every absence " +
				"assertion below.",
		);
	}
	return block as Record<string, unknown>;
}

/** Loosely-typed views of the emitted body. Nothing here is retyped from Pi. */
interface WireMessage {
	role?: unknown;
	tool_calls?: unknown;
	reasoning_content?: unknown;
}
interface WireTool {
	function?: Record<string, unknown>;
}

/** What one capture produced, plus everything the vacuity guards need. */
interface Capture {
	/** Names the fixture in every failure message. */
	label: string;
	/** Every request the loopback server recorded. Exactly one is expected. */
	requestCount: number;
	/** The parsed request body, or `undefined` when nothing was captured. */
	body: Record<string, unknown> | undefined;
	/** `POST /v1/chat/completions`, recorded so a wrong route is visible. */
	method: string;
	url: string;
	/** The COMPOSED `model.baseUrl` — the string the adapter dialled. */
	resolvedBaseUrl: string;
	/** The provider block actually written to the temp `models.json`. */
	fixtureProvider: Record<string, unknown>;
	/** `"error"` here means the completion never really happened. */
	stopReason: string;
	errorMessage: string | undefined;
}

/**
 * Drive ONE completion through Pi's real adapter at a loopback server and hand
 * back what it emitted.
 *
 * `mutate` receives the shipped provider block and may change it; the controls
 * are the only callers that do. `baseUrl` and `apiKey` are overridden here and
 * nowhere else, which is what makes every assertion a statement about the
 * TEMPLATE rather than about a hand-written copy of it. [threat T-03-09-03]
 */
async function captureOne(
	label: string,
	messages: Message[],
	mutate?: (provider: Record<string, unknown>) => void,
): Promise<Capture> {
	return await withLoopbackCompletions({}, async (loop) => {
		const provider = templateProvider();
		provider.baseUrl = loop.baseUrl;
		provider.apiKey = SYNTHETIC_API_KEY;
		mutate?.(provider);

		const models = { providers: { [PROVIDER_ID]: provider } };

		return await withModelsConfig({ models }, async (handle) => {
			const model = handle.requireModel(PROVIDER_ID, MODEL_ID);

			// TRAP T11, and it runs BEFORE the request is issued. The helper already
			// refuses to hand out a non-loopback `baseUrl`; this checks the string
			// that survived composition, which is the one `buildParams` gives to the
			// OpenAI client. An override that failed to land would otherwise dial the
			// template's real host from CI. [threat T-03-09-01]
			assertLoopbackUrl(model.baseUrl);

			const context: Context = {
				systemPrompt: "You are a fixture. Nothing you say is read.",
				messages,
				tools: [FIXTURE_TOOL],
			};

			const message = await handle.registry.complete(model, context, REQUEST_OPTIONS);
			const first = loop.requests[0];

			return {
				label,
				requestCount: loop.requests.length,
				body: first?.body as Record<string, unknown> | undefined,
				method: first?.method ?? "",
				url: first?.url ?? "",
				resolvedBaseUrl: model.baseUrl,
				fixtureProvider: provider,
				stopReason: message.stopReason,
				errorMessage: message.errorMessage,
			};
		});
	});
}

/**
 * THE VACUITY GUARD, and it is the most important function in this file.
 *
 * Every absence assertion below — no `store`, no `developer` role, no `strict`,
 * no `prompt_cache_*`, no `reasoning_content` — is satisfied PERFECTLY by an
 * empty or missing body. So no case may touch a body it has not first proved
 * exists, and each case calls this as its first statement.
 * [threat T-03-09-04]
 */
function wireBody(capture: Capture): Record<string, unknown> {
	expect(
		capture.requestCount,
		`the loopback server recorded ${capture.requestCount} requests for the "${capture.label}" ` +
			"fixture; exactly 1 was expected. ZERO means Pi never dialled it — a setup failure " +
			"thrown out of `prepareRequest` is converted into an error MESSAGE rather than a " +
			"rejection (pi-ai `lazy.ts`, `lazyStream`), so the completion resolves and every " +
			"assertion in this case would pass over nothing. MORE than one means the adapter " +
			"retried, and the body being asserted is not the one the assertion is about.",
	).toBe(1);

	expect(
		capture.stopReason,
		`the "${capture.label}" completion finished with stopReason "error" ` +
			`(${capture.errorMessage ?? "no message"}). The captured body may be a request Pi ` +
			"abandoned rather than the one it meant to send.",
	).not.toBe("error");

	expect(
		capture.body,
		`the "${capture.label}" request arrived but its body did not parse as JSON, so it is ` +
			"recorded as `undefined` (see LoopbackRequest.body). Pi sent something that is not " +
			"a JSON document — that is the finding; do not soften the assertions below to " +
			"tolerate it.",
	).toBeDefined();

	return capture.body as Record<string, unknown>;
}

/** The `messages` array Pi emitted, as loose objects. */
function wireMessages(body: Record<string, unknown>): WireMessage[] {
	return (body.messages ?? []) as WireMessage[];
}

/** The `tools` array Pi emitted, as loose objects. */
function wireTools(body: Record<string, unknown>): WireTool[] {
	return (body.tools ?? []) as WireTool[];
}

let shipped: Capture;
let detectionDefaults: Capture;
let replay: Capture;
let replayWithoutCompatField: Capture;
let replayWithoutReasoning: Capture;

beforeAll(async () => {
	// One capture per fixture, taken once. Each is a full server + registry +
	// completion, and the cases are about different properties of the same bodies.
	shipped = await captureOne("shipped template, one turn", ONE_TURN);

	// THE PAIRED POSITIVE FOR EVERY ABSENCE ASSERTION IN THIS FILE, and the whole
	// reason the absences mean anything. Delete the five compat fields whose only
	// job is suppression and drive the identical request: if the shipped body's
	// missing `store` / `developer` / `strict` / `prompt_cache_*` were an artefact
	// of the loopback path, of the fixture context, or of an option nobody set,
	// they would be missing here too. They are not. [threat T-03-09-04]
	detectionDefaults = await captureOne("detection defaults, one turn", ONE_TURN, (provider) => {
		const compat = provider.compat as Record<string, unknown>;
		delete compat.supportsStore;
		delete compat.supportsDeveloperRole;
		delete compat.maxTokensField;
		delete compat.supportsStrictMode;
		delete compat.supportsLongCacheRetention;
	});

	replay = await captureOne("shipped template, replayed two-turn", TWO_TURN);

	// CONTROL 1 — without the compat field the key must vanish. Without this, an
	// assertion that read the wrong object, or a fixture that somehow carried the
	// key itself, would pass while proving nothing. [threat T-03-09-05]
	replayWithoutCompatField = await captureOne(
		"two-turn, requiresReasoningContentOnAssistantMessages removed",
		TWO_TURN,
		(provider) => {
			for (const model of provider.models as Record<string, unknown>[]) {
				delete (model.compat as Record<string, unknown>)
					.requiresReasoningContentOnAssistantMessages;
			}
		},
	);

	// CONTROL 2 — TRAP T5. The emission is `compat.requires… && model.reasoning`
	// [`:1223-1229`], and `modelFromJson` defaults `reasoning` to FALSE when the
	// key is omitted [pi `provider-composer.ts:156`]. So a template that forgets
	// `reasoning: true` re-opens the 400 with a perfectly correct compat block
	// sitting next to it doing nothing. Without this control, a reader could
	// believe the compat field alone is sufficient. [threat T-03-09-05]
	replayWithoutReasoning = await captureOne(
		"two-turn, reasoning:false on the model entry",
		TWO_TURN,
		(provider) => {
			for (const model of provider.models as Record<string, unknown>[]) {
				model.reasoning = false;
			}
		},
	);
});

describe("PROV-03 — the shipped compat block, on the wire", () => {
	it("case 0 — one request was captured, and it went to 127.0.0.1", () => {
		const body = wireBody(shipped);

		// The resolved base URL is asserted here as well as inside `captureOne`,
		// where it gates the request. This case is what makes the guard VISIBLE:
		// a silent guard that stopped running would take the whole file's egress
		// protection with it and nothing would report the loss.
		expect(
			new URL(shipped.resolvedBaseUrl).hostname,
			`the composed model dialled ${shipped.resolvedBaseUrl}. Every body in this file must ` +
				"come from a server on loopback; a real host here is a live provider request " +
				"issued from a test run. [threat T-03-09-01]",
		).toBe("127.0.0.1");

		expect(shipped.method, "the completions call must be a POST").toBe("POST");
		expect(
			shipped.url,
			"the adapter posted somewhere other than the completions route. The loopback " +
				"server accepts any path on purpose so this surfaces as a surprising url " +
				"rather than as a hang against a 404",
		).toBe("/v1/chat/completions");

		expect(
			body.model,
			"the emitted body names a different model from the templated id, so the compat " +
				"assertions below are about some other model's request",
		).toBe(MODEL_ID);
	});

	it("case 1 — the fixture is the SHIPPED template with only baseUrl and apiKey changed", () => {
		// A test that hand-wrote its own compat block would assert its own copy and
		// let the template drift away unasserted. This is the case that forbids it.
		// [threat T-03-09-03]
		const template = templateProvider();

		expect(
			shipped.fixtureProvider.compat,
			"the compat block written to the temp models.json is not the one the template " +
				"ships. Everything this file proves is a statement about the SHIPPED template; " +
				"a diverged fixture makes it a statement about itself.",
		).toEqual(template.compat);

		expect(
			(shipped.fixtureProvider.models as unknown[]).map((model) =>
				(model as Record<string, unknown>).compat,
			),
			"the per-model compat blocks in the fixture are not the template's. The PROV-10 " +
				"cases below read exactly this field.",
		).toEqual((template.models as unknown[]).map((model) => (model as Record<string, unknown>).compat));

		const changed = Object.keys(template)
			.concat(Object.keys(shipped.fixtureProvider))
			.filter((key, index, all) => all.indexOf(key) === index)
			.filter(
				(key) =>
					JSON.stringify(template[key]) !== JSON.stringify(shipped.fixtureProvider[key]),
			)
			.sort();

		expect(
			changed,
			"exactly two keys may differ between the shipped provider block and the fixture: " +
				"`baseUrl` (redirected to loopback) and `apiKey` (a synthetic literal). Anything " +
				"else means this file is testing something it edited into existence.",
		).toEqual(["apiKey", "baseUrl"]);
	});

	it("case 2 — presence AND absence, on the same captured body", () => {
		const body = wireBody(shipped);

		// PRESENCE FIRST, AND IN THE SAME CASE. Split across two cases, the absence
		// half could go green against an empty or truncated body while the presence
		// half went red somewhere else in the report — the exact pattern
		// `tests/integration/wire-capture.test.ts:276-288` records. Every absence
		// below is therefore preceded by a positive on this same object.
		// [threat T-03-09-04]

		// PRESENCE 1 — `thinkingFormat: "qwen"` [`:761-768`]. Without that one key
		// detection returns "openai", this branch never runs, and thinking is
		// silently never enabled at all.
		expect(
			Object.hasOwn(body, "enable_thinking"),
			"the body carries no top-level `enable_thinking`. That is what a missing or wrong " +
				"`thinkingFormat` looks like on the wire: detection's default is \"openai\", the " +
				"qwen branch never runs, and thinking is never enabled — invisible from the UI " +
				"and visible only here.",
		).toBe(true);
		expect(
			body.enable_thinking,
			"`enable_thinking` is emitted as `!!options.reasoningEffort`, and this fixture sets " +
				`reasoningEffort "${REQUEST_OPTIONS.reasoningEffort}". A \`false\` here means the ` +
				"option did not reach the adapter.",
		).toBe(true);

		// PRESENCE 2 — TOP-LEVEL, not nested. Pi's "deepseek" branch would emit a
		// nested `thinking: {type}` object instead [`:796-805`]; the value is the
		// model's own thinkingLevelMap entry for "high".
		expect(
			body.reasoning_effort,
			"`reasoning_effort` must be a TOP-LEVEL string. Absent means the qwen branch did " +
				"not run or `supportsReasoningEffort` was left to detection; nested inside a " +
				"`thinking` object means `thinkingFormat` is \"deepseek\" rather than \"qwen\".",
		).toBe("high");
		expect(
			Object.hasOwn(body, "thinking"),
			"the body carries a `thinking` object, which is the \"deepseek\" thinkingFormat " +
				"shape [`:796-805`]. The template ships \"qwen\" and this fixture asserts the " +
				"qwen shape; both present at once would mean two branches ran.",
		).toBe(false);

		// PRESENCE 3 — `maxTokensField: "max_tokens"` [`:715-721`]. Detection's
		// default is `max_completion_tokens`, which Alibaba's compatibility table
		// does not list.
		expect(
			body.max_tokens,
			"the token cap must ride as `max_tokens`. Pi emits a cap only when the caller sets " +
				`options.maxTokens, which this fixture does (${FIXTURE_MAX_TOKENS}) precisely so ` +
				"this assertion cannot be satisfied by silence.",
		).toBe(FIXTURE_MAX_TOKENS);
		expect(
			Object.hasOwn(body, "max_completion_tokens"),
			"the body carries `max_completion_tokens`, which is detection's generic default " +
				"and is absent from Alibaba's compatibility table. `maxTokensField` did not take " +
				"effect.",
		).toBe(false);

		// PRESENCE 4 — the messages and tools the absences are about actually
		// exist. Without these two, "no message has role developer" and "no tool
		// carries strict" are both satisfied by an empty array.
		const messages = wireMessages(body);
		expect(
			messages.length,
			"the emitted body carries no messages at all, so the `developer`-role absence " +
				"below would pass over an empty array",
		).toBeGreaterThan(0);
		expect(
			messages.map((message) => message.role),
			"the system prompt must ride as a `system` message. This is the PAIRED POSITIVE " +
				"for the `developer` absence: an emission that dropped the system prompt " +
				"entirely would satisfy that absence perfectly.",
		).toContain("system");

		const tools = wireTools(body);
		expect(
			tools.length,
			"the emitted body declares no tools, so the `strict` absence below would pass over " +
				"an empty array. This fixture declares one tool for exactly that reason.",
		).toBe(1);
		expect(
			tools[0]?.function?.name,
			"the emitted tool is not the fixture's, so the `strict` assertion is reading " +
				"something else",
		).toBe(FIXTURE_TOOL.name);

		// ABSENCE 1 — `supportsStore: false`. Note the default SENDS `store: false`
		// rather than omitting the key [`:711-713`], so this is a key-presence
		// assertion and not a value one.
		expect(
			Object.hasOwn(body, "store"),
			"the body carries a `store` key. `store` is not in Alibaba's supported-parameter " +
				"list, and detection's default emits it as `false` rather than omitting it — so " +
				"`false` in the template is what removes the key.",
		).toBe(false);

		// ABSENCE 2 — `supportsDeveloperRole: false`, gated on `model.reasoning`
		// [`:1083-1085`], i.e. it bites on exactly the models this template defines.
		expect(
			messages.map((message) => message.role),
			"a message rode with role `developer`. The role is unlisted by Alibaba and the " +
				"emission is gated on `model.reasoning`, which is true for every templated " +
				"model, so this is the default biting rather than an edge case.",
		).not.toContain("developer");

		// ABSENCE 3 — `supportsStrictMode: false` [`:1360-1369`]. See case 4 for
		// what detection's default would have emitted.
		for (const [index, tool] of tools.entries()) {
			expect(
				Object.hasOwn(tool.function ?? {}, "strict"),
				`tools[${index}].function carries a \`strict\` key. \`strict\` is unlisted by ` +
					"Alibaba, and PROV-10's entire failure mode is an unlisted field on the wire.",
			).toBe(false);
		}

		// ABSENCE 4 — `supportsLongCacheRetention: false` [`:699-704`]. This fixture
		// asks for `cacheRetention: "long"` AND supplies a `sessionId`, so the
		// absence is attributable to the compat field and to nothing else.
		expect(
			Object.hasOwn(body, "prompt_cache_key"),
			"the body carries `prompt_cache_key`. This fixture deliberately requests " +
				'cacheRetention "long" with a sessionId set, so the only thing suppressing it is ' +
				"`supportsLongCacheRetention: false`.",
		).toBe(false);
		expect(
			Object.hasOwn(body, "prompt_cache_retention"),
			"the body carries `prompt_cache_retention`, which detection's default sets to " +
				'"24h" on a long-retention turn. Neither parameter is in Alibaba\'s list.',
		).toBe(false);
	});

	it("case 3 — the detection-defaults control: the compat block is what removes them", () => {
		const body = wireBody(detectionDefaults);

		// EVERY ABSENCE IN CASE 2 IS FALSIFIED HERE. Same template, same context,
		// same options, same loopback server — only the five suppressing compat
		// fields are gone. If this body looked like case 2's, case 2 would be
		// asserting a property of the harness rather than of the shipped block.
		expect(
			Object.hasOwn(body, "store"),
			"with `supportsStore` left to detection, Pi should emit `store: false` " +
				"[`:711-713`]. It did not — so case 2's `store` absence is not evidence that " +
				"the template's `supportsStore: false` did anything.",
		).toBe(true);
		expect(body.store, "detection's default emits `store` as `false`, not `true`").toBe(false);

		expect(
			wireMessages(body).map((message) => message.role),
			"with `supportsDeveloperRole` left to detection, the system prompt should ride as " +
				"a `developer` message [`:1083-1085`]. It did not — so case 2's absence proves " +
				"nothing about the template.",
		).toContain("developer");

		expect(
			Object.hasOwn(body, "max_completion_tokens"),
			"with `maxTokensField` left to detection, the cap should ride as " +
				"`max_completion_tokens` [`:715-721`]. It did not, so case 2's `max_tokens` " +
				"assertion is not evidence that the template chose the field.",
		).toBe(true);
		expect(
			Object.hasOwn(body, "max_tokens"),
			"detection's default must NOT also emit `max_tokens`; both present would mean the " +
				"two assertions in case 2 cannot distinguish the settings",
		).toBe(false);

		expect(
			Object.hasOwn(body, "prompt_cache_key"),
			"with `supportsLongCacheRetention` left to detection and cacheRetention \"long\" " +
				"requested, `prompt_cache_key` should be emitted [`:699-704`]. It was not, so " +
				"case 2's absence may simply mean nobody asked for long retention.",
		).toBe(true);
		expect(
			body.prompt_cache_retention,
			'detection\'s default sets `prompt_cache_retention` to "24h" on a long-retention turn',
		).toBe("24h");
	});

	it("case 4 — Q7: no function carries a `strict` key, and detection's default would", () => {
		const shippedBody = wireBody(shipped);
		const controlBody = wireBody(detectionDefaults);

		const shippedTools = wireTools(shippedBody);
		expect(
			shippedTools.length,
			"no tool was emitted at all, so the finding below is about an empty array",
		).toBeGreaterThan(0);

		// THE FINDING, AS AN ASSERTION RATHER THAN A COMMENT (RESEARCH §Q7).
		// `convertTools` writes `...(compat.supportsStrictMode !== false && { strict: strict ?? false })`
		// [`:1360-1369`], and `strict` is `true` only when the TOOL declares
		// `constrainedSampling: { type: "json_schema", … }` [pi-ai
		// `constrained-sampling.ts:84-99`]. Generic detection sets
		// `supportsStrictMode` true, so today Pi already sends `"strict": false` on
		// every function to every provider that leaves the field alone — including
		// DeepSeek-direct. Turning strict ON is a tool-authoring change, not a
		// `compat` switch. Phase 3 RECORDS this and ships `supportsStrictMode: false`;
		// it runs no quality-gate experiment. Phase 8/10 starts from here.
		for (const [index, tool] of shippedTools.entries()) {
			expect(
				Object.keys(tool.function ?? {}).includes("strict"),
				`tools[${index}].function carries \`strict\`. The template ships ` +
					"`supportsStrictMode: false`, which removes the key entirely rather than " +
					"setting it to false.",
			).toBe(false);
		}

		const controlTools = wireTools(controlBody);
		expect(
			controlTools.length,
			"the control emitted no tools, so it cannot demonstrate what the default does",
		).toBe(shippedTools.length);
		for (const [index, tool] of controlTools.entries()) {
			expect(
				tool.function?.strict,
				`with \`supportsStrictMode\` left to detection, tools[${index}].function should ` +
					'carry `"strict": false` — the Q7 finding. If this is now absent or `true`, ' +
					"pi-ai's strict handling has changed and the finding Phase 8/10 inherits is " +
					"stale: re-read `convertTools` before editing this case.",
			).toBe(false);
		}
	});
});

describe("PROV-10 — reasoning_content on a replayed two-turn context", () => {
	it("case 5 — the replayed assistant message with tool_calls carries reasoning_content", () => {
		const body = wireBody(replay);
		const messages = wireMessages(body);

		expect(
			messages.length,
			"the two-turn body carries no messages, so the search below iterates nothing",
		).toBeGreaterThan(0);

		const assistant = messages.find((message) => message.role === "assistant");
		expect(
			assistant,
			"no assistant message survived conversion. `convertMessages` drops an assistant " +
				"entry with neither content nor tool_calls, so this fixture's tool call must be " +
				"reaching the wire for the assertion below to mean anything.",
		).toBeDefined();

		// The paired positive: the message this case is about really is the one
		// carrying the tool call. An assistant message with `reasoning_content` and
		// no `tool_calls` would be a different (and harmless) thing entirely.
		expect(
			Array.isArray(assistant?.tool_calls) && (assistant?.tool_calls as unknown[]).length,
			"the replayed assistant message reached the wire WITHOUT its tool_calls, so this " +
				"is not the second-turn shape PROV-10 is about",
		).toBe(1);

		// THE ASSERTION THIS HALF OF THE FILE EXISTS FOR. The KEY'S PRESENCE is the
		// claim; the value `""` is correct and expected, because Pi is what inserts
		// it [`:1223-1229`]. Its absence is the HTTP 400 on the second turn of every
		// tool sequence, while the first turn succeeds.
		expect(
			Object.hasOwn(assistant ?? {}, "reasoning_content"),
			"the replayed assistant message carrying tool_calls has NO `reasoning_content` " +
				"key. That is exactly the second-turn 400: the first turn of a tool sequence " +
				"succeeds and the second is rejected, which is why the failure reads as " +
				"intermittent rather than as a misconfiguration. Check " +
				"`requiresReasoningContentOnAssistantMessages` on the model entry AND " +
				"`reasoning: true` beside it — the emission is gated on both.",
		).toBe(true);
		expect(
			assistant?.reasoning_content,
			'Pi inserts the empty string. A non-empty value would mean something other than ' +
				"the adapter put this key here, which is what the two controls below rule out.",
		).toBe("");
	});

	it("case 6 — control: without the compat field, the key is gone", () => {
		// WHAT WOULD SILENTLY PASS WITHOUT THIS. A case 5 that read the wrong
		// object, matched on a key some other layer adds, or asserted against a
		// fixture that carried the key itself would be green forever. This is the
		// same body, same context, same adapter, with exactly one compat key
		// removed. [threat T-03-09-05]
		const body = wireBody(replayWithoutCompatField);
		const assistant = wireMessages(body).find((message) => message.role === "assistant");

		expect(
			assistant,
			"the control emitted no assistant message, so its absence assertion would pass " +
				"over nothing — the control would be the vacuous one",
		).toBeDefined();
		expect(
			Array.isArray(assistant?.tool_calls) && (assistant?.tool_calls as unknown[]).length,
			"the control's assistant message lost its tool_calls, so it is not the same shape " +
				"case 5 asserts on and the comparison is not like-for-like",
		).toBe(1);

		expect(
			Object.hasOwn(assistant ?? {}, "reasoning_content"),
			"`reasoning_content` is present even with " +
				"`requiresReasoningContentOnAssistantMessages` REMOVED. Something other than " +
				"that compat field is putting the key on the wire, so case 5 is not evidence " +
				"about the template's compat block at all.",
		).toBe(false);
	});

	it("case 7 — control (Trap T5): with reasoning:false the key is gone even with the compat field set", () => {
		// WHAT WOULD SILENTLY PASS WITHOUT THIS. A reader could conclude that
		// `requiresReasoningContentOnAssistantMessages` alone is sufficient. It is
		// not: the emission is `compat.requires… && model.reasoning` [`:1223-1229`],
		// and `modelFromJson` defaults `reasoning` to FALSE when the key is omitted
		// [pi `provider-composer.ts:156`]. So a template that drops `reasoning: true`
		// disables thinking AND re-opens the 400, together, with a perfectly correct
		// compat block sitting beside it doing nothing.
		const body = wireBody(replayWithoutReasoning);
		const assistant = wireMessages(body).find((message) => message.role === "assistant");

		expect(assistant, "the control emitted no assistant message").toBeDefined();
		expect(
			Array.isArray(assistant?.tool_calls) && (assistant?.tool_calls as unknown[]).length,
			"the control's assistant message lost its tool_calls, so the comparison with case " +
				"5 is not like-for-like",
		).toBe(1);

		expect(
			Object.hasOwn(assistant ?? {}, "reasoning_content"),
			"`reasoning_content` survived `reasoning: false`, which contradicts the " +
				"`&& model.reasoning` gate at `:1225`. Either pi-ai changed or this control is " +
				"not driving the model it thinks it is.",
		).toBe(false);

		// The second half of Trap T5, on the same body: forgetting `reasoning` does
		// not only re-open the 400, it silently disables thinking. Both failures
		// arrive together and neither is visible from the UI.
		expect(
			Object.hasOwn(body, "enable_thinking"),
			"`enable_thinking` survived `reasoning: false`. Every thinkingFormat branch is " +
				"`compat.thinkingFormat === X && model.reasoning` [`:748`, `:761`], so this " +
				"should have vanished with the reasoning flag.",
		).toBe(false);
		expect(
			Object.hasOwn(body, "reasoning_effort"),
			"`reasoning_effort` survived `reasoning: false`, which is the other half of the " +
				"same gate",
		).toBe(false);
	});
});
