/**
 * runReview and runRefuteOrPromote against a scripted provider: one corrective retry when the model writes the
 * submit_review call as text, fail-closed on a second miss, and a context larger than the model window refused
 * before any call.
 */
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { runDesignReview } from "../../.pi/extensions/quality/design-review.ts";
import { runReview, type ReviewerContractInput } from "../../.pi/extensions/quality/reviewer.ts";
import { runRefuteOrPromote } from "../../.pi/extensions/quality/verdict.ts";
import { getModeState, setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";
import { ROLE_MAP } from "../../.pi/extensions/routing/schema.ts";
import { createFauxSession, type FauxSessionHandle } from "../helpers/session.ts";

const CONTRACT: ReviewerContractInput = {
	diff: "diff --git a/src/a.ts b/src/a.ts\n+const a = 1;\n",
	touchedFiles: [{ path: "src/a.ts", contents: "const a = 1;\n" }],
	gateReport: "typecheck: PASS",
	requirements: [{ id: "R1", text: "create a" }],
	filesTouchedUnion: ["src/a.ts"],
	importGraph: [],
};

const VALID = {
	verdicts: [{ requirementId: "R1", status: "Implemented", evidence: "src/a.ts:1" }],
	findings: [],
	checkedAndCleared: "read src/a.ts end to end",
	classification: "root-cause",
	classificationJustification: "fixes the cause",
};

const PROSE_CALL = 'I will submit now: submit_review({ "verdicts": [] })';

async function waitForAuth(modelRuntime: FauxSessionHandle["modelRuntime"], providerId: string): Promise<void> {
	const start = Date.now();
	while (!modelRuntime.hasConfiguredAuth(providerId)) {
		if (Date.now() - start > 2000) throw new Error(`no configured auth for ${providerId}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

async function withReviewer<T>(
	contextWindow: number | undefined,
	responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0],
	fn: (ctx: ReturnType<FauxSessionHandle["session"]["extensionRunner"]["createCommandContext"]>, faux: ReturnType<typeof fauxProvider>) => Promise<T>,
): Promise<T> {
	setMode("cheap");
	setEscalated(false);
	expect(getModeState().mode).toBe("cheap");
	const reviewer = ROLE_MAP.cheap.reviewer.candidates[0];
	if (reviewer === undefined) throw new Error("ROLE_MAP.cheap.reviewer has no candidates");
	const handle = await createFauxSession({});
	try {
		const faux = fauxProvider({
			provider: reviewer.provider,
			api: "openai-completions",
			models: [{ id: reviewer.id, reasoning: true, input: ["text"], ...(contextWindow === undefined ? {} : { contextWindow }), cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } }],
		});
		faux.setResponses(responses);
		handle.modelRuntime.registerNativeProvider(faux.provider);
		await handle.modelRuntime.setRuntimeApiKey(reviewer.provider, "kypi-fixture-not-a-real-key");
		await waitForAuth(handle.modelRuntime, reviewer.provider);
		return await fn(handle.session.extensionRunner.createCommandContext(), faux);
	} finally {
		setMode("cheap");
		setEscalated(false);
		await handle.dispose();
	}
}

afterEach(() => {
	setMode("cheap");
	setEscalated(false);
});

describe("runReview prose tool-call retry", () => {
	it("a prose call followed by a real one succeeds after exactly one retry", async () => {
		const result = await withReviewer(undefined, [
			fauxAssistantMessage(PROSE_CALL, { stopReason: "stop" }),
			fauxAssistantMessage(fauxToolCall("submit_review", VALID), { stopReason: "toolUse" }),
		], async (ctx, faux) => {
			const r = await runReview(ctx, { contract: CONTRACT, requirementIds: ["R1"] });
			expect(faux.state.callCount).toBe(2);
			return r;
		});
		expect(result.ok).toBe(true);
	}, 30_000);

	it("two prose calls fail closed after the single retry", async () => {
		const result = await withReviewer(undefined, [
			fauxAssistantMessage(PROSE_CALL, { stopReason: "stop" }),
			fauxAssistantMessage(PROSE_CALL, { stopReason: "stop" }),
		], async (ctx, faux) => {
			const r = await runReview(ctx, { contract: CONTRACT, requirementIds: ["R1"] });
			expect(faux.state.callCount).toBe(2);
			return r;
		});
		expect(result.ok).toBe(false);
	}, 30_000);

	it("plain prose with no call syntax is not retried", async () => {
		const result = await withReviewer(undefined, [fauxAssistantMessage("LGTM", { stopReason: "stop" })], async (ctx, faux) => {
			const r = await runReview(ctx, { contract: CONTRACT, requirementIds: ["R1"] });
			expect(faux.state.callCount).toBe(1);
			return r;
		});
		expect(result.ok).toBe(false);
	}, 30_000);
});

describe("reviewer calls feed the real context size to the capability guard", () => {
	it("runReview refuses a context larger than the model window, naming it, with no call", async () => {
		await withReviewer(1000, [fauxAssistantMessage("never", { stopReason: "stop" })], async (ctx, faux) => {
			const big = { ...CONTRACT, diff: `diff --git a/x b/x\n+${"x".repeat(9000)}\n` };
			await expect(runReview(ctx, { contract: big, requirementIds: ["R1"] })).rejects.toThrow(/1000-token context window/);
			expect(faux.state.callCount).toBe(0);
		});
	}, 30_000);

	it("runRefuteOrPromote refuses a context larger than the model window, naming it, with no call", async () => {
		await withReviewer(1000, [fauxAssistantMessage("never", { stopReason: "stop" })], async (ctx, faux) => {
			const big = { ...CONTRACT, diff: `diff --git a/x b/x\n+${"x".repeat(9000)}\n` };
			const review = {
				verdicts: [],
				findings: [{ severity: "BLOCKER" as const, location: "src/a.ts:1", concreteFailure: "boom", suggestedFix: "fix" }],
				checkedAndCleared: "x",
				classification: "root-cause" as const,
				classificationJustification: "x",
			};
			await expect(runRefuteOrPromote(ctx, review, big)).rejects.toThrow(/1000-token context window/);
			expect(faux.state.callCount).toBe(0);
		});
	}, 30_000);
});

describe("runDesignReview", () => {
	const input = { diffText: "diff --git a/src/a.ts b/src/a.ts\n+const a = 1;\n", changed: ["src/a.ts"], requirements: CONTRACT.requirements };
	const FINDING = { severity: "WARNING", location: "src/a.ts:3-9", concreteFailure: "query inside a loop", suggestedFix: "batch it" };

	it("returns the validated findings from a submit_design_review call", async () => {
		const out = await withReviewer(undefined, [fauxAssistantMessage(fauxToolCall("submit_design_review", { findings: [FINDING] }), { stopReason: "toolUse" })], (ctx) => runDesignReview(ctx, input));
		expect(out.findings).toEqual([FINDING]);
		expect(out.notice).toBeUndefined();
	}, 30_000);

	it("an unusable reply adds no findings and says so, instead of throwing", async () => {
		const out = await withReviewer(undefined, [fauxAssistantMessage("looks scalable", { stopReason: "stop" })], (ctx) => runDesignReview(ctx, input));
		expect(out.findings).toEqual([]);
		expect(out.notice).toContain("no usable");
	}, 30_000);

	it("a finding with a malformed location is not accepted", async () => {
		const bad = { ...FINDING, location: "src/a.ts" };
		const out = await withReviewer(undefined, [fauxAssistantMessage(fauxToolCall("submit_design_review", { findings: [bad] }), { stopReason: "toolUse" })], (ctx) => runDesignReview(ctx, input));
		expect(out.findings).toEqual([]);
		expect(out.notice).toBeDefined();
	}, 30_000);
});
