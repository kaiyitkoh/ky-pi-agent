/**
 * ky-pi-agent — Phase 2 diagnostics extension.
 *
 * PURPOSE. This subsystem is the instrument. Everything downstream of Phase 2 —
 * routing (Phase 5), the quality gates (Phase 8), the root-cause discrimination
 * (Phase 10) — is a decision made on numbers, and until those numbers exist on
 * disk every one of them is a guess. This file is where the hooks that produce
 * them are registered.
 *
 * LIFETIME. Permanent. It grows across this phase: plan 02-05 added the wire
 * capture, 02-06 adds the turn rows, 02-09 the prose-tool-call retry and 02-08
 * the `/budget` command. Today it registers `session_start` plus the three
 * main-loop provider hooks.
 *
 * BOUNDARY RULE (BOOT-10). This subsystem registers **commands and event hooks
 * only**. It must never register a tool. A tool's name, description and
 * complete JSON Schema are serialised into `tools[]` on every single provider
 * request [VERIFIED: pi-ai 0.84.1 src/api/openai-completions.ts:1337-1370],
 * so a diagnostic tool would tax every turn of the cheap model this whole
 * project exists to make reliable — the instrument would become the thing it is
 * measuring. A command costs exactly zero per-turn tokens. This file therefore
 * does not spell the tool-registration call even in prose, the same dodge
 * `harness/index.ts:36` uses, because
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`, comments
 * included.
 *
 * LAYOUT. Sibling modules, and the requirement each serves:
 *
 *   schema.ts   — row types and every literal a test asserts on. DIAG-04/08.
 *   jsonl.ts    — the append-only writer, rotation and retention.   DIAG-08.
 *   redact.ts   — credential redaction at capture time.             DIAG-07.
 *   wire.ts     — the three main-loop provider hooks: capture,
 *                 redact, append. Redaction happens INSIDE the hook,
 *                 which is what makes DIAG-07's "at capture time"
 *                 true rather than aspirational.               DIAG-01/07.
 *   prose.ts    — the prose-tool-call predicate (effect is 02-09). DIAG-05.
 *
 * Only this file is an entry point: `.pi/extensions/<dir>/index.ts` is one of
 * the four auto-discovered shapes [CITED: pi 0.84.1 docs/extensions.md:115-120]
 * and the documented precondition for `/reload` hot-reload. The siblings carry
 * no default export, which is exactly what
 * `tests/unit/extension-layout.test.ts` uses to tell a module from an entry
 * point.
 *
 * FAILING LOUDLY IS NOT AUTOMATIC HERE. Pi catches every exception thrown by an
 * extension handler and routes it to `emitError`, which produces no visible
 * output [VERIFIED: pi 0.84.1 src/core/extensions/runner.ts:861-870 — observed
 * live during Phase 2 research, where a bad regex produced no error anywhere
 * until a local try/catch was added]. A diagnostics extension that dies that
 * way looks identical to a quiet one: the log simply stops. {@link safeHandler}
 * and {@link rowsWrittenThisSession} exist for that single reason.
 */
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

import { appendJsonl, pruneLogs } from "./jsonl.ts";
import { redactString } from "./redact.ts";
import { DIAGNOSTICS_ERROR_EVENT, TURNS_LOG_BASE } from "./schema.ts";
import { registerWireHooks } from "./wire.ts";

/**
 * `event` value on the row written once per session start.
 *
 * Exported so a test imports it rather than re-typing the literal — the house
 * rule from `harness/index.ts:50-56`.
 */
export const SESSION_START_EVENT = "diagnostics.session_start";

/** Rows this process has written. Read through {@link rowsWrittenThisSession}. */
let rowsWritten = 0;

/**
 * How many diagnostic rows this process has written.
 *
 * `/budget` (plan 02-08) reports this number so that "0 rows" is something a
 * reader SEES rather than something they infer from an empty file they never
 * thought to open. A silently dead instrument is indistinguishable from a quiet
 * session, and that ambiguity is the failure this phase exists to eliminate.
 * [threat T-02-03-05]
 */
export function rowsWrittenThisSession(): number {
	return rowsWritten;
}

/**
 * Record that one row reached disk.
 *
 * Exported because the sibling modules added later in this phase append rows
 * too, and a counter that only some append paths increment is worse than no
 * counter: it reports a number that looks like a measurement and is not.
 */
export function noteRowWritten(): void {
	rowsWritten += 1;
}

/** Append one row to the turns stream and count it. */
function writeTurnsRow(cwd: string, record: Record<string, unknown>): void {
	appendJsonl(cwd, TURNS_LOG_BASE, record);
	noteRowWritten();
}

/**
 * Wrap a handler so a throw leaves a row instead of vanishing.
 *
 * On catch it appends a turns-log row carrying {@link DIAGNOSTICS_ERROR_EVENT},
 * the handler's name in `where`, and `String(err)` passed through
 * {@link redactString} — an exception message can quote the input that caused
 * it, and that input may be a `.env` the model just read. [threat T-02-03-06]
 *
 * It returns `undefined` from the catch path and never rethrows. Rethrowing
 * would put the exception straight back into the swallowing path this wrapper
 * exists to escape, and several Pi hooks treat any non-`undefined` return as a
 * REPLACEMENT for the thing being hooked (`runner.ts:1031-1033`), so a wrapper
 * that invented a return value on failure could silently rewrite every provider
 * request. The success path's return value is passed through untouched, which
 * is what lets a hook with a real return contract be wrapped too.
 *
 * The write itself is inside a second `try`. If the log cannot be written there
 * is nothing further this code can do, and throwing from the error path would
 * be the original failure all over again.
 */
export function safeHandler<E, R = undefined>(
	where: string,
	fn: (event: E, ctx: ExtensionContext) => R | void | Promise<R | void>,
): (event: E, ctx: ExtensionContext) => Promise<R | undefined> {
	return async (event: E, ctx: ExtensionContext): Promise<R | undefined> => {
		try {
			const result = await fn(event, ctx);
			return (result ?? undefined) as R | undefined;
		} catch (err) {
			try {
				writeTurnsRow(ctx.cwd, {
					ts: Date.now(),
					event: DIAGNOSTICS_ERROR_EVENT,
					where,
					error: redactString(String(err)),
				});
			} catch {
				// The instrument cannot instrument its own inability to write.
				// Swallow: a diagnostics failure must never take the session down.
			}
			return undefined;
		}
	};
}

export default function (pi: ExtensionAPI): void {
	// Retention runs at session start: cheap, deterministic, off the hot path
	// (RESEARCH §10.5). Later plans in this phase register the turn, prose and
	// budget handlers on this same function.
	pi.on(
		"session_start",
		safeHandler<SessionStartEvent>("session_start", (_event, ctx) => {
			const pruned = pruneLogs(ctx.cwd);
			writeTurnsRow(ctx.cwd, {
				ts: Date.now(),
				event: SESSION_START_EVENT,
				prunedFiles: pruned.length,
			});
		}),
	);

	// DIAG-01 / DIAG-07 — the three main-loop provider hooks.
	//
	// `safeHandler` and `noteRowWritten` are passed IN rather than imported by
	// `wire.ts`: this file already imports that module, and an import back the
	// other way would make the pair a cycle. Passing the counter explicitly is
	// also what keeps there being exactly ONE counter, incremented by every
	// append path — a counter only some paths increment reports a number that
	// looks like a measurement and is not.
	registerWireHooks(pi, safeHandler, noteRowWritten);
}
