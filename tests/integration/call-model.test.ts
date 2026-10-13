/**
 * callModel restores every capture on the nested path. A nested completion bypasses the session Agent's provider hooks
 * (pi src/core/sdk.ts:294-360), so the bare-completion negative control runs first on the same session. The live ctx
 * comes from a user-scope probe via globalThis (jiti loads a separate module graph), and a warm-up prompt is needed
 * because `session_start` does not fire headless. Whether a model honours reasoning_effort is RB-02-01, OUTSTANDING.
 */
import { existsSync, readFileSync } from "node:fs";

import type { Model, TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { beforeAll, describe, expect, it } from "vitest";

import { callModel } from "../../.pi/extensions/diagnostics/call-model.ts";
import { logPath } from "../../.pi/extensions/diagnostics/jsonl.ts";
import {
	TURNS_LOG_BASE,
	WIRE_LOG_BASE,
	type Outcome,
	type RowKind,
	type WireKind,
} from "../../.pi/extensions/diagnostics/schema.ts";
import {
	buildOpenAiFixturePayload,
	SECRET_FIXTURE_TOKEN,
	withSecretHeader,
} from "../helpers/faux.ts";
import { repoRoot } from "../helpers/git.ts";
import { readTornSafe } from "../helpers/logs.ts";
import { withFauxSession } from "../helpers/session.ts";

/** Where the probe parks the live `ExtensionContext`. */
const CTX_KEY = "__kypiCallModelExtensionContext";

/** Absolute path of the diagnostics extension this repository ships. */
const DIAGNOSTICS_ENTRY = `${repoRoot()}/.pi/extensions/diagnostics/index.ts`;

/** The real diagnostics entry point plus a probe that hands the live context to the test; paths JSON-stringified. */
const PROBE_SOURCE = [
	"// Generated for tests/integration/call-model.test.ts. Lives in a temp dir.",
	`import diagnostics from ${JSON.stringify(DIAGNOSTICS_ENTRY)};`,
	"",
	// Three hooks, since `session_start` does not fire headless, so the probe survives an emit-order change.
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

/** A wire record as this file reads it back off disk. */
interface WireRow {
	kind?: WireKind;
	corr?: string;
	role?: string;
	status?: number;
	headers?: Record<string, string | null>;
	payload?: Record<string, unknown>;
}

/** A turns row as this file reads it back off disk. */
interface TurnsRow {
	kind?: RowKind;
	role?: string;
	corr?: string;
	outcome?: Outcome;
	stopReason?: string;
	errorMessage?: string;
	input?: number;
	output?: number;
	totalTokens?: number;
	latencyMs?: number;
	httpStatus?: number;
	cost?: { total?: number };
	event?: string;
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

/** What the whole fixture produced, read once and asserted on by every case. */
interface Run {
	/** Wire records present after the bare completion, before any `callModel`. */
	wireAfterControl: WireRow[];
	/** Turns rows present after the bare completion. */
	turnsAfterControl: TurnsRow[];
	/** Whether the wire log existed at all after the bare completion. */
	wireFileExistedAfterControl: boolean;
	/** Every wire record at the end of the run. */
	wire: WireRow[];
	/** Every turns row at the end of the run. */
	turns: TurnsRow[];
	/** Raw bytes of the wire log at the end of the run. */
	wireText: string;
	/** Per-provider-call view of the outgoing options, captured by the factory. */
	seenEfforts: unknown[];
	/** The `Context` the provider received on the advisor call. */
	advisorContext: TranscriptContext | undefined;
	model: Model<string> | undefined;
	/** Did the deliberately-rejected call rethrow, as `callModel` promises? */
	rethrew: boolean;
	/** Did a caller-supplied `onPayload` manage to run? It must not. */
	callerPayloadHookRan: boolean;
	/** Was the live `ExtensionContext` actually handed to the probe? */
	sawContext: boolean;
}

/** The synthetic credential, planted in the provider's error text for case 4. */
const ERROR_WITH_SECRET = `upstream refused the key ${SECRET_FIXTURE_TOKEN} for this account`;

/** The synthetic credential, planted in a rejection for case 5. */
const REJECTION_WITH_SECRET = `registry blew up holding ${SECRET_FIXTURE_TOKEN}`;

async function runFixture(): Promise<Run> {
	const seenEfforts: unknown[] = [];
	let advisorContext: TranscriptContext | undefined;
	let model: Model<string> | undefined;
	let callerPayloadHookRan = false;

	// A stale context parked by another file in this worker would satisfy the "did the probe run?" guard.
	(globalThis as Record<string, unknown>)[CTX_KEY] = undefined;

	return await withFauxSession(
		{
			extensionSource: PROBE_SOURCE,
			// The credential rides inside the payload: everything the caller puts in `messages[]` travels there.
			buildPayload: (m, context, options) =>
				withSecretHeader(buildOpenAiFixturePayload(m, context, options)),
			responses: [
				// 1 — the warm-up main-loop prompt: hands out a live context and leaves `main.*` records.
				fauxAssistantMessage("warm", { stopReason: "stop" }),
				// 2 — consumed by the bare completion (the negative control).
				fauxAssistantMessage("control", { stopReason: "stop" }),
				// 3 — the advisor call, a factory so the test sees what the provider was handed.
				(context, options, _state, requestModel) => {
					advisorContext = context;
					model = requestModel;
					seenEfforts.push((options as Record<string, unknown> | undefined)?.reasoningEffort);
					return fauxAssistantMessage("advice", { stopReason: "stop" });
				},
				// 4 — the reviewer call fails the way a provider fails.
				fauxAssistantMessage("", { stopReason: "error", errorMessage: ERROR_WITH_SECRET }),
			],
		},
		async ({ cwd, session, model: sessionModel, modelRuntime }) => {
			const wireFile = logPath(cwd, WIRE_LOG_BASE);
			const turnsFile = logPath(cwd, TURNS_LOG_BASE);

			// ---- warm-up: the only way to obtain the live context ---
			await session.prompt("warm up");

			const ctx = (globalThis as Record<string, unknown>)[CTX_KEY] as
				| ExtensionContext
				| undefined;
			const sawContext = ctx !== undefined;

			// ---- case 1 fixture: the bare completion, no callbacks at all --------
			await modelRuntime.complete(sessionModel, {
				messages: [{ role: "user", content: "control", timestamp: Date.now() }],
			});

			const wireAfterControl = readRows<WireRow>(wireFile);
			const turnsAfterControl = readRows<TurnsRow>(turnsFile);
			const wireFileExistedAfterControl = existsSync(wireFile);

			if (ctx === undefined) {
				// Return early: each case then fails with its own message, and case 1's evidence is kept.
				return {
					wireAfterControl,
					turnsAfterControl,
					wireFileExistedAfterControl,
					wire: wireAfterControl,
					turns: turnsAfterControl,
					wireText: existsSync(wireFile) ? readFileSync(wireFile, "utf8") : "",
					seenEfforts,
					advisorContext,
					model,
					rethrew: false,
					callerPayloadHookRan,
					sawContext,
				};
			}

			// ---- cases 2, 3 and 6 fixture: the paired positive -------------------
			// The `onPayload` is a hijack attempt the compiler accepts (the custom-API fallback arm of the options union);
			// callModel's spread order must overwrite it.
			await callModel(ctx, {
				role: "advisor",
				model: sessionModel,
				messages: [{ role: "user", content: "advise", timestamp: Date.now() }],
				api: {
					reasoningEffort: "high",
					onPayload: () => {
						callerPayloadHookRan = true;
						return "HIJACKED";
					},
				},
			});

			// ---- case 4 fixture: the provider-surfaced error ---------------------
			await callModel(ctx, {
				role: "reviewer",
				model: sessionModel,
				messages: [{ role: "user", content: "review", timestamp: Date.now() }],
			});

			// ---- case 5 fixture: a REJECTED completion ---------------------------
			// The real ctx with one member shadowed via Object.create (a spread would drop getters). Pi turns setup failures
			// into an error message, so a rejection must be injected or this branch ships untested.
			const rejecting = Object.create(ctx, {
				modelRegistry: {
					value: {
						complete: () => Promise.reject(new Error(REJECTION_WITH_SECRET)),
					},
				},
			}) as ExtensionContext;

			let rethrew = false;
			try {
				await callModel(rejecting, {
					role: "rejected",
					model: sessionModel,
					messages: [{ role: "user", content: "boom", timestamp: Date.now() }],
				});
			} catch {
				rethrew = true;
			}

			return {
				wireAfterControl,
				turnsAfterControl,
				wireFileExistedAfterControl,
				wire: readRows<WireRow>(wireFile),
				turns: readRows<TurnsRow>(turnsFile),
				wireText: existsSync(wireFile) ? readFileSync(wireFile, "utf8") : "",
				seenEfforts,
				advisorContext,
				model,
				rethrew,
				callerPayloadHookRan,
				sawContext,
			};
		},
	);
}

let run: Run;

describe("DIAG-02 — the callModel chokepoint, against its own negative control", () => {
	beforeAll(async () => {
		run = await runFixture();
	});

	it("case 0 — the probe really handed over a live ExtensionContext", () => {
		expect(
			run.sawContext,
			"the user-scope probe never parked an ExtensionContext, so `callModel` was never called " +
				"and every positive case below is asserting over a log nothing wrote. The likeliest " +
				"cause is the extension not loading at all: it must sit at USER scope, because " +
				"project-scoped `.pi/extensions` is gated behind project trust and that resolves false " +
				"headless with no UI to answer the prompt",
		).toBe(true);
	});

	it("case 1 — the negative control: a bare completion is captured by nothing", () => {
		const nestedWire = run.wireAfterControl.filter((r) => (r.kind ?? "").startsWith("nested."));
		const nestedTurns = run.turnsAfterControl.filter((r) => r.kind === "nested");

		expect(
			nestedWire,
			"a bare `complete()` produced nested wire records, which cannot happen through the " +
				"extension hooks: they wire only into the ONE Agent instance's streamFn " +
				"(pi src/core/sdk.ts:294-360), and a nested completion does not go through that agent. " +
				"Either something else in this fixture wrote them, or the control is no longer a bare " +
				"call — and if a bare call IS captured, the chokepoint is solving a problem that does " +
				"not exist and this whole plan is unnecessary",
		).toEqual([]);

		expect(
			nestedTurns,
			"a bare `complete()` produced a nested turns row. Same reasoning as above: with no " +
				"per-call callbacks there is nothing to write one, so this row came from somewhere " +
				"that invalidates the control",
		).toEqual([]);

		// The paired positive: capture is live on the main loop of this very session, so the absences above mean something.
		expect(
			run.wireFileExistedAfterControl,
			"no wire log exists at all, so the two absences above are a pass over a directory the " +
				"extension never wrote to — not evidence about nested calls",
		).toBe(true);

		expect(
			run.wireAfterControl.filter((r) => (r.kind ?? "").startsWith("main.")).map((r) => r.kind),
			"the warm-up prompt's three main-loop records are missing, so capture is not working in " +
				"this session and the absence of nested records says nothing. This is the paired " +
				"positive: the control only means something while the instrument is provably alive",
		).toEqual(["main.headers", "main.request", "main.response"]);
	});

	it("case 2 — the paired positive: one nested row, with a real cost", () => {
		const nested = run.turns.filter((r) => r.kind === "nested" && r.role === "advisor");

		expect(
			nested.length,
			"expected exactly one `kind:\"nested\"` row with role `advisor`. Zero means callModel " +
				"appended nothing and DIAG-02 is unmet; more than one means a call is being " +
				"double-counted, which would inflate every per-role cost figure Phase 8 reports",
		).toBe(1);

		const row = nested[0];

		expect(
			row?.cost?.total,
			"the nested row's cost is not strictly positive. This is NOT a `0 === 0` assertion: " +
				"`fauxProvider` hardcodes `usage.cost` to all zeros (pi-ai src/providers/faux.ts:256-266) " +
				"and the executed research run saw the same all-zero cost come back from a nested call, " +
				"so a positive number here can only come from the defensive `calculateCost` in " +
				"composeTurnRow. Remove that call and this is the assertion that goes red",
		).toBeGreaterThan(0);

		for (const [field, value] of [
			["input", row?.input],
			["output", row?.output],
			["totalTokens", row?.totalTokens],
			["latencyMs", row?.latencyMs],
		] as const) {
			expect(
				typeof value,
				`the nested row's \`${field}\` is not a number. A row missing its token counts is a ` +
					"cost record with no denominator: Phase 8 cannot price it and Phase 10 cannot " +
					"compare it against a main-loop turn",
			).toBe("number");
		}

		expect(
			row?.outcome,
			"a successful nested call must record `outcome: \"ok\"`, derived from the finalized " +
				"message's stopReason rather than from an HTTP status that does not exist on this path",
		).toBe("ok");

		const corr = row?.corr;
		expect(
			typeof corr === "string" && corr.length > 0 && corr !== "uncorrelated",
			"the nested row carries no usable correlation id, so its wire records cannot be found " +
				"from it. callModel issues its own id explicitly for exactly this reason — the main " +
				"loop may have issued one in between, and inheriting it would attribute this call's " +
				"bytes to a different request",
		).toBe(true);

		const forCall = run.wire.filter((r) => r.corr === corr);
		expect(
			forCall.map((r) => r.kind).sort(),
			"the nested call must produce exactly the three wire records its three per-call " +
				"callbacks write, under the same correlation id as its turns row. A missing " +
				"`nested.headers` means `transformHeaders` was not supplied and the nested path " +
				"satisfies only two of DIAG-01's three hooks; a missing `nested.request` means the " +
				"payload capture is not wired",
		).toEqual(["nested.headers", "nested.request", "nested.response"]);

		for (const record of forCall) {
			expect(
				record.role,
				"every wire record must carry the role, or the join between the wire dump and the " +
					"turns log has to go through the correlation id alone and a truncated dump becomes " +
					"unreadable",
			).toBe("advisor");
		}

		const response = forCall.find((r) => r.kind === "nested.response");
		expect(
			response?.status,
			// faux always answers 200 (pi-ai src/providers/faux.ts:510). This asserts
			// that the status REACHED the record, not that the request succeeded.
			"the nested.response record must carry the status `onResponse` reported. faux always " +
				"answers 200, so this is a wiring check and not a real status check",
		).toBe(200);

		expect(
			row?.httpStatus,
			"the turns row must carry the same status the response callback saw. On the nested path " +
				"this is the ONLY way a row can have one at all — `after_provider_response` is not " +
				"wired here",
		).toBe(200);
	});

	it("case 2b — the nested payload was captured, and redacted before it hit disk", () => {
		const corr = run.turns.find((r) => r.kind === "nested" && r.role === "advisor")?.corr;
		const request = run.wire.find((r) => r.corr === corr && r.kind === "nested.request");

		expect(request, "no nested.request record was written for the advisor call").toBeDefined();

		expect(
			request?.payload?.model,
			"the recorded nested payload names a different model from the one the provider was " +
				"called with, so the dump would be describing a request that was never sent",
		).toBe(run.model?.id);

		// On this record, not the file: the warm-up request carries the same credential and is redacted by wire.ts.
		const recordText = JSON.stringify(request);

		expect(
			recordText.includes(SECRET_FIXTURE_TOKEN),
			"a credential planted in the NESTED payload reached the log record in plaintext. The " +
				"nested path has the same exposure as the main one and gets the same redactor, " +
				"applied INSIDE the callback before appendJsonl. [threat T-02-07-02]",
		).toBe(false);

		expect(
			recordText.includes("[redacted:"),
			"nothing in the nested record was redacted, so redactDeep is not being called on this " +
				"path even though the payload carried a bearer-shaped value under an `authorization` key",
		).toBe(true);

		// The paired positive: over-redaction is a failure too, just a quieter one.
		expect(
			recordText.includes(String(run.model?.id)),
			"the model id is absent from the nested record, so a capture that blanked everything " +
				"would satisfy the assertion above and leave a log nobody can read",
		).toBe(true);

		// And the whole-file claim, which is the one that matters for a public repo.
		expect(
			run.wireText.includes(SECRET_FIXTURE_TOKEN),
			"the plaintext credential is somewhere in the wire log. Redaction happens at capture " +
				"because a dump that ever holds a live key on disk in this tree is a breach the moment " +
				"it is written",
		).toBe(false);
	});

	it("case 2c — a caller cannot suppress its own capture", () => {
		// `Api` includes `string & {}` (pi-ai src/types.ts:16), so the compiler accepts a caller `onPayload`; only the
		// spread order stops it.
		expect(
			run.callerPayloadHookRan,
			"a caller-supplied `onPayload` ran. callModel spreads `opts.api` FIRST precisely so its " +
				"own capture overwrites any callback the caller passed; if the caller's hook survives, " +
				"a Phase 5 or Phase 8 call site can make itself invisible to the instrument, which is " +
				"the property DIAG-02 exists to deny. [threat T-02-07-01]",
		).toBe(false);

		const corr = run.turns.find((r) => r.kind === "nested" && r.role === "advisor")?.corr;
		const request = run.wire.find((r) => r.corr === corr && r.kind === "nested.request");

		expect(
			JSON.stringify(request?.payload),
			"the hijacked payload reached the log, so the caller's callback both ran AND replaced " +
				"what was recorded",
		).not.toContain("HIJACKED");
	});

	it("case 3 — the reasoning parameter left the harness", () => {
		expect(
			run.advisorContext,
			"the faux response factory never ran for the advisor call, so there is nothing to read " +
				"the outgoing options off and this case proves nothing",
		).toBeDefined();

		expect(
			run.seenEfforts,
			"the provider did not receive `reasoningEffort: \"high\"` on the nested call. `api` is " +
				"spread into the options object before the capture callbacks are added, so a value " +
				"that does not arrive means the spread was dropped or overwritten — and every " +
				"per-role thinking-level decision Phase 5 makes would silently do nothing. " +
				"THE LIVE HALF OF THIS IS RB-02-01 AND IS OUTSTANDING: this proves the parameter " +
				"leaves the harness, not that DeepSeek V4 Flash honours it",
		).toEqual(["high"]);
	});

	it("case 4 — a provider-surfaced error still produces a row, with the text redacted", () => {
		const nested = run.turns.filter((r) => r.kind === "nested" && r.role === "reviewer");

		expect(
			nested.length,
			"a failed nested call produced no row. An errored turn is the turn most worth reading, " +
				"and every field of the row is sourced from the finalized message precisely so that " +
				"one still exists when the call fails",
		).toBe(1);

		const row = nested[0];

		expect(
			row?.outcome,
			"`stopReason: \"error\"` must map to `outcome: \"error\"` through the table in schema.ts, " +
				"not through a branch chain with a default arm that would swallow a future member",
		).toBe("error");

		expect(
			row?.errorMessage,
			"the failed row carries no errorMessage, so the reason for the failure was dropped and " +
				"the row records that something went wrong without recording what",
		).toBeDefined();

		expect(
			row?.errorMessage?.includes(SECRET_FIXTURE_TOKEN),
			"a credential quoted back by the provider's error text reached the turns log in " +
				"plaintext. Provider error strings routinely echo the request, and this repository is " +
				"public. [threat T-02-07-02]",
		).toBe(false);

		// Paired positive: the non-secret half must survive, or a blanking redactor would pass.
		expect(
			row?.errorMessage?.includes("upstream refused the key"),
			"the non-secret half of the provider's error text was destroyed too. Over-redaction " +
				"leaves a row that says a call failed and nothing about why",
		).toBe(true);
	});

	it("case 5 — a REJECTED completion still produces a row, and the error is rethrown", () => {
		expect(
			run.rethrew,
			"callModel swallowed a rejection. The instrument must not change the behaviour of the " +
				"thing it measures: the caller owns the fallback decision and cannot make it if the " +
				"failure never reaches them",
		).toBe(true);

		const nested = run.turns.filter((r) => r.kind === "nested" && r.role === "rejected");

		expect(
			nested.length,
			"a rejected completion produced no row. On Pi 0.84.1 `lazyStream` converts setup " +
				"failures into an error MESSAGE rather than a rejection, so this branch is defensive " +
				"— which is exactly why it needs a test: nothing else would ever exercise it, and " +
				"untested defensive code is a comment",
		).toBe(1);

		expect(
			nested[0]?.outcome,
			"the synthesised row must record `outcome: \"error\"` — it stands in for a message the " +
				"provider never returned, and claiming anything else would be a fabricated measurement",
		).toBe("error");

		expect(
			nested[0]?.errorMessage?.includes(SECRET_FIXTURE_TOKEN),
			"the rejection's text reached the row unredacted. It is redacted at synthesis so no " +
				"unredacted string is ever held on a row this function composes",
		).toBe(false);

		expect(
			nested[0]?.errorMessage?.includes("registry blew up holding"),
			"the rejection text was blanked entirely, which leaves a row that cannot explain itself",
		).toBe(true);
	});
});
