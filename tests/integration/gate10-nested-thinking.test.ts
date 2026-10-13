/**
 * GATE-10 (nested half) — the per-`model.api` outgoing-request proof for
 * `runSingleShotRole`, run and recorded RED against the pre-fix code before
 * any production change landed (see 08-01-SUMMARY.md's RED OUTPUT section).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PROVES
 * ---------------------------------------------------------------------------
 * `.pi/extensions/routing/modes.ts:409` built the outgoing `api` options bag
 * as `{ reasoningEffort: plan.reasoningEffort }` UNCONDITIONALLY — the
 * openai-completions shape — for every nested single-shot call, regardless of
 * which `model.api` the resolved candidate actually carries. `BedrockOptions`
 * (`node_modules/@earendil-works/pi-ai/dist/api/bedrock-converse-stream.d.ts:6-
 * 11`) has NO `reasoningEffort` field: a request built this way silently drops
 * the reviewer/advisor's declared `reasoningEffort: "high"` on the floor for
 * every Bedrock-routed candidate (reviewer/advisor in `balanced` and `max`;
 * vision in every mode).
 *
 * This file proves the defect DIRECTLY on the wire, per `model.api`, by
 * registering two faux providers under the two real api ids `ROLE_MAP`
 * actually resolves for `reviewer` (`cheap` -> openai-completions,
 * `max` -> bedrock-converse-stream) and capturing the OUTGOING options object
 * each provider's response factory was handed.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY CANDIDATE IS READ OUT OF `ROLE_MAP`, NEVER HARDCODED
 * ---------------------------------------------------------------------------
 * A literal provider/model id copied into a test silently stops tracking
 * `schema.ts` the moment the map changes, and the test keeps passing against a
 * candidate the router no longer resolves. Both candidates below come from
 * `ROLE_MAP.cheap.reviewer.candidates[0]` and `ROLE_MAP.max.reviewer.candidates[0]`.
 *
 * ---------------------------------------------------------------------------
 * WHY NO WIRE LOG OR DIAGNOSTICS EXTENSION
 * ---------------------------------------------------------------------------
 * The claim under test is "what left the harness as the outgoing `options`
 * bag", and a faux response FACTORY sees exactly that object as its second
 * argument — the same technique `tests/integration/single-shot-roles.test.ts`
 * uses for its own `seenEffortReviewer` oracle. No diagnostics extension, no
 * warm-up prompt and no turns/wire log read are needed to see it; this file
 * deliberately carries none of the three. `createCommandContext()` is
 * available immediately after `createAgentSession` returns — extension
 * loading happens at session construction, not at the first prompt
 * [VERIFIED: `tests/integration/mode-switch.test.ts`'s own header, citing
 * `dist/core/agent-session.d.ts:642` and `dist/core/extensions/runner.d.ts:132,144`].
 *
 * ---------------------------------------------------------------------------
 * WHY `reviewer` IN BOTH `cheap` AND `max`, NOT TWO DIFFERENT ROLES
 * ---------------------------------------------------------------------------
 * `ROLE_MAP.cheap.reviewer`'s first candidate is byte-identical to `CHAIN[0]`
 * in `.pi/extensions/providers/schema.ts` (`deepseek/deepseek-flash`), so
 * this run's openai-completions call is dispatched through the fallback-chain
 * wrapper rather than a direct chokepoint call — see `runSingleShotRole`'s own
 * `resolvedIsChainHead` check. That is deliberately exercised here rather than
 * avoided: the fallback wrapper forwards the caller's `api` bag UNCHANGED
 * (`providers/fallback.ts`'s own `callWithFallback` calls `callModel(ctx,
 * {...opts, model})`), so both dispatch paths this router can take are proven
 * by this one role, not just the simpler one. `ROLE_MAP.max.reviewer`'s
 * candidate (Bedrock Claude) has no hop in `CHAIN`, so that call takes the
 * direct chokepoint path.
 */
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getModeState, runSingleShotRole, setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";
import { ROLE_MAP } from "../../.pi/extensions/routing/schema.ts";
import { createFauxSession, type FauxSessionHandle } from "../helpers/session.ts";

/**
 * Poll `modelRuntime.hasConfiguredAuth(providerId)` until it reports `true`.
 * Copied from `tests/integration/single-shot-roles.test.ts`, itself copied
 * from `tests/integration/mode-switch.test.ts` — see that file's header for
 * the measured async gap this closes (a faux provider registered under a real
 * provider id still resolves `hasConfiguredAuth` false until the runtime's
 * cached availability snapshot catches up with `setRuntimeApiKey`).
 */
async function waitForConfiguredAuth(
	modelRuntime: FauxSessionHandle["modelRuntime"],
	providerId: string,
	timeoutMs = 2000,
): Promise<void> {
	const start = Date.now();
	while (!modelRuntime.hasConfiguredAuth(providerId)) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(
				`waitForConfiguredAuth: ${providerId} never reported configured auth within ${timeoutMs}ms ` +
					"after setRuntimeApiKey resolved. See tests/integration/mode-switch.test.ts's header for " +
					"the measured async gap.",
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

/** What one nested call's response factory saw as its outgoing `options`. */
interface Capture {
	api: string;
	options: Record<string, unknown> | undefined;
}

async function runFixture(): Promise<Capture[]> {
	// Deterministic starting state -- see modes.ts's own STATE-SLOT HAZARD
	// docstring; other test files in this worker share the process-wide slot.
	setMode("cheap");
	setEscalated(false);
	expect(getModeState().mode, "test setup did not reset the mode slot to cheap").toBe("cheap");
	expect(getModeState().escalated, "test setup did not clear escalation").toBe(false);

	const openAiCandidate = ROLE_MAP.cheap.reviewer.candidates[0];
	const bedrockCandidate = ROLE_MAP.max.reviewer.candidates[0];
	if (openAiCandidate === undefined || bedrockCandidate === undefined) {
		throw new Error(
			"vacuity guard -- ROLE_MAP.cheap.reviewer or ROLE_MAP.max.reviewer has no candidates; this " +
				"fixture cannot register a faux provider for either without one",
		);
	}

	const captures: Capture[] = [];

	const handle = await createFauxSession({});

	try {
		const openAiFaux = fauxProvider({
			provider: openAiCandidate.provider,
			api: "openai-completions",
			models: [
				{
					id: openAiCandidate.id,
					reasoning: true,
					input: ["text"],
					cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 },
				},
			],
		});
		openAiFaux.setResponses([
			(_context, options, _state, model) => {
				captures.push({ api: model.api, options: options as Record<string, unknown> | undefined });
				return fauxAssistantMessage("openai-reviewer-reply", { stopReason: "stop" });
			},
		]);

		const bedrockFaux = fauxProvider({
			provider: bedrockCandidate.provider,
			api: "bedrock-converse-stream",
			models: [
				{
					id: bedrockCandidate.id,
					reasoning: true,
					input: ["text", "image"],
					cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 },
				},
			],
		});
		bedrockFaux.setResponses([
			(_context, options, _state, model) => {
				captures.push({ api: model.api, options: options as Record<string, unknown> | undefined });
				return fauxAssistantMessage("bedrock-reviewer-reply", { stopReason: "stop" });
			},
		]);

		// registerNativeProvider replaces a built-in of the same provider id — the
		// mechanism `tests/helpers/session.ts`'s own docstring names and
		// `single-shot-roles.test.ts` relies on. Registered bare: this fixture
		// captures via the response FACTORY, not via `onPayload`, so
		// `wrapFauxWithPayload` buys nothing here.
		//
		// MEASURED, NOT ASSUMED: `registerNativeProvider` fires a fire-and-forget
		// UNSCOPED `refresh()` [pi model-runtime.js:546-553], which bumps EVERY
		// provider's internal availability sequence number, including one already
		// mid-flight. Registering BOTH providers back-to-back and only THEN
		// awaiting `setRuntimeApiKey` for each raced the two unscoped refreshes
		// against the targeted ones and left `deepseek` permanently unconfigured
		// (reproduced: still `false` after 4s of polling). Each provider's
		// register -> grant -> wait cycle is completed BEFORE the next provider is
		// registered, so no unscoped refresh from a LATER registration can
		// invalidate an EARLIER provider's already-settled auth state.
		handle.modelRuntime.registerNativeProvider(openAiFaux.provider);
		await handle.modelRuntime.setRuntimeApiKey(openAiCandidate.provider, "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, openAiCandidate.provider);

		handle.modelRuntime.registerNativeProvider(bedrockFaux.provider);
		await handle.modelRuntime.setRuntimeApiKey(bedrockCandidate.provider, "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, bedrockCandidate.provider);

		// The interleaved ordering above protects EACH provider from the OTHER's
		// registration, but not from itself: confirm deepseek is STILL configured
		// after bedrock's own register/grant/wait cycle completed, so a caller
		// reading this fixture can trust neither auth state degrades once won.
		expect(
			handle.modelRuntime.hasConfiguredAuth(openAiCandidate.provider),
			`${openAiCandidate.provider} lost its configured auth after ${bedrockCandidate.provider} was ` +
				"registered -- the interleaved register/grant/wait ordering no longer isolates the two providers",
		).toBe(true);

		const ctx = handle.session.extensionRunner.createCommandContext();

		// Identity guard (Phase 3's lesson, applied every time a faux provider
		// replaces a real provider id) -- the resolved candidate really is THIS
		// run's faux registration, not Pi's own real catalogue entry.
		const resolvedOpenAi = ctx.modelRegistry.find(openAiCandidate.provider, openAiCandidate.id);
		const resolvedBedrock = ctx.modelRegistry.find(bedrockCandidate.provider, bedrockCandidate.id);
		if (resolvedOpenAi?.api !== "openai-completions" || resolvedBedrock?.api !== "bedrock-converse-stream") {
			throw new Error(
				"identity guard failed -- the native registration did not replace the real catalogue entry " +
					`for ${openAiCandidate.provider}/${openAiCandidate.id} (resolved api ${resolvedOpenAi?.api}) or ` +
					`${bedrockCandidate.provider}/${bedrockCandidate.id} (resolved api ${resolvedBedrock?.api}); ` +
					"every capture below would measure the wrong provider",
			);
		}

		setMode("cheap");
		await runSingleShotRole(ctx, {
			role: "reviewer",
			messages: [{ role: "user", content: "please review this change", timestamp: Date.now() }],
			need: {},
		});

		setMode("max");
		await runSingleShotRole(ctx, {
			role: "reviewer",
			messages: [{ role: "user", content: "please review this change", timestamp: Date.now() }],
			need: {},
		});

		return captures;
	} finally {
		setMode("cheap");
		setEscalated(false);
		await handle.dispose();
	}
}

let captures: Capture[];

describe("GATE-10 (nested half) -- runSingleShotRole sends the api-appropriate thinking field", () => {
	// The faux Bedrock model is registered under its bare id, so the profile prefix is set to empty.
	let savedAgentDir: string | undefined;
	let prefixAgentDir = "";
	beforeAll(() => {
		savedAgentDir = process.env.PI_CODING_AGENT_DIR;
		prefixAgentDir = mkdtempSync(join(tmpdir(), "kypi-prefix-agent-"));
		writeFileSync(join(prefixAgentDir, "settings.json"), JSON.stringify({ kyPiAgent: { bedrockProfilePrefix: "" } }), "utf-8");
		process.env.PI_CODING_AGENT_DIR = prefixAgentDir;
	});
	afterAll(() => {
		if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
		rmSync(prefixAgentDir, { recursive: true, force: true });
	});
	beforeAll(async () => {
		captures = await runFixture();
	}, 60_000);

	it("captures exactly one openai-completions call and one bedrock-converse-stream call (vacuity guard)", () => {
		expect(
			captures.length,
			`expected exactly 2 captures (one per api id); got ${captures.length}: ` +
				`${JSON.stringify(captures.map((c) => c.api))}. A count of 0 means neither faux response ` +
				"factory ever ran, so nothing below would be measuring a real call.",
		).toBe(2);
	});

	it('openai-completions: options.reasoningEffort === "high" and options.reasoning is absent', () => {
		const capture = captures.find((c) => c.api === "openai-completions");
		expect(capture, 'no capture recorded for api "openai-completions"').toBeDefined();
		expect(
			capture?.options?.reasoningEffort,
			"the openai-completions nested call did not receive options.reasoningEffort " +
				'"high" -- reviewer declares reasoningEffort:"high" in every mode (routing/schema.ts)',
		).toBe("high");
		expect(
			capture?.options?.reasoning,
			"the openai-completions nested call received an options.reasoning field, which is the " +
				"bedrock-converse-stream shape -- this api has no such field and a real openai-completions " +
				"adapter would never see it",
		).toBeUndefined();
	});

	it('bedrock-converse-stream: options.reasoning === "high" and options.reasoningEffort is absent', () => {
		const capture = captures.find((c) => c.api === "bedrock-converse-stream");
		expect(capture, 'no capture recorded for api "bedrock-converse-stream"').toBeDefined();
		expect(
			capture?.options?.reasoning,
			'the bedrock-converse-stream nested call did not receive options.reasoning "high" -- ' +
				"BedrockOptions (node_modules/@earendil-works/pi-ai/dist/api/bedrock-converse-stream.d.ts:6-11) " +
				'names this field "reasoning", not "reasoningEffort", and reviewer declares ' +
				'reasoningEffort:"high" in every mode',
		).toBe("high");
		expect(
			capture?.options?.reasoningEffort,
			"the bedrock-converse-stream nested call received an options.reasoningEffort field -- " +
				"BedrockOptions has NO such field (verified against the .d.ts above), so the real adapter " +
				"silently ignores it and the reviewer's declared reasoning effort never reaches the model. " +
				"This is the defect .pi/extensions/routing/modes.ts:409 shipped: an unconditional " +
				"openai-completions-shaped { reasoningEffort } bag sent to every nested call regardless of " +
				"model.api.",
		).toBeUndefined();
	});
});
