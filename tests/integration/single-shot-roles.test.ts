/**
 * A single-shot role runs through the callModel chokepoint, leaves a nested row under its role name, carries its
 * reasoning effort onto the wire, and mutates no session state (the wrong implementation is setModel-and-back). `ctx`
 * comes from `createCommandContext()`; case 0 guards that `deepseek` resolved to this run's faux provider, not Pi's real
 * catalogue entry. Whether a real model honours the effort is a runbook check, never proven here.
 */
import { existsSync } from "node:fs";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { CustomEntry } from "@earendil-works/pi-coding-agent";

import { beforeAll, describe, expect, it } from "vitest";

import { logPath } from "../../.pi/extensions/diagnostics/jsonl.ts";
import { SESSION_TURN_ROLE } from "../../.pi/extensions/diagnostics/index.ts";
import { TURNS_LOG_BASE, WIRE_LOG_BASE, type RowKind, type WireKind } from "../../.pi/extensions/diagnostics/schema.ts";
import { getModeState, runSingleShotRole, setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";
import { MODE_ENTRY_TYPE, type KyModeData } from "../../.pi/extensions/routing/schema.ts";
import { buildOpenAiFixturePayload, wrapFauxWithPayload } from "../helpers/faux.ts";
import { repoRoot } from "../helpers/git.ts";
import { readTornSafe } from "../helpers/logs.ts";
import { createFauxSession, waitForConfiguredAuth } from "../helpers/session.ts";

/** Absolute path of the diagnostics extension this repository ships. */
const DIAGNOSTICS_ENTRY = `${repoRoot()}/.pi/extensions/diagnostics/index.ts`;

/** The real diagnostics entry point with no probe; `ctx` comes from `createCommandContext()`. */
const EXTENSION_SOURCE = [
	"// Generated for tests/integration/single-shot-roles.test.ts. Lives in a temp dir.",
	`import diagnostics from ${JSON.stringify(DIAGNOSTICS_ENTRY)};`,
	"",
	"export default function (pi) {",
	"\tdiagnostics(pi);",
	"}",
].join("\n");

/** A turns row as this file reads it back off disk. */
interface TurnsRow {
	kind?: RowKind;
	role?: string;
	corr?: string;
}

/** A wire record as this file reads it back off disk. */
interface WireRow {
	kind?: WireKind;
	corr?: string;
	role?: string;
	payload?: Record<string, unknown>;
}

/** Read a log that may not exist yet — absence is a finding, not an exception. */
function readRows<T>(file: string): T[] {
	if (!existsSync(file)) {
		return [];
	}
	const { records, unparseable } = readTornSafe(file);
	if (unparseable.length > 0) {
		throw new Error(`${file} holds ${unparseable.length} unparseable line(s): ${unparseable[0]}`);
	}
	return records as T[];
}

/** A `ky:mode` entry, matched the same way `mode-switch.test.ts#findModeEntry` does. */
function countModeEntries(branch: readonly unknown[]): number {
	return branch.filter(
		(entry): entry is CustomEntry<KyModeData> =>
			typeof entry === "object" &&
			entry !== null &&
			(entry as { type?: unknown }).type === "custom" &&
			(entry as { customType?: unknown }).customType === MODE_ENTRY_TYPE,
	).length;
}

/** A `model_change` entry, matched structurally (no type import needed for a count). */
function countModelChangeEntries(branch: readonly unknown[]): number {
	return branch.filter(
		(entry) => typeof entry === "object" && entry !== null && (entry as { type?: unknown }).type === "model_change",
	).length;
}

/** What the whole fixture produced, read once and asserted on by every case. */
interface Run {
	/** Did the resolved `deepseek` model really come from THIS run's faux registration? */
	identityGuardOk: boolean;
	turnsFileExisted: boolean;
	wireFileExistedAfterWarmup: boolean;
	turnsAfterWarmup: TurnsRow[];

	modelBefore: { provider: string | undefined; id: string | undefined };
	modelAfter: { provider: string | undefined; id: string | undefined };
	modelChangeCountBefore: number;
	modelChangeCountAfter: number;
	modeEntryCountBefore: number;
	modeEntryCountAfter: number;

	turnsAfterReviewer: TurnsRow[];
	wireAfterReviewer: WireRow[];
	seenEffortReviewer: unknown[];

	turnsBeforeRefusal: number;
	wireBeforeRefusal: number;
	guardRefusalThrew: boolean;
	guardRefusalMessage: string;
	turnsAfterRefusal: TurnsRow[];
	wireAfterRefusal: WireRow[];

	turnsAfterSummariser: TurnsRow[];
	wireAfterSummariser: WireRow[];
	seenEffortSummariser: unknown[];
}

async function runFixture(): Promise<Run> {
	// Deterministic starting state: another test file in this worker may have set the shared mode slot.
	setMode("cheap");
	setEscalated(false);
	expect(getModeState().mode, "test setup did not reset the mode slot to cheap").toBe("cheap");
	expect(getModeState().escalated, "test setup did not clear escalation").toBe(false);

	const handle = await createFauxSession({
		extensionSource: EXTENSION_SOURCE,
		// The warm-up main-loop turn leaves a `role: "session"` row.
		responses: [fauxAssistantMessage("warm", { stopReason: "stop" })],
	});

	try {
		const seenEffortReviewer: unknown[] = [];
		const seenEffortSummariser: unknown[] = [];

		const deepseekFaux = fauxProvider({
			provider: "deepseek",
			models: [
				{
					id: "deepseek-flash",
					reasoning: true,
					// Text-only, so the capability guard has an authed candidate to refuse; faux defaults to text+image.
					input: ["text"],
					cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 },
				},
			],
		});

		deepseekFaux.setResponses([
			// 1 — the reviewer call, a factory so the test sees what left the harness.
			(_context, options) => {
				seenEffortReviewer.push((options as Record<string, unknown> | undefined)?.reasoningEffort);
				return fauxAssistantMessage("reviewer-reply", { stopReason: "stop" });
			},
			// 2 — the successful summariser call (the no-effort paired negative).
			(_context, options) => {
				seenEffortSummariser.push((options as Record<string, unknown> | undefined)?.reasoningEffort);
				return fauxAssistantMessage("summariser-reply", { stopReason: "stop" });
			},
		]);

		// Register the wrapped provider: only it fires `onPayload`, which callModel's nested.request capture needs.
		handle.modelRuntime.registerNativeProvider(
			wrapFauxWithPayload(deepseekFaux, buildOpenAiFixturePayload),
		);
		await handle.modelRuntime.setRuntimeApiKey("deepseek", "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, "deepseek");

		await handle.session.prompt("warm up");

		const ctx = handle.session.extensionRunner.createCommandContext();

		// ---- case 0 fixture: the identity guard ------------------------------
		const resolvedDeepseek = ctx.modelRegistry.find("deepseek", "deepseek-flash");
		const identityGuardOk = resolvedDeepseek?.api === deepseekFaux.api;

		const turnsFile = logPath(handle.cwd, TURNS_LOG_BASE);
		const wireFile = logPath(handle.cwd, WIRE_LOG_BASE);

		const turnsAfterWarmup = readRows<TurnsRow>(turnsFile);
		const wireFileExistedAfterWarmup = existsSync(wireFile);

		// ---- reviewer call: ROUTE-04's nested-row / no-mutation proof --------
		const modelBefore = { provider: ctx.model?.provider, id: ctx.model?.id };
		const branchBeforeReviewer = handle.session.sessionManager.getBranch();
		const modelChangeCountBefore = countModelChangeEntries(branchBeforeReviewer);
		const modeEntryCountBefore = countModeEntries(branchBeforeReviewer);

		await runSingleShotRole(ctx, {
			role: "reviewer",
			messages: [{ role: "user", content: "please review this change", timestamp: Date.now() }],
		});

		const modelAfter = { provider: ctx.model?.provider, id: ctx.model?.id };
		const branchAfterReviewer = handle.session.sessionManager.getBranch();
		const modelChangeCountAfter = countModelChangeEntries(branchAfterReviewer);
		const modeEntryCountAfter = countModeEntries(branchAfterReviewer);

		const turnsAfterReviewer = readRows<TurnsRow>(turnsFile);
		const wireAfterReviewer = readRows<WireRow>(wireFile);

		// ---- guard refusal: role "summariser", need.image against a text-only
		// candidate. Must throw the GUARD's own reason and cost nothing. -------
		const turnsBeforeRefusal = turnsAfterReviewer.length;
		const wireBeforeRefusal = wireAfterReviewer.length;

		let guardRefusalThrew = false;
		let guardRefusalMessage = "";
		try {
			await runSingleShotRole(ctx, {
				role: "summariser",
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "describe this image" }, { type: "image", data: "", mimeType: "image/png" }],
						timestamp: Date.now(),
					},
				],
			});
		} catch (error) {
			guardRefusalThrew = true;
			guardRefusalMessage = error instanceof Error ? error.message : String(error);
		}

		const turnsAfterRefusal = readRows<TurnsRow>(turnsFile);
		const wireAfterRefusal = readRows<WireRow>(wireFile);

		// ---- successful summariser call: the no-effort paired negative -------
		await runSingleShotRole(ctx, {
			role: "summariser",
			messages: [{ role: "user", content: "please summarise this", timestamp: Date.now() }],
		});

		const turnsAfterSummariser = readRows<TurnsRow>(turnsFile);
		const wireAfterSummariser = readRows<WireRow>(wireFile);

		return {
			identityGuardOk,
			turnsFileExisted: existsSync(turnsFile),
			wireFileExistedAfterWarmup,
			turnsAfterWarmup,
			modelBefore,
			modelAfter,
			modelChangeCountBefore,
			modelChangeCountAfter,
			modeEntryCountBefore,
			modeEntryCountAfter,
			turnsAfterReviewer,
			wireAfterReviewer,
			seenEffortReviewer,
			turnsBeforeRefusal,
			wireBeforeRefusal,
			guardRefusalThrew,
			guardRefusalMessage,
			turnsAfterRefusal,
			wireAfterRefusal,
			turnsAfterSummariser,
			wireAfterSummariser,
			seenEffortSummariser,
		};
	} finally {
		await handle.dispose();
	}
}

let run: Run;

describe("ROUTE-04 — single-shot roles through runSingleShotRole", () => {
	beforeAll(async () => {
		run = await runFixture();
	}, 60_000);

	it("case 0 — the deepseek candidate really resolved THIS run's faux provider, not the real catalogue", () => {
		expect(
			run.identityGuardOk,
			"ctx.modelRegistry.find('deepseek','deepseek-v4-flash') did not resolve to this run's faux " +
				"api id. The native registration did not replace Pi's built-in deepseek provider, so " +
				"every case below would be measuring the real catalogue entry (and failing for want of a " +
				"credential) instead of the fixture",
		).toBe(true);
	});

	it("case 0b — the main-loop warm-up turn's row carries role: \"session\"", () => {
		expect(
			run.turnsFileExisted,
			"no turns log exists after the warm-up prompt, so the assertions below would iterate an " +
				"empty array and pass while proving nothing",
		).toBe(true);
		expect(
			run.turnsAfterWarmup.length,
			"the turns log exists but is empty after a real prompt — the diagnostics extension did not " +
				"capture the warm-up turn at all",
		).toBeGreaterThan(0);

		const sessionRows = run.turnsAfterWarmup.filter((row) => row.kind === "turn");
		expect(
			sessionRows.length,
			`expected at least one kind:"turn" row after the warm-up prompt; found ` +
				`${JSON.stringify(run.turnsAfterWarmup.map((r) => r.kind))}`,
		).toBeGreaterThan(0);
		for (const row of sessionRows) {
			expect(
				row.role,
				`a main-loop turn row carried role ${JSON.stringify(row.role)} instead of ` +
					`${JSON.stringify(SESSION_TURN_ROLE)} — a later reader could mistake the executor path ` +
					"for a role-filtered one (RESEARCH Pitfall 1)",
			).toBe(SESSION_TURN_ROLE);
		}
	});

	it("case 1 — driving runSingleShotRole for reviewer writes exactly one kind:\"nested\" row with role \"reviewer\"", () => {
		expect(
			run.turnsAfterReviewer.length,
			"the turns log is empty after the reviewer call, so the row lookup below would be searching " +
				"nothing",
		).toBeGreaterThan(0);

		const nested = run.turnsAfterReviewer.filter((row) => row.kind === "nested" && row.role === "reviewer");
		expect(
			nested.length,
			`expected exactly one kind:"nested" row with role "reviewer"; found rows ` +
				`${JSON.stringify(run.turnsAfterReviewer.map((r) => ({ kind: r.kind, role: r.role })))} instead`,
		).toBe(1);

		const corr = nested[0]?.corr;
		expect(
			typeof corr === "string" && corr.length > 0,
			"the nested row carries no usable correlation id, so its wire records cannot be found from it",
		).toBe(true);
	});

	it("case 2 — the session's active model is byte-identical before and after (provider AND id, never object identity)", () => {
		expect(
			run.modelBefore.provider,
			"the fixture's own session had no active model before the call, so 'unchanged' would be " +
				"vacuously true",
		).toBeDefined();
		expect(run.modelBefore.id).toBeDefined();

		expect(
			run.modelAfter.provider,
			`the session's active provider changed from ${run.modelBefore.provider} to ` +
				`${run.modelAfter.provider} as a result of a single-shot role call — runSingleShotRole must ` +
				"never mutate the session's own model",
		).toBe(run.modelBefore.provider);
		expect(
			run.modelAfter.id,
			`the session's active model id changed from ${run.modelBefore.id} to ${run.modelAfter.id}`,
		).toBe(run.modelBefore.id);
	});

	it("case 3 — no model_change entry and no ky:mode entry resulted from the call", () => {
		// A delta of zero, not an absolute zero: session construction itself writes one model_change entry (measured).
		expect(
			run.modelChangeCountAfter - run.modelChangeCountBefore,
			"a model_change session entry was written as a result of runSingleShotRole, which is the " +
				"mode-switch commands' job, never this dispatcher's",
		).toBe(0);
		expect(
			run.modeEntryCountAfter - run.modeEntryCountBefore,
			"a ky:mode custom entry was written as a result of runSingleShotRole",
		).toBe(0);
	});

	it("case 4 — the reviewer role's declared reasoning effort reached the wire", () => {
		const reviewerRow = run.turnsAfterReviewer.find((row) => row.kind === "nested" && row.role === "reviewer");
		expect(reviewerRow, "no nested reviewer row to key the wire lookup off of").toBeDefined();

		const captured = run.wireAfterReviewer.filter(
			(record) => record.corr === reviewerRow?.corr && record.kind === "nested.request",
		);
		// Non-vacuity before content.
		expect(
			captured.length,
			"no nested.request wire record was captured for the reviewer call at all — either " +
				"wrapFauxWithPayload was not applied to this provider, or callModel's own onPayload capture " +
				"never fired",
		).toBeGreaterThan(0);

		expect(
			captured[0]?.payload?.reasoning_effort,
			"the captured payload does not carry reasoning_effort:\"high\" for the reviewer role, which " +
				"routing/schema.ts declares in every mode",
		).toBe("high");

		// The second oracle: the provider's own response factory saw the same
		// option on the way in, independent of the wire-log path.
		expect(
			run.seenEffortReviewer,
			"the faux provider's response factory did not receive reasoningEffort:\"high\" as an outgoing " +
				"option for the reviewer call",
		).toEqual(["high"]);
	});

	it("case 5 — a role with no declared reasoning effort produces a payload with no such field (the paired negative)", () => {
		const summariserRow = run.turnsAfterSummariser.find(
			(row) => row.kind === "nested" && row.role === "summariser",
		);
		expect(summariserRow, "no nested summariser row to key the wire lookup off of").toBeDefined();

		const captured = run.wireAfterSummariser.filter(
			(record) => record.corr === summariserRow?.corr && record.kind === "nested.request",
		);
		expect(
			captured.length,
			"no nested.request wire record was captured for the summariser call at all",
		).toBeGreaterThan(0);

		expect(
			captured[0]?.payload && "reasoning_effort" in captured[0].payload,
			"the summariser call's captured payload carries a reasoning_effort field even though " +
				"routing/schema.ts declares none for this role in any mode — an implementation that " +
				"hardcodes reasoningEffort:\"high\" on every nested call would satisfy case 4 alone; this is " +
				"the case that catches it",
		).toBe(false);

		expect(
			run.seenEffortSummariser,
			"the faux provider's response factory received a defined reasoningEffort for the summariser " +
				"call",
		).toEqual([undefined]);
	});

	it("case 6 — a guard refusal throws the GUARD's own reason and issues NO request at all", () => {
		expect(
			run.guardRefusalThrew,
			"runSingleShotRole did not throw for a role/need combination the capability guard must block " +
				"(summariser, need.image:true, against a text-only model)",
		).toBe(true);

		expect(
			run.guardRefusalMessage,
			"the thrown error does not name the model the guard refused",
		).toContain("deepseek/deepseek-flash");
		expect(
			run.guardRefusalMessage,
			"the thrown error does not carry the guard's own text-only reasoning — a caller reading this " +
				"message could not tell a guard refusal from any other failure",
		).toContain("is text-only");
		expect(
			run.guardRefusalMessage,
			"the thrown error does not name the role the guard refused",
		).toContain("summariser role needs image input");

		// Zero requests at all: a refusal that fires after dispatch would already have cost money and disclosed content.
		expect(
			run.turnsAfterRefusal.length,
			"a turns row was written even though the guard refused the call before any dispatch",
		).toBe(run.turnsBeforeRefusal);
		expect(
			run.wireAfterRefusal.length,
			"a wire record was written even though the guard refused the call before any dispatch",
		).toBe(run.wireBeforeRefusal);
	});
});

// -----------------------------------------------------------------------------
// A DashScope-only machine must reach dashscope, not restart the chain at deepseek.
// -----------------------------------------------------------------------------

/**
 * Only `dashscope` is registered and authed; `deepseek` stays Pi's untouched built-in, since registering a second faux
 * `deepseek` flipped its auth as a side effect (measured). runSingleShotRole must serve the resolved dashscope candidate
 * through callModel, never callWithFallback, so no path here can reach a real endpoint.
 */
async function runDashscopeOnlyFixture(): Promise<{
	turnsAfterReviewer: (TurnsRow & { provider?: string; model?: string })[];
	wireAfterReviewer: WireRow[];
	reviewerReplyText: string | undefined;
}> {
	setMode("cheap");
	setEscalated(false);
	expect(getModeState().mode, "test setup did not reset the mode slot to cheap").toBe("cheap");

	const handle = await createFauxSession({
		extensionSource: EXTENSION_SOURCE,
		responses: [fauxAssistantMessage("warm", { stopReason: "stop" })],
	});

	try {
		const dashscopeFaux = fauxProvider({
			provider: "dashscope",
			models: [{ id: "deepseek-v4-flash", reasoning: true, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } }],
		});
		dashscopeFaux.setResponses([fauxAssistantMessage("dashscope-reviewer-reply", { stopReason: "stop" })]);

		// dashscope is the only provider registered and authed here.
		handle.modelRuntime.registerNativeProvider(wrapFauxWithPayload(dashscopeFaux, buildOpenAiFixturePayload));
		await handle.modelRuntime.setRuntimeApiKey("dashscope", "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, "dashscope");
		expect(
			handle.modelRuntime.hasConfiguredAuth("deepseek"),
			"the auth precondition for this fixture is wrong -- deepseek must carry NO configured auth",
		).toBe(false);

		await handle.session.prompt("warm up");
		const ctx = handle.session.extensionRunner.createCommandContext();

		const turnsFile = logPath(handle.cwd, TURNS_LOG_BASE);
		const wireFile = logPath(handle.cwd, WIRE_LOG_BASE);

		const reply = await runSingleShotRole(ctx, {
			role: "reviewer",
			messages: [{ role: "user", content: "please review this change", timestamp: Date.now() }],
		});

		return {
			turnsAfterReviewer: readRows<TurnsRow & { provider?: string; model?: string }>(turnsFile),
			wireAfterReviewer: readRows<WireRow>(wireFile),
			reviewerReplyText: reply.content?.find((block) => block.type === "text")?.text,
		};
	} finally {
		await handle.dispose();
	}
}

describe("ROUTE-04 / CR-02 -- runSingleShotRole on a DashScope-only machine reaches dashscope, not a discarded-candidate chain restart at deepseek", () => {
	it("resolves and dispatches to dashscope/deepseek-v4-flash directly, never attempting the unauthed deepseek chain head", async () => {
		const result = await runDashscopeOnlyFixture();

		expect(
			result.reviewerReplyText,
			"runSingleShotRole threw or returned no text -- before CR-02's fix this call restarted " +
				"callWithFallback at CHAIN[0] (deepseek, no configured auth) and failed instead of serving " +
				"the dashscope candidate pickConfiguredCandidate actually resolved",
		).toBe("dashscope-reviewer-reply");

		const nested = result.turnsAfterReviewer.filter((row) => row.kind === "nested" && row.role === "reviewer");
		expect(
			nested.length,
			`expected exactly one kind:"nested" row with role "reviewer"; found ` +
				`${JSON.stringify(result.turnsAfterReviewer.map((r) => ({ kind: r.kind, role: r.role, provider: r.provider })))}`,
		).toBe(1);
		expect(
			nested[0]?.provider,
			"the nested reviewer row does not name dashscope as the serving provider -- CR-02's chain-" +
				"restart bug would instead show (or fail before ever writing) a deepseek attempt",
		).toBe("dashscope");
		expect(nested[0]?.model).toBe("deepseek-v4-flash");

		// Zero deepseek rows proves the router's own resolved candidate was served, not the chain's head.
		const deepseekRows = result.turnsAfterReviewer.filter((row) => row.provider === "deepseek");
		expect(
			deepseekRows.length,
			"a deepseek-provider row was written despite deepseek carrying no configured auth in this " +
				"fixture -- the resolved dashscope candidate was discarded and the chain was restarted",
		).toBe(0);

		const corr = nested[0]?.corr;
		const req = result.wireAfterReviewer.find((w) => w.corr === corr && w.kind === "nested.request");
		expect(req, "no nested.request wire record joined by corr").toBeDefined();
		expect(req?.payload?.model).toBe("deepseek-v4-flash");
	});
});
