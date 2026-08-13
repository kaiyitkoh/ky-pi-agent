/**
 * The diagnostics extension cannot fail silently. [threats T-02-03-05, T-02-03-06]
 *
 * NOT IN PLAN 02-03's FILE LIST, AND ADDED ANYWAY. The plan's own success
 * criteria include "a throwing diagnostics handler leaves a `diagnostics.error`
 * row instead of vanishing", and nothing in the listed files asserts it. That
 * claim is the whole reason `safeHandler` exists, so shipping it unasserted
 * would be a green tick over the exact behaviour the phase is about.
 *
 * WHY IT MATTERS. Pi catches every exception thrown by an extension handler and
 * routes it to `emitError`, which produces no visible output
 * [VERIFIED: pi 0.84.1 src/core/extensions/runner.ts:861-870 — observed live
 * during Phase 2 research, where a bad regex produced no error anywhere until a
 * local try/catch was added]. An instrument that dies that way looks exactly
 * like an instrument with nothing to report.
 *
 * NO SESSION IS NEEDED. `ExtensionAPI` and `ExtensionContext` are plain
 * interfaces, and the only members this file's code touches are `pi.on` and
 * `ctx.cwd`. A recording stub of each exercises the real registration and the
 * real handler against a real temp filesystem, offline, in milliseconds. The
 * in-session behaviour is plan 02-05's integration test; this is the unit half.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { describe, expect, it } from "vitest";

import diagnostics, {
	SESSION_START_EVENT,
	rowsWrittenThisSession,
	safeHandler,
} from "../../.pi/extensions/diagnostics/index.ts";
import { logDir, logPath } from "../../.pi/extensions/diagnostics/jsonl.ts";
import {
	DIAGNOSTICS_ERROR_EVENT,
	TURNS_LOG_BASE,
} from "../../.pi/extensions/diagnostics/schema.ts";
import { SECRET_FIXTURE_TOKEN } from "../helpers/faux.ts";
import { logFilesIn, readJsonl, withTempLogCwd } from "../helpers/logs.ts";

/** The shape of a row this file asserts on. */
interface ErrorRow {
	event?: string;
	where?: string;
	error?: string;
	prunedFiles?: number;
}

/** A context carrying only what the diagnostics handlers actually read. */
function fakeCtx(cwd: string): ExtensionContext {
	return { cwd } as unknown as ExtensionContext;
}

/** Read every row of the turns log for `cwd`, strictly. */
function turnsRows(cwd: string): ErrorRow[] {
	return readJsonl(logPath(cwd, TURNS_LOG_BASE)) as ErrorRow[];
}

describe("safeHandler — a throwing handler leaves a row instead of vanishing", () => {
	it("writes a diagnostics.error row naming the handler, and does not rethrow", async () => {
		await withTempLogCwd(async (cwd) => {
			const before = rowsWrittenThisSession();

			const wrapped = safeHandler<{ n: number }>("unit_probe", () => {
				throw new Error("deliberate failure inside a diagnostics handler");
			});

			// Must not reject: rethrowing hands the exception straight back to the
			// swallowing path this wrapper exists to escape.
			const result = await wrapped({ n: 1 }, fakeCtx(cwd));
			expect(
				result,
				"the catch path must resolve to undefined. Several Pi hooks treat any non-undefined " +
					"return as a REPLACEMENT for the request being hooked (runner.ts:1031-1033), so a " +
					"wrapper that invented a value on failure could silently rewrite every provider call",
			).toBeUndefined();

			const rows = turnsRows(cwd);
			expect(
				rows.length,
				"exactly one row must have been written. Zero means the exception vanished — the " +
					"failure this whole wrapper exists to prevent, and the one that makes a dead " +
					"instrument indistinguishable from a quiet session",
			).toBe(1);

			expect(
				rows[0]?.event,
				`the row must carry ${DIAGNOSTICS_ERROR_EVENT} so a reader grepping the turns log for ` +
					"diagnostics failures finds it without knowing what broke",
			).toBe(DIAGNOSTICS_ERROR_EVENT);

			expect(
				rows[0]?.where,
				"the row must name the handler. Without it the operator knows the instrument failed " +
					"but not which hook, which is barely better than silence",
			).toBe("unit_probe");

			expect(
				rows[0]?.error,
				"the row must carry the message, or it records that something failed without recording " +
					"anything about what",
			).toContain("deliberate failure inside a diagnostics handler");

			expect(
				rowsWrittenThisSession(),
				"the rows-written counter must move. `/budget` reports it so that `0 rows` is something " +
					"an operator SEES rather than infers from a file they never opened",
			).toBe(before + 1);
		});
	});

	it("redacts a credential quoted by the exception message", async () => {
		await withTempLogCwd(async (cwd) => {
			const wrapped = safeHandler<undefined>("redaction_probe", () => {
				// An exception message routinely quotes the input that caused it,
				// and that input may be a `.env` the model has just read.
				throw new Error(`request failed with authorization Bearer ${SECRET_FIXTURE_TOKEN}`);
			});

			await wrapped(undefined, fakeCtx(cwd));

			const error = turnsRows(cwd)[0]?.error ?? "";
			expect(
				error.includes(SECRET_FIXTURE_TOKEN),
				"the error row reached disk with the credential intact. The diagnostics error path is " +
					"the one place redaction is easiest to forget, because nobody plans for the message " +
					"an exception happens to carry",
			).toBe(false);
			expect(
				error,
				"the surrounding message must survive; a redactor that blanked the whole string would " +
					"pass the assertion above while destroying the diagnostic",
			).toContain("request failed");
		});
	});

	it("passes a successful handler's return value through untouched", async () => {
		await withTempLogCwd(async (cwd) => {
			const wrapped = safeHandler<undefined, { messages: number }>("passthrough_probe", () => ({
				messages: 3,
			}));

			expect(
				await wrapped(undefined, fakeCtx(cwd)),
				"hooks such as `context` and `before_agent_start` have a real return contract. A " +
					"wrapper that swallowed the success value would break them the moment one is wrapped",
			).toEqual({ messages: 3 });

			expect(
				logFilesIn(logDir(cwd)),
				"a handler that did not throw must leave no error row and, here, no log file at all",
			).toEqual([]);
		});
	});
});

describe("the extension entry point registers session_start and prunes there", () => {
	it("registers session_start plus the wire hooks, and running it writes the row", async () => {
		await withTempLogCwd(async (cwd) => {
			const registered: string[] = [];
			const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();

			const pi = {
				on(event: string, fn: (e: unknown, c: ExtensionContext) => unknown) {
					registered.push(event);
					handlers.set(event, fn);
				},
			} as unknown as ExtensionAPI;

			diagnostics(pi);

			const handler = handlers.get("session_start");

			expect(
				registered,
				"retention runs at session start because it is cheap, deterministic and off the hot " +
					"path (RESEARCH §10.5); plan 02-05 added the three main-loop provider hooks " +
					"(DIAG-01/DIAG-07) beside it, and plan 02-08 the three turn hooks (DIAG-04). If " +
					"this list changes, a later plan in this phase is adding hooks and this assertion " +
					"should grow with them — not be deleted. The wire hooks' own non-mutating contract " +
					"is asserted in tests/unit/wire-nonmutating.test.ts, and the turn row itself in " +
					"tests/integration/turns-log.test.ts. `after_provider_response` is registered for " +
					"the WIRE dump only: no field of a turns row may be derived from it, because it " +
					"never fires on a provider error (RESEARCH §3.2, Pitfall 3)",
			).toEqual([
				"session_start",
				"before_provider_headers",
				"before_provider_request",
				"after_provider_response",
				"turn_start",
				"message_end",
				"turn_end",
			]);

			expect(
				handler,
				"a registration that captured no function would make every assertion below unreachable",
			).toBeDefined();

			await handler?.({ type: "session_start", reason: "startup" }, fakeCtx(cwd));

			const rows = turnsRows(cwd);
			expect(
				rows.length,
				"session start must leave a row. It is the heartbeat that tells a reader the instrument " +
					"was alive at all during a session that recorded nothing else",
			).toBe(1);
			expect(rows[0]?.event, "the row identifies itself as the session-start heartbeat").toBe(
				SESSION_START_EVENT,
			);
			expect(
				rows[0]?.prunedFiles,
				"the pruned-file count is the visible output of retention; a fresh log directory prunes " +
					"nothing, and reporting that explicitly is how a later non-zero becomes meaningful",
			).toBe(0);
		});
	});
});
