/**
 * DIAG-02 — a diagnostics write failure must not break, or discard, the real
 * nested model call.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * `tests/unit/wire-nonmutating.test.ts:216-255` proves the MAIN-LOOP half: with
 * a file planted where `logDir(cwd)` wants a directory, `appendJsonl` throws
 * `ENOTDIR`/`EEXIST`, `safeHandler` swallows it, and the outgoing payload
 * survives untouched. There was no counterpart for the nested path, and the
 * nested path is the one where a throw is worse than a lost record:
 *
 *   - `transformHeaders` runs inside `ModelRuntime.prepareRequest`
 *     [VERIFIED: pi 0.84.1 src/core/model-runtime.ts:590-593], so a throw there
 *     becomes a `createSetupErrorMessage` and the completion FAILS;
 *   - `onPayload` throws straight into the adapter and kills the request;
 *   - the SUCCESS-path turns row is appended after the provider has already
 *     billed for an `AssistantMessage`, so a throw there discards a message that
 *     was paid for and hands the caller a filesystem error instead — and
 *     `call-model.ts` says the caller "owns the fallback decision", so it would
 *     then retry or downgrade because a disk was full.
 *
 * ---------------------------------------------------------------------------
 * WHY A STUB REGISTRY AND NOT THE LIVE SESSION
 * ---------------------------------------------------------------------------
 * `tests/integration/call-model.test.ts` drives the real thing, but it does so
 * through ONE shared fixture whose later cases all read the same log files.
 * Sabotaging `logDir(cwd)` inside that session would break every case after it,
 * so the sabotage needs its own working directory. `callModel` reads exactly four
 * things off its context — `cwd`, `sessionManager.getSessionId()`, `signal` and
 * `modelRegistry.complete` — and the completion is the only one that has to
 * behave, so a recording stub drives the REAL function against a REAL sabotaged
 * filesystem, offline, in milliseconds.
 *
 * The stub deliberately INVOKES all three capture callbacks in the order the
 * real adapter does. Without that, a containment bug in `transformHeaders` or
 * `onPayload` would never be reached and this file would prove only that the
 * turns-row append is contained.
 *
 * ---------------------------------------------------------------------------
 * THE PAIRED POSITIVE IS MANDATORY HERE
 * ---------------------------------------------------------------------------
 * "callModel returned its message and no records were written" is satisfied
 * perfectly by a `callModel` that records nothing at all, ever. So the same
 * fixture runs twice: once with `logDir(cwd)` sabotaged and once without. The
 * healthy run must produce the three wire records and the one turns row, and the
 * counter must move; the sabotaged run must produce neither and must leave the
 * counter still. Either half alone proves nothing.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Api, AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { describe, expect, it } from "vitest";

import { callModel } from "../../.pi/extensions/diagnostics/call-model.ts";
import { rowsWrittenThisSession } from "../../.pi/extensions/diagnostics/index.ts";
import { logDir, logPath } from "../../.pi/extensions/diagnostics/jsonl.ts";
import {
	TURNS_LOG_BASE,
	WIRE_LOG_BASE,
	type WireKind,
} from "../../.pi/extensions/diagnostics/schema.ts";
import { readJsonl, withTempLogCwd } from "../helpers/logs.ts";

/** The text the stub's assistant message carries, so the return value is identifiable. */
const ANSWER = "the nested call really completed";

/** Cost rates matching `tests/helpers/session.ts`, so a cost is a real number offline. */
const RATES = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } as const;

/** A `Usage` carrying faux's all-zero `cost`, which `composeTurnRow` recomputes. */
function makeUsage(): Usage {
	return {
		input: 1000,
		output: 500,
		cacheRead: 300,
		cacheWrite: 200,
		totalTokens: 2000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

/** The model the stub is called with. Only the fields the composer reads matter. */
function makeModel(): Model<Api> {
	return {
		id: "faux-flash",
		name: "faux-flash",
		api: "openai-completions",
		provider: "faux",
		baseUrl: "",
		reasoning: true,
		input: ["text"],
		cost: { ...RATES },
		contextWindow: 128_000,
		maxTokens: 8192,
	};
}

/** The finalized message the stub resolves with. */
function makeMessage(): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: ANSWER }],
		api: "openai-completions",
		provider: "faux",
		model: "faux-flash",
		usage: makeUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

/** What the capture callbacks the stub invoked were handed. */
interface CallbackInvocations {
	transformHeadersReturned: Record<string, string | null> | undefined;
	onPayloadReturned: unknown;
	invoked: string[];
}

/**
 * A context whose `modelRegistry.complete` drives the three capture callbacks in
 * the adapter's own order, then resolves with {@link makeMessage}.
 *
 * The headers map carries a bearer-shaped value so the redactor has something to
 * do on the way to disk — a capture path that is contained but does nothing
 * would otherwise be indistinguishable from one that works.
 */
function fakeCtx(cwd: string, seen: CallbackInvocations): ExtensionContext {
	return {
		cwd,
		signal: undefined,
		sessionManager: { getSessionId: () => "sess-containment" },
		modelRegistry: {
			complete: async (
				_model: unknown,
				_context: unknown,
				options: Record<string, unknown>,
			): Promise<AssistantMessage> => {
				const transformHeaders = options.transformHeaders as
					| ((h: Record<string, string | null>) => Record<string, string | null>)
					| undefined;
				const onPayload = options.onPayload as ((p: unknown) => unknown) | undefined;
				const onResponse = options.onResponse as
					| ((r: { status: number; headers: Record<string, string> }) => void)
					| undefined;

				if (transformHeaders !== undefined) {
					seen.invoked.push("transformHeaders");
					seen.transformHeadersReturned = transformHeaders({
						authorization: ["Bearer", "abcdefghij.klmno-pqrst"].join(" "),
						"user-agent": "pi/0.84.1",
					});
				}
				if (onPayload !== undefined) {
					seen.invoked.push("onPayload");
					seen.onPayloadReturned = onPayload({ model: "faux-flash", messages: [] });
				}
				if (onResponse !== undefined) {
					seen.invoked.push("onResponse");
					onResponse({ status: 200, headers: { "x-request-id": "abc" } });
				}
				return makeMessage();
			},
		},
	} as unknown as ExtensionContext;
}

/** A wire record as this file reads it back. */
interface WireRow {
	kind?: WireKind;
	role?: string;
}

/** What one run of the fixture produced. */
interface RunResult {
	returned: string | undefined;
	threw: unknown;
	wireKinds: (WireKind | undefined)[];
	turnsRows: number;
	rowsDelta: number;
	seen: CallbackInvocations;
}

/**
 * Drive one `callModel` against a fresh temp cwd, optionally sabotaged.
 *
 * `sabotage` plants a FILE where `logDir(cwd)` wants a directory, exactly as
 * `wire-nonmutating.test.ts` does, so `mkdirSync` inside `appendJsonl` fails for
 * real on both Windows and POSIX rather than through a mock.
 */
async function run(sabotage: boolean): Promise<RunResult> {
	return await withTempLogCwd(async (cwd) => {
		if (sabotage) {
			const dir = logDir(cwd);
			mkdirSync(join(dir, ".."), { recursive: true });
			writeFileSync(dir, "not a directory", "utf-8");
		}

		const seen: CallbackInvocations = {
			transformHeadersReturned: undefined,
			onPayloadReturned: undefined,
			invoked: [],
		};
		const before = rowsWrittenThisSession();

		let returned: string | undefined;
		let threw: unknown;
		try {
			const message = await callModel(fakeCtx(cwd, seen), {
				role: "advisor",
				model: makeModel(),
				messages: [{ role: "user", content: "advise", timestamp: Date.now() }],
			});
			const first = message.content[0];
			returned = first !== undefined && first.type === "text" ? first.text : undefined;
		} catch (error) {
			threw = error;
		}

		// `existsSync` on the exact paths rather than a directory listing: in the
		// sabotaged run `logDir(cwd)` IS a file, so `readdirSync` on it throws
		// ENOTDIR and the fixture would fail with a stack trace instead of the
		// assertion it exists to make.
		const wirePath = logPath(cwd, WIRE_LOG_BASE);
		const turnsPath = logPath(cwd, TURNS_LOG_BASE);

		return {
			returned,
			threw,
			wireKinds: existsSync(wirePath)
				? (readJsonl(wirePath) as WireRow[]).map((r) => r.kind)
				: [],
			turnsRows: existsSync(turnsPath) ? readJsonl(turnsPath).length : 0,
			rowsDelta: rowsWrittenThisSession() - before,
			seen,
		};
	});
}

describe("DIAG-02 — the healthy nested path, so the sabotaged one below means something", () => {
	it("writes three wire records and one turns row, and counts all four", async () => {
		const healthy = await run(false);

		expect(
			healthy.threw,
			"the unsabotaged fixture must not throw at all; if it does, the sabotaged case below is " +
				"comparing two failures rather than a failure against a success",
		).toBeUndefined();

		expect(
			healthy.seen.invoked,
			"the stub must have driven all three capture callbacks, in the adapter's order. Without " +
				"that, a containment bug in transformHeaders or onPayload is unreachable and the " +
				"sabotaged case below would only be exercising the turns-row append",
		).toEqual(["transformHeaders", "onPayload", "onResponse"]);

		expect(
			healthy.wireKinds,
			"the three per-call callbacks each write one record. A missing `nested.headers` means " +
				"`transformHeaders` was not supplied; a missing `nested.request` means the payload " +
				"capture is not wired",
		).toEqual(["nested.headers", "nested.request", "nested.response"]);

		expect(healthy.turnsRows, "one nested call is exactly one turns row").toBe(1);

		expect(
			healthy.rowsDelta,
			"`noteRowWritten` runs once per successful append, so four records is a delta of four. " +
				"`/budget` prints this number and it has to match the file",
		).toBe(4);

		expect(
			healthy.returned,
			"callModel must return the provider's own finalized message unchanged",
		).toBe(ANSWER);
	});
});

describe("DIAG-02 — a diagnostics write failure is swallowed, not propagated", () => {
	it("still returns the already-billed message when nothing can reach disk", async () => {
		const broken = await run(true);

		// FIRST, prove the sabotage worked. Without this the two absences below are a
		// pass over a directory the writer simply had no trouble with, and the whole
		// file would go green the day the fixture stopped breaking anything.
		expect(
			broken.rowsDelta,
			"the appends SUCCEEDED, so this test proved nothing: `noteRowWritten` runs only after " +
				"`appendJsonl` returns, and a moved counter means the file planted at logDir(cwd) no " +
				"longer makes the write fail. Fix the fixture rather than deleting the assertion",
		).toBe(0);

		expect(
			broken.threw,
			"callModel propagated a FILESYSTEM error to the caller. The provider had already " +
				"answered and had already billed for the completion; throwing here discards a message " +
				"that was paid for and, because the caller owns the fallback decision, makes it retry " +
				"or downgrade a model because a disk was full. [threat T-02-07-03]",
		).toBeUndefined();

		expect(
			broken.returned,
			"the finalized message must reach the caller intact. This is the assertion that goes red " +
				"if the try/catch in `contained`/`recordTurn` is removed",
		).toBe(ANSWER);

		expect(
			broken.seen.transformHeadersReturned,
			"`transformHeaders` is a TRANSFORM: whatever it returns is what gets signed and sent. It " +
				"must return the LIVE map even when its capture failed — returning undefined would " +
				"strip every header off the request, and returning the redacted copy would send " +
				"`[redacted:N chars]` as the bearer token",
		).toEqual({
			authorization: ["Bearer", "abcdefghij.klmno-pqrst"].join(" "),
			"user-agent": "pi/0.84.1",
		});

		expect(
			broken.seen.onPayloadReturned,
			"`onPayload` must still return undefined on the failure path. A non-undefined return " +
				"REPLACES the outgoing payload [VERIFIED: pi-ai src/types.ts:66-70], so an error path " +
				"that leaked a value would corrupt the very request it failed to record",
		).toBeUndefined();

		expect(
			broken.wireKinds,
			"no wire record can exist: the log directory is a file. A record here means the sabotage " +
				"is being routed somewhere else",
		).toEqual([]);

		expect(broken.turnsRows, "and no turns row either, for the same reason").toBe(0);
	});
});
