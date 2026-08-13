/**
 * ky-pi-agent — diagnostics row types and the literals every test asserts on.
 *
 * PURPOSE. One place for every constant that appears in both the writer and an
 * assertion. The house rule (`.pi/extensions/harness/index.ts:50-56`) is that a
 * duplicated literal is how an assertion silently stops matching the thing it
 * checks, so nothing below may be re-typed in a test: import it.
 *
 * LIFETIME. Permanent. `docs/DIAGNOSTICS.md` (plan 02-11) documents the row
 * contract this file declares, and Phases 5, 8 and 10 read the rows.
 *
 * BOUNDARY RULE (BOOT-10). This file declares types and constants. It registers
 * nothing at all, and in particular it does not spell the tool-registration
 * call even in prose — `tests/unit/contributing-boundary.test.ts` matches that
 * name as a plain substring across every tracked source under
 * `.pi/extensions/`, comments included.
 *
 * IMPORT CONCENTRATION. `@earendil-works/pi-ai`'s root entrypoint has an
 * announced future removal, so only this module, `turns.ts` and `call-model.ts`
 * import from it. Everything else imports the re-declared types from here.
 * `turns.ts` is on that list because `calculateCost` is a VALUE and cannot come
 * through a type-only re-export; it takes the types for that call from the same
 * statement rather than opening a second import site.
 */
import type { StopReason } from "@earendil-works/pi-ai";

/**
 * pi-ai types the rest of the subsystem needs, re-exported from the one place
 * allowed to name that package.
 *
 * `prose.ts` takes a finalized assistant message and reads `stopReason` and the
 * `content` block union off it. Re-declaring that shape locally would trade a
 * compile error for a silent miss the day Pi renames a block type, and
 * importing pi-ai directly from a second module would break the concentration
 * rule stated above. So it comes through here, type-only and fully erased.
 *
 * `Api` and `Model` are on the list because `index.ts` must construct a
 * DEGRADED model shape when `ctx.model` is undefined at `turn_end` — a row whose
 * cost was computed from zero rates rather than a real catalogue entry. Without
 * the annotation the literal's `input: ["text"]` infers `string[]` and is not
 * assignable to `("text" | "image")[]`, so the fallback would need a cast; with
 * it, a future field added to pi-ai's `Model` is a compile error at the fallback
 * rather than a silently under-populated object. They are re-exported here, not
 * imported there, because `index.ts` is NOT one of the three sanctioned pi-ai
 * import sites.
 */
export type { Api, AssistantMessage, Model, StopReason } from "@earendil-works/pi-ai";

// ---------------------------------------------------------------------------
// Log file naming
// ---------------------------------------------------------------------------

/**
 * Directory segment under Pi's config dir that holds every diagnostic log.
 *
 * Exported so `jsonl.ts` and the DIAG-07 gitignore test agree on one string.
 * The full directory is `<cwd>/<CONFIG_DIR_NAME>/<LOG_DIR_SEGMENT>` — never a
 * hardcoded `.pi`, because a rebranded Pi distribution uses a different name.
 */
export const LOG_DIR_SEGMENT = "logs";

/**
 * Base name of the wire stream: the redacted request/response dump (DIAG-01).
 *
 * Files are `wire-YYYY-MM-DD.jsonl` live and `wire-YYYY-MM-DD.<n>.jsonl`
 * rotated, increasing `n` being older [RESEARCH §10.5].
 */
export const WIRE_LOG_BASE = "wire";

/** Base name of the turn stream: one row per turn AND per nested call (DIAG-04). */
export const TURNS_LOG_BASE = "turns";

// ---------------------------------------------------------------------------
// Rotation and retention (DIAG-08). Every number carries its arithmetic.
// ---------------------------------------------------------------------------

/**
 * Rotate `wire-*` at 32 MB.
 *
 * A single captured payload measured ~50 KB in this repo (RESEARCH §7.4), so
 * 32 MB is roughly 600 turns — about a heavy day — and still opens in an editor.
 */
export const WIRE_ROTATE_BYTES = 32_000_000;

/**
 * Rotate `turns-*` at 8 MB.
 *
 * A turn row is ~600 B, so 8 MB is roughly 14,000 turns.
 */
export const TURNS_ROTATE_BYTES = 8_000_000;

/**
 * Rotated files kept per stream, per day.
 *
 * 10 × 32 MB bounds a bad day at ~320 MB of wire and ~80 MB of turns. Beyond
 * this the oldest file is unlinked, oldest-first, by {@link rotate} in
 * `jsonl.ts`.
 */
export const MAX_ROTATED_FILES = 10;

/**
 * Days of history kept, pruned at `session_start`.
 *
 * 14 is long enough to answer "was DeepSeek worse last week?" and short enough
 * that a working tree in a public repo never accumulates months of prompt
 * bodies.
 */
export const RETENTION_DAYS = 14;

// ---------------------------------------------------------------------------
// Prose-tool-call detector (DIAG-05) — the literals plan 02-07 and its tests share
// ---------------------------------------------------------------------------

/**
 * Retries permitted after a prose tool call is detected.
 *
 * One. A detector that retries repeatedly doubles cost on every false positive
 * and corrupts the measured prose rate that Phase 10 discriminates on.
 */
export const MAX_PROSE_RETRIES = 1;

/** `event` value on a turn row where the detector fired. */
export const PROSE_EVENT = "prose_tool_call";

/** `event` value on a turn row where the retry budget was already spent. */
export const PROSE_EXHAUSTED_EVENT = "prose_tool_call_retry_exhausted";

/**
 * `event` value on the row a failed diagnostics handler writes.
 *
 * Pi swallows handler exceptions (`runner.ts:861-870`, observed live during
 * research), so without this row a broken instrument is indistinguishable from
 * a quiet one — the exact failure class this phase exists to eliminate.
 */
export const DIAGNOSTICS_ERROR_EVENT = "diagnostics.error";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

/** What a turn row's numbers describe: a top-level turn, or a nested `callModel`. */
export type RowKind = "turn" | "nested";

/**
 * Coarse verdict for a turn, derived from `stopReason` (RESEARCH §3.3).
 *
 * Kept alongside the raw `stopReason` rather than replacing it: the mapping is
 * this project's interpretation and the provider's own word must stay readable.
 */
export type Outcome = "ok" | "tool_use" | "length" | "error" | "aborted" | "deferred" | "pending";

/**
 * The complete `stopReason` → `outcome` mapping.
 *
 * Typed as `Record<StopReason, Outcome>` so a new member of Pi's union is a
 * compile error here rather than an `undefined` in a log file.
 * [VERIFIED: pi-ai 0.84.1 dist/types.d.ts:275 — the union has exactly these
 *  seven members.]
 */
export const OUTCOME_BY_STOP_REASON: Record<StopReason, Outcome> = {
	stop: "ok",
	toolUse: "tool_use",
	length: "length",
	error: "error",
	aborted: "aborted",
	deferred: "deferred",
	pending: "pending",
};

/** Per-turn cost in dollars, as `calculateCost` computes it (pi-ai models.ts:878-898). */
export interface TurnCost {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

/**
 * One row of `turns-*.jsonl`. Field provenance is RESEARCH §5.5.
 *
 * Written from `message_end` + `turn_end`, never from
 * `after_provider_response`: a 4xx/5xx throws past the response hook, so a row
 * built there would be missing exactly the turns worth recording (Pitfall 3).
 */
export interface TurnRow {
	/** `Date.now()` at row composition. */
	ts: number;
	kind: RowKind;
	/** The executor this turn ran as — session role, or `opts.role` on a nested call. */
	role: string;
	sessionId: string;
	/** Correlation id tying this row to its `wire-*` records. */
	corr: string;
	turnIndex?: number;
	provider: string;
	model: string;
	/** Present when it differs from `model` — OpenRouter `auto` reports the resolved one. */
	responseModel?: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	/**
	 * Reasoning tokens, a subset of `output`.
	 *
	 * OPTIONAL, AND THE KEY IS OMITTED WHEN THE PROVIDER REPORTS NOTHING —
	 * never `0` and never `null`. Absence of the key means the provider reports
	 * no breakdown; it does NOT mean zero thinking tokens were billed. Bedrock's
	 * `handleMetadata` never assigns it
	 * [VERIFIED: pi-ai src/api/bedrock-converse-stream.ts:589-602], while
	 * `openai-completions.ts:1404` does. A `0` here would report Bedrock
	 * thinking as free, which is a fabricated measurement (Pitfall 4).
	 */
	reasoning?: number;
	/** `cacheRead / (input + cacheRead)`; omitted when the denominator is 0. */
	cacheReadRatio?: number;
	cost: TurnCost;
	/** `turn_end` wall clock minus `turn_start.timestamp`. */
	latencyMs: number;
	stopReason: StopReason;
	rawStopReason?: string;
	outcome: Outcome;
	/** `message.errorMessage`, passed through the redactor. */
	errorMessage?: string;
	/** Count of `content[].type === "toolCall"` in the assistant message. */
	toolCalls: number;
	toolResults?: number;
	/**
	 * `after_provider_response.status`.
	 *
	 * Absent on error and on every nested call unless `callModel` supplies its
	 * own `onResponse` — the response hook is not wired for nested calls.
	 */
	httpStatus?: number;
	/** The REQUESTED thinking level, recorded because Bedrock makes it undecomposable. */
	thinkingLevel?: string;
	/** Set for out-of-band rows: {@link PROSE_EVENT}, {@link DIAGNOSTICS_ERROR_EVENT}, … */
	event?: string;
}

/** Which side of which call a wire record came from. */
export type WireKind =
	| "main.headers"
	| "main.request"
	| "main.response"
	| "nested.headers"
	| "nested.request"
	| "nested.response";

/** Fields every wire record carries regardless of which side it captured. */
interface WireRecordBase {
	ts: number;
	/** Correlation id tying this record to its `turns-*` row. */
	corr: string;
	kind: WireKind;
	role?: string;
	sessionId?: string;
}

/**
 * One row of `wire-*.jsonl`: a payload record, a headers record, or a response
 * record carrying a status and — where the transport exposes them — the
 * response headers too.
 *
 * Modelled as a union rather than three optional fields so a record carrying
 * both a request `payload` and a response `status` does not typecheck.
 * Everything here has already been through `redact.ts` — the writer is not the
 * place to remember that.
 *
 * THE RESPONSE ARM CARRIES BOTH `status` AND `headers`, which the original
 * three-way split forbade. `AfterProviderResponseEvent` is
 * `{ status: number; headers: Record<string, string> }`
 * [VERIFIED: pi 0.84.1 src/core/extensions/types.ts:691-696] — one event, two
 * fields — and splitting it into two records would put four entries in a
 * three-hook dump and break the `main.headers` → `main.request` →
 * `main.response` ordering assertion. Response headers are worth keeping: rate
 * limits, request ids and cache indicators live there. `headers` stays optional
 * because Bedrock supplies only `x-amzn-requestid`
 * [VERIFIED: pi-ai src/api/bedrock-converse-stream.ts:255-261] and Pi's docs
 * warn that a provider abstracting HTTP may expose none at all
 * [CITED: docs/extensions.md:708].
 */
export type WireRecord =
	| (WireRecordBase & { payload: unknown; headers?: never; status?: never })
	| (WireRecordBase & {
			headers: Record<string, string | null>;
			payload?: never;
			status?: never;
	  })
	| (WireRecordBase & {
			status: number;
			headers?: Record<string, string | null>;
			payload?: never;
	  });
