/**
 * runSingleShotRole sends the options shape each model.api understands: Bedrock options have no reasoningEffort
 * (pi-ai dist/api/bedrock-converse-stream.d.ts), so a flat bag silently drops the reviewer's "high". The outgoing
 * options are captured by each faux provider's response factory. Candidates come from ROLE_MAP, never hardcoded;
 * cheap's reviewer is the fallback-chain head and max's is not, so both dispatch paths are exercised.
 */
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getModeState, runSingleShotRole, setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";
import { ROLE_MAP } from "../../.pi/extensions/routing/schema.ts";
import { createFauxSession, waitForConfiguredAuth } from "../helpers/session.ts";

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

		// Each provider completes register, grant and wait before the next is registered: registerNativeProvider's unscoped
		// refresh (pi model-runtime.js) otherwise races and leaves the first provider unconfigured.
		handle.modelRuntime.registerNativeProvider(openAiFaux.provider);
		await handle.modelRuntime.setRuntimeApiKey(openAiCandidate.provider, "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, openAiCandidate.provider);

		handle.modelRuntime.registerNativeProvider(bedrockFaux.provider);
		await handle.modelRuntime.setRuntimeApiKey(bedrockCandidate.provider, "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, bedrockCandidate.provider);

		// deepseek must still be configured after bedrock's own registration cycle.
		expect(
			handle.modelRuntime.hasConfiguredAuth(openAiCandidate.provider),
			`${openAiCandidate.provider} lost its configured auth after ${bedrockCandidate.provider} was ` +
				"registered -- the interleaved register/grant/wait ordering no longer isolates the two providers",
		).toBe(true);

		const ctx = handle.session.extensionRunner.createCommandContext();

		// The resolved candidate must be this run's faux registration, not Pi's catalogue entry.
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
		});

		setMode("max");
		await runSingleShotRole(ctx, {
			role: "reviewer",
			messages: [{ role: "user", content: "please review this change", timestamp: Date.now() }],
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
