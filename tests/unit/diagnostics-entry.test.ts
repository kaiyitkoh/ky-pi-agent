/**
 * The diagnostics extension cannot fail silently: Pi routes a handler exception to emitError, which shows nothing
 * (pi src/core/extensions/runner.ts:861-870), so a throwing handler must leave a diagnostics.error row. Recording stubs
 * of `pi.on` and `ctx.cwd` drive the real handlers against a temp filesystem, with no session.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { describe, expect, it } from "vitest";

import { BUDGET_COMMAND_NAME } from "../../.pi/extensions/diagnostics/budget.ts";
import diagnostics, {
	ROWS_WRITTEN_KEY,
	SESSION_START_EVENT,
	noteRowWritten,
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

	it("coerces a handler's null return to undefined so it cannot replace a provider payload", async () => {
		await withTempLogCwd(async (cwd) => {
			// before_provider_request's result is `unknown`, so `null` is a well-typed return, and the runner replaces the
			// payload on anything not undefined (pi dist/core/extensions/runner.js:789-792): the coercion is load-bearing.
			const wrapped = safeHandler<undefined, null>("null_probe", () => null);

			const returned = await wrapped(undefined, fakeCtx(cwd));

			expect(
				returned,
				"the wrapper must coerce `null` to `undefined`. `null` here means a `return match ?? null` " +
					"anywhere inside a wrapped `before_provider_request` handler sets the real outgoing " +
					"request body to `null`, and nothing anywhere would report it",
			).toBeUndefined();

			// Pi's replacement rule (runner.js:789-792) applied to the wrapper's result: asserts the consequence, not the value.
			const realPayload = { model: "deepseek-chat", messages: [{ role: "user" }] };
			let currentPayload: unknown = realPayload;
			if (returned !== undefined) {
				currentPayload = returned;
			}

			expect(
				currentPayload,
				"under the runner's own `if (handlerResult !== undefined) currentPayload = handlerResult` " +
					"(pi 0.84.1 dist/core/extensions/runner.js:789-792), a `null` escaping the wrapper " +
					"REPLACES the outgoing provider request body. This is the one catastrophe wire.ts:26-40 " +
					"is built around",
			).toBe(realPayload);

			expect(
				logFilesIn(logDir(cwd)),
				"and returning null is not a failure, so no error row may be written",
			).toEqual([]);
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

describe("the rows-written counter is per PROCESS, not per module instance", () => {
	/**
	 * jiti gives each import graph its own copy of a module, so a module-level counter would miss nested-call rows
	 * written by another copy. A second instance cannot be made portably, so the shared globalThis slot is asserted
	 * directly, through the imported key.
	 */
	const scope = globalThis as Record<string, unknown>;

	it("increments a slot on globalThis that an outside reader can see", () => {
		const before = rowsWrittenThisSession();
		noteRowWritten();

		expect(
			scope[ROWS_WRITTEN_KEY],
			"the count must be observable from outside this module. A module-level `let` is invisible " +
				"here, and invisible to Pi's own instance of the module the moment jiti hands a second " +
				"copy to an importing extension",
		).toBe(before + 1);

		expect(
			rowsWrittenThisSession(),
			"and the reader must agree with the slot; two numbers that can disagree are worse than one",
		).toBe(before + 1);
	});

	it("reads a count written by something that is not this module instance", () => {
		// The direction /budget needs: rows another module copy appended show up in this instance's number.
		const planted = rowsWrittenThisSession() + 17;
		scope[ROWS_WRITTEN_KEY] = planted;

		expect(
			rowsWrittenThisSession(),
			"a row counted elsewhere in the process must be visible here. `/budget` runs in Pi's " +
				"instance and reports this number, so a counter only some append paths reach reports a " +
				"figure that looks like a measurement and is not",
		).toBe(planted);

		// And the tolerant read, so a fresh process is 0 rather than a crash.
		delete scope[ROWS_WRITTEN_KEY];
		expect(
			rowsWrittenThisSession(),
			"an unset slot must read as 0. `/budget` prints this on the first turn of every session, " +
				"and NaN or undefined there would be a report about the instrument rather than the run",
		).toBe(0);
	});
});

describe("the extension entry point registers session_start and prunes there", () => {
	it("registers session_start plus the wire hooks, and running it writes the row", async () => {
		await withTempLogCwd(async (cwd) => {
			const registered: string[] = [];
			const commands: string[] = [];
			const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();

			// The entry point also registers /budget; without registerCommand on the stub it would throw a TypeError first.
			const pi = {
				on(event: string, fn: (e: unknown, c: ExtensionContext) => unknown) {
					registered.push(event);
					handlers.set(event, fn);
				},
				registerCommand(name: string) {
					commands.push(name);
				},
			} as unknown as ExtensionAPI;

			diagnostics(pi);

			const handler = handlers.get("session_start");

			expect(
				registered,
				"retention runs at session start because it is cheap, deterministic and off the hot " +
					"path (RESEARCH §10.5); plan 02-05 added the three main-loop provider hooks " +
					"(DIAG-01/DIAG-07) beside it, plan 02-08 the three turn hooks (DIAG-04), and plan " +
					"02-09 `agent_start`, which resets the per-run prose-retry budget (DIAG-05). If " +
					"this list changes, a later plan in this phase is adding hooks and this assertion " +
					"should grow with them — not be deleted. The wire hooks' own non-mutating contract " +
					"is asserted in tests/unit/wire-nonmutating.test.ts, the turn row itself in " +
					"tests/integration/turns-log.test.ts, and the prose retry in " +
					"tests/integration/prose-retry.test.ts. `after_provider_response` is registered for " +
					"the WIRE dump only: no field of a turns row may be derived from it, because it " +
					"never fires on a provider error (RESEARCH §3.2, Pitfall 3). A NINTH entry named " +
					"`before_provider_request` appearing twice would mean the `tool_choice: \"required\"` " +
					"lever has been switched on, which is unmeasured on DeepSeek",
			).toEqual([
				"session_start",
				"before_provider_headers",
				"before_provider_request",
				"after_provider_response",
				"turn_start",
				"message_end",
				"turn_end",
				"agent_start",
			]);

			expect(
				commands,
				"the diagnostics subsystem registers exactly one command, `/budget` (DIAG-06), and " +
					"nothing else. It is a COMMAND deliberately: a command costs zero per-turn tokens " +
					"while the other kind of registration serialises a full JSON Schema into every " +
					"provider request, so a report ABOUT per-turn token cost would become one " +
					"[threat T-02-10-05]. `tests/unit/contributing-boundary.test.ts` holds the " +
					"complementary negative half across all of `.pi/extensions/`",
			).toEqual([BUDGET_COMMAND_NAME]);

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
