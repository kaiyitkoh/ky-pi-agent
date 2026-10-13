/**
 * The DashScope compat block asserted on bytes Pi's real openai-completions adapter sends to a `127.0.0.1` server, with
 * only `baseUrl` and `apiKey` overridden in the shipped template. A loopback URL matches no compat detection rule
 * (pi-ai dist/api/openai-completions.js detectCompat), so this is the DashScope path except for the URL. It proves what
 * Pi emits, not what DashScope accepts (runbook RB-03-01/RB-03-02). No request leaves 127.0.0.1.
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

/** Obviously synthetic; the loopback server never inspects it. */
const SYNTHETIC_API_KEY = "kypi-synthetic-fixture-key-not-a-credential";

/** Not a round number nor the template's cap, so `max_tokens` cannot match by coincidence. */
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
 * Each option gives a field under test a reason to appear: `reasoningEffort` for thinking, `maxTokens` for the cap,
 * and `cacheRetention: "long"` with `sessionId` so a missing `prompt_cache_*` is attributable to the compat field.
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
 * A replayed two-turn tool sequence. pi-ai's AssistantMessage has no `reasoning_content` field, so any such key on
 * the wire was put there by the adapter.
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

/** Parses the models template as bootstrap does: whole-line `//` comments only, so `https://` survives. */
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
 * Drives one completion through Pi's real adapter at a loopback server. `baseUrl` and `apiKey` are overridden here
 * only, so every assertion is about the template; `mutate` is for the controls.
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

			// Checked on the composed URL before any request, so an override that failed to land cannot dial a real host.
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

/** Every absence assertion is satisfied by an empty body, so each case first proves a body exists. */
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
	// One capture per fixture, shared by the cases.
	shipped = await captureOne("shipped template, one turn", ONE_TURN);

	// The paired positive for every absence: without the five suppressing compat fields the same request must emit them.
	detectionDefaults = await captureOne("detection defaults, one turn", ONE_TURN, (provider) => {
		const compat = provider.compat as Record<string, unknown>;
		delete compat.supportsStore;
		delete compat.supportsDeveloperRole;
		delete compat.maxTokensField;
		delete compat.supportsStrictMode;
		delete compat.supportsLongCacheRetention;
	});

	replay = await captureOne("shipped template, replayed two-turn", TWO_TURN);

	// Control 1: without the compat field the key must vanish.
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

	// Control 2: emission also needs `model.reasoning`, which defaults to false when omitted, so the compat field
	// alone is not sufficient.
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

		// Asserted here too, so the guard inside captureOne is visible if it ever stops running.
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
		// The block under test is the shipped template's, never a hand-written copy.
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

		// Presence first, in the same case, so no absence can pass against an empty body.

		// `thinkingFormat: "qwen"`: without it detection says "openai" and thinking is never enabled.
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

		// Top-level, not the nested `thinking: {type}` of Pi's deepseek branch.
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

		// `max_tokens`, not detection's default `max_completion_tokens`, which Alibaba does not list.
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

		// The messages and tools the absences are about really exist.
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

		// The default sends `store: false` rather than omitting it, so this checks key presence.
		expect(
			Object.hasOwn(body, "store"),
			"the body carries a `store` key. `store` is not in Alibaba's supported-parameter " +
				"list, and detection's default emits it as `false` rather than omitting it — so " +
				"`false` in the template is what removes the key.",
		).toBe(false);

		// Gated on `model.reasoning`, so it bites on exactly this template's models.
		expect(
			messages.map((message) => message.role),
			"a message rode with role `developer`. The role is unlisted by Alibaba and the " +
				"emission is gated on `model.reasoning`, which is true for every templated " +
				"model, so this is the default biting rather than an edge case.",
		).not.toContain("developer");

		for (const [index, tool] of tools.entries()) {
			expect(
				Object.hasOwn(tool.function ?? {}, "strict"),
				`tools[${index}].function carries a \`strict\` key. \`strict\` is unlisted by ` +
					"Alibaba, and PROV-10's entire failure mode is an unlisted field on the wire.",
			).toBe(false);
		}

		// The fixture asks for long retention with a sessionId, so the absence is the compat field's doing.
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

		// Only the five suppressing compat fields differ from case 2, so case 2 asserts the block, not the harness.
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

	it("case 4 — Q7: no function carries a `strict` key, and detection never turns it on", () => {
		const shippedBody = wireBody(shipped);
		const controlBody = wireBody(detectionDefaults);

		const shippedTools = wireTools(shippedBody);
		expect(
			shippedTools.length,
			"no tool was emitted at all, so the finding below is about an empty array",
		).toBeGreaterThan(0);

		// `strict` is sent only when a tool declares constrained sampling; turning it on is a tool-authoring change,
		// not a compat switch.
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
		// pi-ai 1.1.0 detection defaults `supportsStrictMode` to false, so `strict` is omitted here too; the template keeps
		// the explicit false so the wire does not depend on a default that already flipped once. Detection must never turn it on.
		for (const [index, tool] of controlTools.entries()) {
			expect(
				tool.function?.strict,
				`with \`supportsStrictMode\` left to detection, tools[${index}].function must not ` +
					"carry `strict: true`. pi-ai 1.1.0 omits the key (detection default false); " +
					"`true` would mean detection started opting DashScope into strict " +
					"JSON-schema tools: re-read `convertTools` before editing this case.",
			).not.toBe(true);
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

		// The message under test really carries the tool call.
		expect(
			Array.isArray(assistant?.tool_calls) && (assistant?.tool_calls as unknown[]).length,
			"the replayed assistant message reached the wire WITHOUT its tool_calls, so this " +
				"is not the second-turn shape PROV-10 is about",
		).toBe(1);

		// The key's presence is the claim (Pi inserts `""`); its absence is the second-turn HTTP 400.
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
		// Same body with one compat key removed, so a wrong-object read or a self-supplied key cannot stay green.
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
		// The compat key alone is not sufficient: dropping `reasoning: true` re-opens the 400 and disables thinking.
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

		// Forgetting `reasoning` also silently disables thinking.
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
