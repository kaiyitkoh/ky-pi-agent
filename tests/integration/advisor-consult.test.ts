/**
 * GATE-09 — the advisor consult reaches a DIFFERENT, stronger model, leaves
 * the session alone, refuses for free, and is accounted for.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PROVES, AND WHY IT DOUBLES AS A SECOND GATE-10 PROOF
 * ---------------------------------------------------------------------------
 * `executeConsultAdvisor` (`.pi/extensions/quality/advisor.ts`, plan 08-08)
 * calls `runSingleShotRole(ctx, {role:"advisor", ...})` and nothing else.
 * This file drives it directly — no tool registration exists yet (that is
 * plan 08-11) — against a real `createFauxSession()`, and captures what left
 * the harness on the OUTGOING request via the faux response FACTORY, exactly
 * the technique `tests/integration/gate10-nested-thinking.test.ts` uses for
 * the same reason: the claim under test is what the harness actually sent,
 * not what a helper's return value says it sent.
 *
 * `advisor` resolves to a different candidate per mode
 * (`.pi/extensions/routing/schema.ts`'s `ROLE_MAP`): `PRO_CANDIDATES`
 * (deepseek-direct, openai-completions api) in `cheap`, `VISION_CANDIDATES`
 * (Bedrock Claude, bedrock-converse-stream api) in `balanced`/`max`. Driving
 * ONE consult in each of `cheap` and `max` therefore proves plan 08-01's
 * per-`model.api` fix (case 4) a SECOND time, through this file's own
 * independent caller, and simultaneously proves the consult reaches a model
 * genuinely distinct from what the `executor` role resolves to in the same
 * mode (case 1) — `ROLE_MAP.cheap.executor` is the flash tier (a different
 * id, same provider) and `ROLE_MAP.max.executor` is the pro tier on
 * `deepseek` while `ROLE_MAP.max.advisor` is Bedrock Claude (a genuinely
 * different PROVIDER) — the 05-11 discipline: a nested row naming the right
 * model proves nothing if the advisor's model could never differ from the
 * session executor's.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SESSION'S OWN MODEL IS THE DEFAULT FAUX, NOT A ROLE_MAP CANDIDATE
 * ---------------------------------------------------------------------------
 * `createFauxSession({})`'s default model (`faux-flash` under the default
 * faux provider id) is what `ctx.model` reports for the whole fixture. It is
 * deliberately UNRELATED to either candidate registered below: case 2's
 * "no session mutation" claim is strongest when the session's own model
 * could never be confused with either the executor's or the advisor's
 * `ROLE_MAP` candidate, which a session literally running on the executor's
 * resolved model would risk.
 *
 * ---------------------------------------------------------------------------
 * REGISTRATION ORDER — INTERLEAVED, NEVER BATCHED
 * ---------------------------------------------------------------------------
 * `08-01-SUMMARY.md` and `gate10-nested-thinking.test.ts` both measured (not
 * assumed) that `ModelRuntime#registerNativeProvider` fires a fire-and-forget
 * UNSCOPED `refresh()` that bumps every provider's availability sequence
 * number, including one already mid-flight — registering two faux providers
 * back-to-back before authing either raced the two unscoped refreshes and
 * left the first permanently unconfigured. Every registration below completes
 * its own register → grant → wait cycle before the next one starts.
 */
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { executeConsultAdvisor } from "../../.pi/extensions/quality/advisor.ts";
import { peekQualityCost, takeQualityCost } from "../../.pi/extensions/diagnostics/quality-cost.ts";
import { logPath } from "../../.pi/extensions/diagnostics/jsonl.ts";
import { TURNS_LOG_BASE, type RowKind } from "../../.pi/extensions/diagnostics/schema.ts";
import { getModeState, setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";
import { ROLE_MAP } from "../../.pi/extensions/routing/schema.ts";
import { readTornSafe } from "../helpers/logs.ts";
import { createFauxSession, type FauxSessionHandle, waitForConfiguredAuth } from "../helpers/session.ts";
import { existsSync } from "node:fs";

/** A turns row as this file reads it back off disk. */
interface TurnsRow {
	kind?: RowKind;
	role?: string;
}

/** Read a log that may not exist yet — absence is a finding, not an exception. */
function readTurns(cwd: string): TurnsRow[] {
	const file = logPath(cwd, TURNS_LOG_BASE);
	if (!existsSync(file)) {
		return [];
	}
	const { records, unparseable } = readTornSafe(file);
	if (unparseable.length > 0) {
		throw new Error(`${file} holds ${unparseable.length} unparseable line(s): ${unparseable[0]}`);
	}
	return records as TurnsRow[];
}

/** One nested call's captured outgoing request, from the response factory's own arguments. */
interface Capture {
	modelId: string;
	api: string;
	options: Record<string, unknown> | undefined;
}

/** What the main fixture (cases 1/2/3/4/6-positive) produced. */
interface MainRun {
	cheapAdvisorCalls: Capture[];
	maxAdvisorCalls: Capture[];
	modelBefore: { provider: string | undefined; id: string | undefined };
	modelAfter: { provider: string | undefined; id: string | undefined };
	modelChangeCountBefore: number;
	modelChangeCountAfter: number;
	turnsBefore: TurnsRow[];
	turnsAfterCheap: TurnsRow[];
	turnsAfterMax: TurnsRow[];
	qualityCostAfterCheap: ReturnType<typeof peekQualityCost>;
}

/** A `model_change` entry, matched structurally — no type import needed for a count. */
function countModelChangeEntries(branch: readonly unknown[]): number {
	return branch.filter(
		(entry) => typeof entry === "object" && entry !== null && (entry as { type?: unknown }).type === "model_change",
	).length;
}

async function runMainFixture(): Promise<MainRun> {
	// Deterministic starting state — STATE-SLOT HAZARD, modes.ts's own docstring;
	// other test files in this worker share the process-wide slot.
	setMode("cheap");
	setEscalated(false);
	expect(getModeState().mode, "test setup did not reset the mode slot to cheap").toBe("cheap");
	expect(getModeState().escalated, "test setup did not clear escalation").toBe(false);

	// Drained first — quality-cost.ts's own globalThis slot is process-wide too;
	// a value left over from an unrelated prior test must not leak into case 6.
	takeQualityCost();

	const cheapAdvisor = ROLE_MAP.cheap.advisor.candidates[0];
	const cheapExecutor = ROLE_MAP.cheap.executor.candidates[0];
	const maxAdvisor = ROLE_MAP.max.advisor.candidates[0];
	const maxExecutor = ROLE_MAP.max.executor.candidates[0];
	if (cheapAdvisor === undefined || cheapExecutor === undefined || maxAdvisor === undefined || maxExecutor === undefined) {
		throw new Error(
			"vacuity guard — one of ROLE_MAP.cheap.advisor/executor or ROLE_MAP.max.advisor/executor has no " +
				"candidates; this fixture cannot register a faux provider for either without one",
		);
	}
	// The 05-11 discipline: a nested row naming the right model proves nothing
	// if the advisor's candidate could never differ from the executor's in the
	// SAME mode. `max` is the genuinely cross-provider case.
	expect(
		maxAdvisor.provider === maxExecutor.provider && maxAdvisor.id === maxExecutor.id,
		`ROLE_MAP.max.advisor (${maxAdvisor.provider}/${maxAdvisor.id}) resolves to the SAME candidate as ` +
			`ROLE_MAP.max.executor (${maxExecutor.provider}/${maxExecutor.id}) — this fixture's cross-role proof ` +
			"would be vacuous",
	).toBe(false);

	const cheapAdvisorCalls: Capture[] = [];
	const maxAdvisorCalls: Capture[] = [];

	const handle = await createFauxSession({});

	try {
		// One faux provider under `deepseek`, carrying BOTH the cheap-mode
		// executor's id and the cheap-mode advisor's id — proves a call
		// genuinely reaches the ADVISOR's id, not merely "some deepseek model".
		const deepseekFaux = fauxProvider({
			provider: cheapAdvisor.provider,
			api: "openai-completions",
			models: [
				{ id: cheapExecutor.id, reasoning: true, input: ["text"], cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } },
				{ id: cheapAdvisor.id, reasoning: true, input: ["text"], cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } },
			],
		});
		deepseekFaux.setResponses([
			(_context, options, _state, model) => {
				cheapAdvisorCalls.push({ modelId: model.id, api: model.api, options: options as Record<string, unknown> | undefined });
				return fauxAssistantMessage("cheap-advisor-reply", { stopReason: "stop" });
			},
		]);

		const bedrockFaux = fauxProvider({
			provider: maxAdvisor.provider,
			api: "bedrock-converse-stream",
			models: [{ id: maxAdvisor.id, reasoning: true, input: ["text", "image"], cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } }],
		});
		bedrockFaux.setResponses([
			(_context, options, _state, model) => {
				maxAdvisorCalls.push({ modelId: model.id, api: model.api, options: options as Record<string, unknown> | undefined });
				return fauxAssistantMessage("max-advisor-reply", { stopReason: "stop" });
			},
		]);

		// Interleaved register → grant → wait, per this file's own REGISTRATION
		// ORDER note above.
		handle.modelRuntime.registerNativeProvider(deepseekFaux.provider);
		await handle.modelRuntime.setRuntimeApiKey(cheapAdvisor.provider, "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, cheapAdvisor.provider);

		handle.modelRuntime.registerNativeProvider(bedrockFaux.provider);
		await handle.modelRuntime.setRuntimeApiKey(maxAdvisor.provider, "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, maxAdvisor.provider);

		expect(
			handle.modelRuntime.hasConfiguredAuth(cheapAdvisor.provider),
			`${cheapAdvisor.provider} lost its configured auth after ${maxAdvisor.provider} was registered`,
		).toBe(true);

		const ctx = handle.session.extensionRunner.createCommandContext();

		// Identity guard (Phase 3's lesson) — the resolved candidates really are
		// THIS run's faux registrations, not Pi's own real catalogue entries.
		const resolvedCheapAdvisor = ctx.modelRegistry.find(cheapAdvisor.provider, cheapAdvisor.id);
		const resolvedMaxAdvisor = ctx.modelRegistry.find(maxAdvisor.provider, maxAdvisor.id);
		if (resolvedCheapAdvisor?.api !== "openai-completions" || resolvedMaxAdvisor?.api !== "bedrock-converse-stream") {
			throw new Error(
				"identity guard failed — the native registration did not replace the real catalogue entry for " +
					`${cheapAdvisor.provider}/${cheapAdvisor.id} (resolved api ${resolvedCheapAdvisor?.api}) or ` +
					`${maxAdvisor.provider}/${maxAdvisor.id} (resolved api ${resolvedMaxAdvisor?.api}); every ` +
					"capture below would measure the wrong provider",
			);
		}

		const modelBefore = { provider: ctx.model?.provider, id: ctx.model?.id };
		const branchBefore = handle.session.sessionManager.getBranch();
		const modelChangeCountBefore = countModelChangeEntries(branchBefore);
		const turnsBefore = readTurns(handle.cwd);

		setMode("cheap");
		await executeConsultAdvisor(ctx, {
			question: "Should this cache key include the tenant id?",
			context: "The cache is keyed on resource id alone today; two tenants can share a resource id.",
		});
		const turnsAfterCheap = readTurns(handle.cwd);
		const qualityCostAfterCheap = peekQualityCost();

		setMode("max");
		await executeConsultAdvisor(ctx, {
			question: "Should this retry use exponential or fixed backoff?",
			context: "The call is idempotent and rate-limited at 5 rps.",
		});
		const turnsAfterMax = readTurns(handle.cwd);

		const modelAfter = { provider: ctx.model?.provider, id: ctx.model?.id };
		const branchAfter = handle.session.sessionManager.getBranch();
		const modelChangeCountAfter = countModelChangeEntries(branchAfter);

		return {
			cheapAdvisorCalls,
			maxAdvisorCalls,
			modelBefore,
			modelAfter,
			modelChangeCountBefore,
			modelChangeCountAfter,
			turnsBefore,
			turnsAfterCheap,
			turnsAfterMax,
			qualityCostAfterCheap,
		};
	} finally {
		setMode("cheap");
		setEscalated(false);
		await handle.dispose();
	}
}

/** What the refusal fixture (case 5, and case 6's negative control) produced. */
interface RefusalRun {
	threw: boolean;
	message: string;
	callCount: number;
	qualityCostAfter: ReturnType<typeof peekQualityCost>;
}

async function runRefusalFixture(): Promise<RefusalRun> {
	setMode("cheap");
	setEscalated(false);

	// Drained first, for the same reason the main fixture drains it.
	takeQualityCost();

	const cheapAdvisor = ROLE_MAP.cheap.advisor.candidates[0];
	if (cheapAdvisor === undefined) {
		throw new Error("vacuity guard — ROLE_MAP.cheap.advisor has no candidates");
	}

	const handle = await createFauxSession({});
	try {
		let callCount = 0;
		const deepseekFaux = fauxProvider({
			provider: cheapAdvisor.provider,
			api: "openai-completions",
			models: [{ id: cheapAdvisor.id, reasoning: true, input: ["text"], cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } }],
		});
		deepseekFaux.setResponses([
			() => {
				callCount += 1;
				return fauxAssistantMessage("should-never-be-called", { stopReason: "stop" });
			},
		]);

		// Registered, but DELIBERATELY never granted a runtime API key — this
		// candidate resolves and then fails `hasConfiguredAuth`, which is what
		// "no configured candidate" actually looks like for
		// `pickConfiguredCandidate`'s ordering rule. `dashscope` (the second
		// candidate in PRO_CANDIDATES) is never registered at all here, so it
		// fails the OTHER way ("did not resolve") — the refusal reason should
		// name both.
		handle.modelRuntime.registerNativeProvider(deepseekFaux.provider);

		const ctx = handle.session.extensionRunner.createCommandContext();

		let threw = false;
		let message = "";
		try {
			await executeConsultAdvisor(ctx, { question: "q", context: "c" });
		} catch (error) {
			threw = true;
			message = error instanceof Error ? error.message : String(error);
		}

		return { threw, message, callCount, qualityCostAfter: peekQualityCost() };
	} finally {
		setMode("cheap");
		setEscalated(false);
		await handle.dispose();
	}
}

let main: MainRun;
let refusal: RefusalRun;

describe("GATE-09 — the advisor consult through executeConsultAdvisor", () => {
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
		main = await runMainFixture();
		refusal = await runRefusalFixture();
	}, 60_000);

	it("case 1 — the consult reaches a DIFFERENT model than the session's own, and specifically the ADVISOR's resolved candidate", () => {
		expect(main.cheapAdvisorCalls.length, "no call captured for the cheap-mode consult — nothing to assert on").toBeGreaterThan(0);
		expect(main.maxAdvisorCalls.length, "no call captured for the max-mode consult — nothing to assert on").toBeGreaterThan(0);

		const cheapAdvisorId = ROLE_MAP.cheap.advisor.candidates[0]?.id;
		const maxAdvisorId = ROLE_MAP.max.advisor.candidates[0]?.id;
		expect(
			main.cheapAdvisorCalls[0]?.modelId,
			"the cheap-mode consult did not reach ROLE_MAP.cheap.advisor's own resolved model id",
		).toBe(cheapAdvisorId);
		expect(
			main.maxAdvisorCalls[0]?.modelId,
			"the max-mode consult did not reach ROLE_MAP.max.advisor's own resolved model id — it may have " +
				"reached the executor's candidate instead, which is exactly the failure this case exists to catch",
		).toBe(maxAdvisorId);

		// The session's own model (a faux default, unrelated to either candidate)
		// stayed untouched — case 2 asserts this properly; here it is only used
		// to confirm the advisor's resolved id is genuinely a DIFFERENT model
		// than the session's own.
		expect(main.modelBefore.provider, "the session had no active model to compare against").toBeDefined();
		expect(
			main.cheapAdvisorCalls[0]?.modelId,
			"the advisor's resolved model id is byte-identical to the session's own active model id — the " +
				"consult would not be reaching a genuinely different model",
		).not.toBe(main.modelBefore.id);
	});

	it("case 2 — no session mutation: the session's active model is unchanged and no model_change entry resulted (a delta of zero, not an absolute)", () => {
		expect(main.modelBefore.provider).toBeDefined();
		expect(main.modelBefore.id).toBeDefined();

		expect(
			main.modelAfter.provider,
			`the session's active provider changed from ${main.modelBefore.provider} to ${main.modelAfter.provider} ` +
				"as a result of executeConsultAdvisor — it must never mutate the session's own model",
		).toBe(main.modelBefore.provider);
		expect(main.modelAfter.id).toBe(main.modelBefore.id);

		// NOT asserted at zero absolute — session construction itself writes one
		// model_change entry (measured in single-shot-roles.test.ts's case 3);
		// the honest claim is a DELTA of zero across both calls.
		expect(
			main.modelChangeCountAfter - main.modelChangeCountBefore,
			"a model_change session entry was written as a result of executeConsultAdvisor",
		).toBe(0);
	});

	it('case 3 — exactly one kind:"nested" row with role:"advisor" is written per consult', () => {
		expect(main.turnsBefore.length, "the turns log already had rows before either consult ran").toBe(0);

		const afterCheap = main.turnsAfterCheap.filter((row) => row.kind === "nested" && row.role === "advisor");
		expect(
			afterCheap.length,
			`expected exactly one kind:"nested" role:"advisor" row after the cheap-mode consult; found ` +
				`${JSON.stringify(main.turnsAfterCheap.map((r) => ({ kind: r.kind, role: r.role })))}`,
		).toBe(1);

		const afterMax = main.turnsAfterMax.filter((row) => row.kind === "nested" && row.role === "advisor");
		expect(
			afterMax.length,
			`expected exactly two kind:"nested" role:"advisor" rows after both consults; found ` +
				`${JSON.stringify(main.turnsAfterMax.map((r) => ({ kind: r.kind, role: r.role })))}`,
		).toBe(2);
	});

	it("case 4 — the outgoing options carry the api-appropriate thinking field for the advisor's resolved model.api", () => {
		const cheapCall = main.cheapAdvisorCalls[0];
		expect(cheapCall?.api, "the cheap-mode capture does not carry the expected api id").toBe("openai-completions");
		expect(
			cheapCall?.options?.reasoningEffort,
			"the openai-completions advisor consult did not receive options.reasoningEffort \"high\" — advisor " +
				"declares reasoningEffort:\"high\" in every mode (routing/schema.ts)",
		).toBe("high");
		expect(
			cheapCall?.options?.reasoning,
			"the openai-completions advisor consult received an options.reasoning field, the " +
				"bedrock-converse-stream shape — this api has no such field",
		).toBeUndefined();

		const maxCall = main.maxAdvisorCalls[0];
		expect(maxCall?.api, "the max-mode capture does not carry the expected api id").toBe("bedrock-converse-stream");
		expect(
			maxCall?.options?.reasoning,
			"the bedrock-converse-stream advisor consult did not receive options.reasoning \"high\" — " +
				"BedrockOptions names this field \"reasoning\", not \"reasoningEffort\" " +
				"(node_modules/@earendil-works/pi-ai/dist/api/bedrock-converse-stream.d.ts:6-11)",
		).toBe("high");
		expect(
			maxCall?.options?.reasoningEffort,
			"the bedrock-converse-stream advisor consult received an options.reasoningEffort field — " +
				"BedrockOptions has no such field, and a real adapter silently ignores it (the plan 08-01 defect, " +
				"exercised here by a second, independent caller)",
		).toBeUndefined();
	});

	it("case 5 — a refusal (no configured auth for every advisor candidate) throws and costs zero provider calls", () => {
		expect(
			refusal.threw,
			"executeConsultAdvisor did not throw even though no advisor candidate carries configured auth",
		).toBe(true);
		expect(
			refusal.message,
			"the thrown error does not carry the routing refusal's own reason",
		).toContain("no configured candidate");
		expect(
			refusal.callCount,
			"the registered-but-unauthed faux provider was called despite carrying no configured auth — a " +
				"refusal that still issues a request is not a refusal",
		).toBe(0);
	});

	it("case 6 — cost attribution: a successful consult increases qualityMs, paired with the negative control that a refused consult adds none", () => {
		expect(
			main.qualityCostAfterCheap,
			"peekQualityCost() reported nothing after a successful consult — addQualityCost was never called, " +
				"or was called with a value that failed to persist",
		).toBeDefined();
		expect(main.qualityCostAfterCheap?.qualityMs, "qualityMs was not a positive number after a real consult").toBeGreaterThan(0);
		expect(main.qualityCostAfterCheap?.qualityTokens, "qualityTokens was not defined after a real consult").toBeDefined();

		// THE NEGATIVE CONTROL: nothing was spent, so nothing should be charged.
		expect(
			refusal.qualityCostAfter,
			"peekQualityCost() reported a cost after a REFUSED consult — a refusal that never reached a model " +
				"must not be charged against the QUAL-09 ledger",
		).toBeUndefined();
	});
});

describe("the advisor consult feeds the real context size to the capability guard", () => {
	it("a context larger than the advisor model's window is refused naming the window, and no call is made", async () => {
		setMode("cheap");
		setEscalated(false);
		takeQualityCost();
		const advisor = ROLE_MAP.cheap.advisor.candidates[0];
		if (advisor === undefined) throw new Error("ROLE_MAP.cheap.advisor has no candidates");

		const handle = await createFauxSession({});
		try {
			let callCount = 0;
			const faux = fauxProvider({
				provider: advisor.provider,
				api: "openai-completions",
				models: [{ id: advisor.id, reasoning: true, input: ["text"], contextWindow: 1000, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } }],
			});
			faux.setResponses([
				() => {
					callCount += 1;
					return fauxAssistantMessage("never", { stopReason: "stop" });
				},
			]);
			handle.modelRuntime.registerNativeProvider(faux.provider);
			await handle.modelRuntime.setRuntimeApiKey(advisor.provider, "kypi-fixture-not-a-real-key");
			await waitForConfiguredAuth(handle.modelRuntime, advisor.provider);

			const ctx = handle.session.extensionRunner.createCommandContext();
			await expect(executeConsultAdvisor(ctx, { question: "q", context: "x".repeat(8000) })).rejects.toThrow(/1000-token context window/);
			expect(callCount).toBe(0);
			expect(peekQualityCost()).toBeUndefined();

			await expect(executeConsultAdvisor(ctx, { question: "q", context: "small" })).resolves.toBe("never");
			expect(callCount).toBe(1);
		} finally {
			setMode("cheap");
			setEscalated(false);
			takeQualityCost();
			await handle.dispose();
		}
	}, 30_000);
});
