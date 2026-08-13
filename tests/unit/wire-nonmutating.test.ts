/**
 * DIAG-01 — the capture handlers observe the request; they must never alter it.
 *
 * THE CONTRACT. `before_provider_request` REPLACES the outgoing payload with any
 * non-`undefined` return value:
 *
 *     const handlerResult = await handler(event, ctx);
 *     if (handlerResult !== undefined) { currentPayload = handlerResult; }
 *     [VERIFIED: pi 0.84.1 src/core/extensions/runner.ts:1030-1033]
 *
 * So the difference between a wire inspector and a request corrupter is one
 * pair of braces. Written as `(event, ctx) => appendJsonl(...)` the handler
 * returns the absolute path of the log file, and every request the harness ever
 * makes becomes the string `"C:\\...\\wire-2026-08-13.jsonl"`. RESEARCH Pitfall
 * 2 records the warning sign: a model erroring with "invalid request body"
 * immediately after the diagnostics extension loads. [threat T-02-05-03]
 *
 * NO SESSION IS NEEDED, AND THAT IS THE POINT. `ExtensionAPI` and
 * `ExtensionContext` are plain interfaces, and `registerWireHooks` touches only
 * `pi.on`, `ctx.cwd` and `ctx.sessionManager.getSessionId()`. A recording stub
 * of each drives the REAL registration and the REAL handlers against a real
 * temp filesystem, offline, in milliseconds. The in-session half — do the hooks
 * fire at all, and in what order — is `tests/integration/wire-capture.test.ts`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { describe, expect, it } from "vitest";

import { safeHandler } from "../../.pi/extensions/diagnostics/index.ts";
import { logDir } from "../../.pi/extensions/diagnostics/jsonl.ts";
import { registerWireHooks } from "../../.pi/extensions/diagnostics/wire.ts";
import { withTempLogCwd } from "../helpers/logs.ts";

/** A handler as Pi stores it: event in, context in, anything or nothing out. */
type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

/**
 * Exactly the events `registerWireHooks` is allowed to register.
 *
 * Asserted as a SET EQUALITY rather than a "contains" check, so a fourth hook
 * added by a later plan without a test of its own fails here rather than
 * shipping unasserted.
 */
const EXPECTED_EVENTS = [
	"before_provider_headers",
	"before_provider_request",
	"after_provider_response",
] as const;

/** Register the wire hooks against a recording stub and hand back the handlers. */
function registerAgainstStub(): { handlers: Map<string, Handler>; rows: () => number } {
	const handlers = new Map<string, Handler>();
	let rows = 0;

	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, handler);
		},
	} as unknown as ExtensionAPI;

	registerWireHooks(pi, safeHandler, () => {
		rows += 1;
	});

	return { handlers, rows: () => rows };
}

/** A context carrying only what the wire handlers actually read. */
function fakeCtx(cwd: string, sessionId = "sess-unit"): ExtensionContext {
	return {
		cwd,
		sessionManager: { getSessionId: () => sessionId },
	} as unknown as ExtensionContext;
}

/** A realistic-enough outgoing payload: a model id and a couple of messages. */
function samplePayload(): Record<string, unknown> {
	return {
		model: "faux-flash",
		messages: [
			{ role: "system", content: "be terse" },
			{ role: "user", content: "hello" },
		],
		stream: true,
	};
}

describe("registerWireHooks — what it registers", () => {
	it("registers exactly the three provider hooks and nothing else", () => {
		const { handlers } = registerAgainstStub();

		expect(
			handlers.size,
			"no handler was recorded at all, so every assertion in this file that pulls a handler out " +
				"of the map would silently skip. Assert the map is populated before asserting anything " +
				"about its contents",
		).toBeGreaterThan(0);

		expect(
			[...handlers.keys()].sort(),
			"the registered set must be exactly the three provider hooks. A fourth hook added by a " +
				"later plan should fail here and be given its own assertions, rather than shipping " +
				"unasserted behind a `contains` check that could not notice it",
		).toEqual([...EXPECTED_EVENTS].sort());
	});
});

describe("before_provider_request — the handler must not replace the payload", () => {
	it("returns undefined", async () => {
		await withTempLogCwd(async (cwd) => {
			const { handlers } = registerAgainstStub();
			const handler = handlers.get("before_provider_request");
			expect(handler, "the payload hook was never registered").toBeDefined();

			const result = await handler?.(
				{ type: "before_provider_request", payload: samplePayload() },
				fakeCtx(cwd),
			);

			expect(
				result,
				"the handler returned a value. Any non-undefined return REPLACES the payload for every " +
					"later handler and for the actual request (runner.ts:1031-1033) — the harness would " +
					"be sending the log writer's return value to the model instead of the prompt",
			).toBeUndefined();
		});
	});

	it("leaves the payload object byte-identical", async () => {
		await withTempLogCwd(async (cwd) => {
			const { handlers } = registerAgainstStub();
			const payload = samplePayload();
			const before = JSON.stringify(payload);

			await handlers.get("before_provider_request")?.(
				{ type: "before_provider_request", payload },
				fakeCtx(cwd),
			);

			expect(
				JSON.stringify(payload),
				"the capture path mutated the live payload in place. `redactDeep` returns a NEW " +
					"structure precisely so this cannot happen; assigning its result back onto " +
					"`event.payload` would ship redacted placeholders to the model. RESEARCH Pitfall 2's " +
					"warning sign is a model erroring with `invalid request body` the moment the " +
					"diagnostics extension loads",
			).toBe(before);
		});
	});

	it("still writes the record it was there to write", async () => {
		// Without this, a handler that did nothing at all would satisfy both
		// assertions above perfectly.
		await withTempLogCwd(async (cwd) => {
			const { handlers, rows } = registerAgainstStub();

			await handlers.get("before_provider_request")?.(
				{ type: "before_provider_request", payload: samplePayload() },
				fakeCtx(cwd),
			);

			expect(
				rows(),
				"the rows-written counter did not move, so the handler returned undefined and left the " +
					"payload alone by doing nothing whatsoever — which every other assertion here would " +
					"happily accept",
			).toBe(1);
		});
	});
});

describe("before_provider_headers — mutate nothing, return nothing", () => {
	it("returns undefined and neither adds nor deletes a key", async () => {
		await withTempLogCwd(async (cwd) => {
			const { handlers } = registerAgainstStub();
			const headers: Record<string, string | null> = {
				authorization: "Bearer not-a-real-token-0123456789",
				"user-agent": "pi/0.84.1",
				"proxy-authorization": null,
			};
			const keysBefore = Object.keys(headers).sort();
			const valuesBefore = JSON.stringify(headers);

			const result = await handlers.get("before_provider_headers")?.(
				{ type: "before_provider_headers", headers },
				fakeCtx(cwd),
			);

			expect(
				result,
				"Pi ignores this hook's return value (runner.ts:1059-1064), but the handler is written " +
					"in the same shape as its two siblings on purpose — a reader must never have to " +
					"remember which of the three is safe to return from",
			).toBeUndefined();

			expect(
				Object.keys(headers).sort(),
				"the handler changed the header key set. This hook mutates IN PLACE, so a capture path " +
					"that touched the map would be rewriting the real request's headers — deleting an " +
					"`authorization` here logs the operator out of their provider",
			).toEqual(keysBefore);

			expect(
				JSON.stringify(headers),
				"the handler rewrote a header VALUE. `redactHeaders` returns a new map so that the " +
					"redacted copy goes to disk and the live credential goes to the provider; swapping " +
					"those two is the difference between a dump and an outage",
			).toBe(valuesBefore);
		});
	});
});

describe("a failing append is swallowed, not propagated", () => {
	it("does not throw and still returns undefined", async () => {
		await withTempLogCwd(async (cwd) => {
			// Make the log directory un-creatable: plant a FILE where `logDir(cwd)`
			// wants a directory, so `mkdirSync` inside `appendJsonl` throws ENOTDIR
			// / EEXIST. This exercises the real failure path rather than a mocked
			// one, on both Windows and POSIX.
			const dir = logDir(cwd);
			mkdirSync(join(dir, ".."), { recursive: true });
			writeFileSync(dir, "not a directory", "utf-8");

			const { handlers, rows } = registerAgainstStub();
			const payload = samplePayload();

			const result = await handlers.get("before_provider_request")?.(
				{ type: "before_provider_request", payload },
				fakeCtx(cwd),
			);

			expect(
				rows(),
				"the append SUCCEEDED, so this test proved nothing: `noteRow` runs only after " +
					"`appendJsonl` returns, and a moved counter means the sabotage above no longer makes " +
					"the write fail. Fix the fixture rather than deleting the assertion",
			).toBe(0);

			expect(
				result,
				"a diagnostics failure must resolve to undefined like any other run of the handler. " +
					"Returning something on the error path would replace the payload — the instrument " +
					"would break the very request it failed to record",
			).toBeUndefined();

			expect(
				JSON.stringify(payload),
				"the payload must survive a failed capture untouched",
			).toBe(JSON.stringify(samplePayload()));
		});
	});
});
