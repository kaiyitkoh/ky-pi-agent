/**
 * SAFE-10 — the "block → approve → re-issue" store: one-shot, command-bound,
 * expiring grants that make in-band approval safe against approving a
 * DIFFERENT command than the one that was actually blocked.
 *
 * ---------------------------------------------------------------------------
 * THE PROTOCOL THIS STORE IMPLEMENTS (04-RESEARCH.md Pattern 3, CONTEXT.md
 * decision 4)
 * ---------------------------------------------------------------------------
 *   1. `policy.ts#evaluate` returns `{ kind: "confirm", reason, requestKey }`.
 *   2. The `tool_call` hook calls {@link createPending}, gets back a random
 *      request id, and blocks the call with a reason instructing the model
 *      to call an `approve_*` tool with that id, the exact command and the
 *      exact reason.
 *   3. The `approve_*` tool's `execute()` — which only runs with a real UI
 *      bound (`ctx.hasUI`) — drives `ctx.ui.select()` and, on a human "yes",
 *      calls {@link approve}.
 *   4. The model re-issues the original tool call. The `tool_call` hook
 *      recomputes the SAME `requestKey` (`policy.ts`'s `computeRequestKey` is
 *      pure and deterministic) and calls {@link peek} -- a NON-CONSUMING
 *      read. If a grant is present, the hook returns `undefined` (never
 *      blocks) so the call reaches the wrapped tool's own `execute()` --
 *      CONTEXT.md decision 5's second enforcement layer -- which recomputes
 *      the identical `requestKey` and calls {@link consume}, the one call
 *      site that actually removes the grant. CR-01: the hook must NEVER call
 *      `consume()` itself -- if it did, the wrapper's own `consume()` on the
 *      SAME retry would always find the grant already gone (single-use,
 *      already used) and block the just-approved command forever. Splitting
 *      "is there a grant" (hook, `peek`) from "use the grant" (wrapper,
 *      `consume`) is what makes the grant single-use ACROSS the two-layer
 *      composition rather than single-use at the hook alone.
 *
 * ---------------------------------------------------------------------------
 * WHY THE GRANT IS KEYED ON `requestKey`, NOT ON THE REQUEST ID
 * ---------------------------------------------------------------------------
 * The request id identifies ONE approval CONVERSATION (one pending prompt).
 * `requestKey` identifies the COMMAND itself. Keying the grant on the id
 * would let a model approve request A and then present an EDITED command
 * against that same id — exactly the vulnerability CONTEXT.md decision 5
 * names, where a later `tool_call` handler mutates `event.input` after
 * approval [`types.d.ts:899-903`: "No re-validation is performed after
 * mutation"]. Keying the grant on `requestKey` instead means: the SAME
 * command re-issued through a different tool call (a different id) still
 * consumes the grant (usable), and a DIFFERENT command — even one approved
 * under the same id's conversation — computes a different `requestKey` and
 * is simply not present in the `granted` map at all (not consumable)
 * [T-04-09, mitigate].
 *
 * `validate()` is the SEPARATE, narrower check that happens BEFORE a grant
 * is ever created: it requires the id to exist AND the presented `command`
 * to match the pending entry's command BYTE-FOR-BYTE AND the presented
 * `reason` to match, all three — not the id alone. This is what prevents the
 * model from approving an EDITED command against a legitimate pending
 * request at approval time, complementing the `requestKey` mechanism which
 * prevents the same laundering AFTER a grant already exists.
 *
 * ---------------------------------------------------------------------------
 * WHY BOTH MAPS LIVE UNDER A `globalThis`-KEYED SLOT
 * ---------------------------------------------------------------------------
 * Pi loads each extension through jiti, which keeps its own module registry
 * per import graph — a plain module-level `Map` here can exist as TWO
 * separate instances in one process when the `tool_call` hook and the
 * wrapped tool's `execute()` (Plan 08) reach this file through different
 * import paths. This is not a hypothetical: it is the EXACT failure
 * `.pi/extensions/diagnostics/index.ts:192-224`'s `ROWS_WRITTEN_KEY`
 * docstring documents as OBSERVED during Phase 2 (a request counter split
 * between a test file's import graph and Pi's own jiti graph, silently
 * under-reporting). Applied here, the consequence is worse than an
 * under-reported number: a grant created at the hook would be invisible at
 * the wrapper, and EVERY approved command would be blocked forever with no
 * error, permanently defeating the confirmation protocol [T-04-40,
 * mitigate]. `getStore()` below reads and writes the identical pattern:
 * check a well-known string key on `globalThis`, initialise once, return the
 * same object to every caller regardless of which module instance is asking.
 *
 * ---------------------------------------------------------------------------
 * `APPROVAL_TTL_MS` AND THE INJECTABLE CLOCK
 * ---------------------------------------------------------------------------
 * `600_000` ms (10 minutes), carried from the reference implementation
 * `@ramtinj95/pi-infra-command-guard@0.9.1`'s `approvals.ts:14` — read this
 * session, never installed [CONTEXT.md decision 9]. Every function that
 * reads time takes an OPTIONAL `now` parameter defaulting to `Date.now()`,
 * so `tests/unit/approvals.test.ts` proves expiry by ADVANCING an injected
 * clock value across calls — no `setTimeout`, no real sleeping, and no
 * flakiness from wall-clock skew in CI [T-04-37, mitigate].
 *
 * ---------------------------------------------------------------------------
 * WHY `validate()` NEVER MUTATES THE STORE
 * ---------------------------------------------------------------------------
 * `validate` is a pure read-only predicate — calling it twice with the same
 * arguments returns the same answer. Cleanup of an expired pending entry
 * happens in {@link approve} (which is the only function that ever needs to
 * remove one), not as a side effect of merely inspecting one. A function
 * named "validate" that also deletes state is a shape this module
 * deliberately does not produce.
 *
 * ---------------------------------------------------------------------------
 * PURITY, MODULO THE STORE ITSELF (matches `git.ts`'s "one impure export"
 * split)
 * ---------------------------------------------------------------------------
 * No `ctx`, no filesystem, no default export. `node:crypto`'s `randomUUID` is
 * the one Node built-in this module imports — no I/O, no environment read.
 * This module is inherently stateful (it IS the store), unlike `shell.ts` /
 * `paths.ts` / `infra.ts`'s fully pure classifiers or `git.ts`'s
 * mostly-pure split; every exported function mutates or reads the single
 * `globalThis`-keyed slot, and that is the whole point of the module.
 *
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It does not spell
 * the tool-registration call, in code or in prose —
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`.
 */
import { randomUUID } from "node:crypto";

/**
 * 10 minutes, carried from the reference implementation
 * (`@ramtinj95/pi-infra-command-guard@0.9.1 approvals.ts:14`, read not
 * installed). Applies to both a pending request and a granted approval.
 */
export const APPROVAL_TTL_MS = 10 * 60 * 1000;

/**
 * WR-12: how long a single "the hook already deferred to the wrapper for
 * this requestKey" marker survives before this module treats it as stale and
 * allows one more deferral. Deliberately SHORT -- seconds, not minutes --
 * unlike {@link APPROVAL_TTL_MS}: the wrapper's own `execute()` is expected
 * to run essentially immediately after the hook defers, inside the SAME tool
 * call, so this window is what bounds the wait for a DISTINCT re-issue (a
 * NEW `toolCallId`) whose grant nothing ever consumes -- the documented
 * T-04-08 tool-name collision, or the CR-06 double-load-prevention shape
 * where this extension's own wrapper was never registered. See
 * {@link markHookDeferred}'s own docstring for the mechanism.
 *
 * WR-19: this bound does NOT apply to a REPLAYED `toolCallId`. Every hook
 * invocation presenting the SAME `toolCallId` as the marker's own is allowed
 * to defer for as long as the marker keeps getting renewed (CR-11's fix,
 * required so that N loaded copies' hooks can all defer for the SAME tool
 * call) -- there is no cap on how many times one id may replay, and
 * `toolCallId` is the PROVIDER's id, passed straight through
 * (`pi-agent-core/dist/agent-loop.js:268,301,337,462`, never
 * harness-generated), so a model can replay it. Measured against the real
 * function: 1000 deferrals granted in 1000 consecutive ms for a replayed id,
 * versus 1 for distinct ids. Reachable only when ALL of: (a) the wrapper
 * that would `consume()` the grant never runs at all (T-04-08, above --
 * not reachable in this repository today), (b) a human has already approved
 * that EXACT command (grants are command-bound -- only the approved command
 * benefits), and (c) the model/provider replays the id. See
 * `docs/SAFETY.md`'s "Load order is part of this" section for the published
 * account of this residual.
 */
export const HOOK_DEFER_TTL_MS = 5_000;

/** One `createPending` call's record — everything `validate`/`approve` need to check a re-presented `{id, command, reason}` triple. */
interface PendingApproval {
	readonly requestKey: string;
	readonly command: string;
	readonly reason: string;
	readonly expiresAt: number;
}

/** One `approve` call's record — looked up by `requestKey`, consumed exactly once. */
interface Grant {
	readonly command: string;
	readonly reason: string;
	readonly expiresAt: number;
}

/**
 * CR-11: a deferral marker now pins WHICH tool call it was issued for, not
 * just when it expires. See {@link markHookDeferred}'s own docstring for why
 * this is load-bearing under a double load of this extension.
 */
interface HookDeferredMarker {
	readonly toolCallId: string;
	readonly expiresAt: number;
}

interface ApprovalsStore {
	/** Keyed by request id (the value {@link createPending} returns). */
	readonly pending: Map<string, PendingApproval>;
	/** Keyed by `requestKey` -- deliberately NOT the request id. See module docstring. */
	readonly granted: Map<string, Grant>;
	/** WR-12/CR-11: keyed by `requestKey` -- one marker per command, expiring quickly. See {@link markHookDeferred}. */
	readonly hookDeferred: Map<string, HookDeferredMarker>;
}

/**
 * Well-known `globalThis` slot name -- see module docstring's "WHY BOTH MAPS
 * LIVE UNDER A `globalThis`-KEYED SLOT" section, following the exact pattern
 * `.pi/extensions/diagnostics/index.ts:192-224`'s `ROWS_WRITTEN_KEY`
 * establishes for the identical hazard. EXPORTED so
 * `tests/unit/approvals.test.ts` can assert against the real key instead of
 * re-typing the literal (the house rule from `harness/index.ts:50-56`) and
 * so the cross-instance proof can inspect the slot directly.
 */
export const APPROVALS_STORE_KEY = "__kyPiSafetyApprovalsStore";

function getStore(): ApprovalsStore {
	const globalSlot = globalThis as unknown as Record<string, ApprovalsStore | undefined>;
	const existing = globalSlot[APPROVALS_STORE_KEY];
	if (existing !== undefined) {
		return existing;
	}
	const created: ApprovalsStore = { pending: new Map(), granted: new Map(), hookDeferred: new Map() };
	globalSlot[APPROVALS_STORE_KEY] = created;
	return created;
}

/**
 * Record a pending approval request for `command`/`reason`, fingerprinted by
 * the caller-supplied `requestKey` (`policy.ts#computeRequestKey`'s output).
 * Returns a random request id -- the value the model must echo back to
 * {@link validate}/{@link approve}. `now` is an injectable clock; defaults to
 * `Date.now()`.
 */
export function createPending(requestKey: string, command: string, reason: string, now: number = Date.now()): string {
	const store = getStore();
	sweepExpired(store, now);
	const id = randomUUID();
	store.pending.set(id, { requestKey, command, reason, expiresAt: now + APPROVAL_TTL_MS });
	return id;
}

/**
 * WR-05: remove every expired `pending`/`granted` entry. Called at the top of
 * {@link createPending} -- the one call site that fires on every confirm-block,
 * including every retry of an already-blocked command -- so the two maps
 * cannot grow without bound across a long session. Cheap and amortised: no
 * timer, no background sweep, just a pass over whatever is already in memory
 * at the moment a new pending entry is about to be created.
 */
function sweepExpired(store: ApprovalsStore, now: number): void {
	for (const [id, entry] of store.pending) {
		if (entry.expiresAt <= now) {
			store.pending.delete(id);
		}
	}
	for (const [key, grant] of store.granted) {
		if (grant.expiresAt <= now) {
			store.granted.delete(key);
		}
	}
	// WR-12: hookDeferred markers are short-lived by design (HOOK_DEFER_TTL_MS),
	// but sweeping them here too means a long session accumulating many
	// distinct confirm-classified commands never lets this map grow purely
	// from stale markers either.
	for (const [key, marker] of store.hookDeferred) {
		if (marker.expiresAt <= now) {
			store.hookDeferred.delete(key);
		}
	}
}

/**
 * True only when `id` names an UNEXPIRED pending entry AND `command` matches
 * that entry's command byte-for-byte AND `reason` matches byte-for-byte.
 * Pure -- never mutates the store. See module docstring.
 */
export function validate(id: string, command: string, reason: string, now: number = Date.now()): boolean {
	const store = getStore();
	const entry = store.pending.get(id);
	if (entry === undefined) {
		return false;
	}
	if (entry.expiresAt <= now) {
		return false;
	}
	return entry.command === command && entry.reason === reason;
}

/**
 * On a successful {@link validate}, deletes the pending entry and records a
 * ONE-SHOT grant keyed on that entry's `requestKey` (not on `id` -- see
 * module docstring). Returns whether the approval succeeded; a failed
 * validation leaves the pending entry untouched, so a later retry with the
 * CORRECT `command`/`reason` can still succeed before the entry expires.
 */
export function approve(id: string, command: string, reason: string, now: number = Date.now()): boolean {
	if (!validate(id, command, reason, now)) {
		return false;
	}
	const store = getStore();
	const entry = store.pending.get(id);
	if (entry === undefined) {
		// Unreachable given validate() just returned true -- the store cannot
		// be mutated between the two reads within one synchronous call. Denied
		// anyway rather than assumed, per this module's own deny-shaped
		// posture (mirrors policy.ts's "never fall through to allow").
		return false;
	}
	store.pending.delete(id);
	store.granted.set(entry.requestKey, { command, reason, expiresAt: now + APPROVAL_TTL_MS });
	return true;
}

/**
 * True when an unexpired grant exists for `requestKey`, WITHOUT consuming it.
 *
 * CR-01: the `tool_call` HOOK uses this instead of {@link consume} to decide
 * whether to defer a re-issued `confirm`-classified call to the wrapped
 * tool's own `execute()`. If the hook consumed the grant itself, the
 * wrapper's own `consume()` call on the retry would always find the grant
 * already gone and block anyway -- the exact bug this finding fixes. Keeping
 * the READ (hook) and the CONSUME (wrapper) as two separate operations on the
 * SAME grant is what makes the grant single-use across the two-layer
 * enforcement composition as a whole, rather than single-use at the hook
 * alone. Pure with respect to the store: never deletes, never fails toward
 * "no grant" past expiry silently -- an expired grant returns `false` here
 * exactly as it would from `consume()`.
 */
export function peek(requestKey: string, now: number = Date.now()): boolean {
	const store = getStore();
	const grant = store.granted.get(requestKey);
	if (grant === undefined) {
		return false;
	}
	return grant.expiresAt > now;
}

/**
 * Consume the grant for `requestKey`, if one exists and has not expired.
 * ONE-SHOT: the grant is removed from the store on this call regardless of
 * outcome, so a second `consume()` for the same `requestKey` returns
 * `false` even if the first call happened before expiry. A grant issued for
 * a different command computes a different `requestKey`
 * (`policy.ts#computeRequestKey`) and was therefore never present in this
 * map to begin with -- see module docstring's "not consumable for command
 * B" guarantee.
 */
export function consume(requestKey: string, now: number = Date.now()): boolean {
	const store = getStore();
	const grant = store.granted.get(requestKey);
	// WR-12: a genuine consume -- whether it succeeds or the grant had already
	// expired -- means the wrapper actually ran for this requestKey, so any
	// "the hook already deferred once" marker for it is stale information.
	// Clearing it here is hygiene, not load-bearing for correctness (a future
	// confirm cycle for the same command recomputes a fresh requestKey path
	// through createPending, never reaching markHookDeferred with this key
	// again until a NEW grant exists) -- but leaving it would be exactly the
	// kind of "the code no longer matches its own docstring" drift this
	// project's own SAFE-15/Authority sections warn against.
	store.hookDeferred.delete(requestKey);
	if (grant === undefined) {
		return false;
	}
	store.granted.delete(requestKey);
	return grant.expiresAt > now;
}

/**
 * WR-12/CR-11: self-limiting deferral, keyed by requestKey AND scoped to
 * ONE tool call. CR-01's fix made the `tool_call` HOOK return `undefined`
 * (defer to the wrapper) whenever {@link peek} finds an unexpired grant for
 * a re-issued command -- but the wrapper is the ONLY consumer. If the tool
 * that actually executes is not this extension's own wrapper (the
 * documented T-04-08 tool-name-collision case, or the CR-06 case where this
 * extension's wrapper was never registered at all), nothing ever calls
 * {@link consume}, `peek()` keeps returning `true` for the whole
 * {@link APPROVAL_TTL_MS} window, and every re-issue of that exact command
 * runs UNGUARDED for up to 10 minutes on a single human approval -- strictly
 * worse than CR-01's own starting point, where one approval could never
 * unblock anything.
 *
 * CR-11: WR-07/CR-09 accept that this extension may load MORE THAN ONCE in
 * one process (a project-scoped copy plus the user-scope stub, both
 * trusted). Pi runs every loaded extension's OWN `tool_call` handler, in
 * load order, for the SAME tool call [`dist/core/extensions/runner.js
 * #emitToolCall`] -- so a re-issued command that has a grant sees N
 * independent hook invocations, all sharing this ONE `requestKey`, but all
 * describing the SAME `event.toolCallId`. The original (WR-12) version of
 * this function keyed purely on `requestKey` and let only the FIRST caller
 * defer -- which meant hook #2 of that SAME tool call always found the
 * marker already set and fell through to minting a fresh pending request
 * and BLOCKING, permanently defeating the confirm -> approve -> re-issue
 * protocol the moment a second copy of this extension is loaded (the
 * fixer's own "at worst a duplicate block, never a missed one" justification
 * for accepting the double load was executed and found FALSE -- see
 * `docs/SAFETY.md`'s "Load order is part of this" section). The fix: pin
 * the marker to the `toolCallId` it was first issued for.
 *   - the FIRST call for a given `requestKey` (no unexpired marker present)
 *     records `{ toolCallId, expiresAt: now + HOOK_DEFER_TTL_MS }` and
 *     returns `true` -- this hook may defer.
 *   - a call for the SAME `requestKey` AND THE SAME `toolCallId`, before the
 *     marker expires, ALSO returns `true` -- every hook belonging to the
 *     SAME tool call (i.e. every load of this extension, in one process)
 *     must be able to defer, because only one of them (the first-registered
 *     wrapper) will ever actually consume the grant.
 *   - a call for the SAME `requestKey` but a DIFFERENT `toolCallId` -- a
 *     genuine re-issue, a NEW tool call, while the previous marker is still
 *     live and nothing has consumed the grant -- returns `false`. The hook
 *     must NOT defer; it falls through to its normal confirm-block path
 *     (mint a fresh pending request) exactly as if no grant existed. This is
 *     WR-12's original bound, now correctly scoped: it fires on a genuine
 *     unconsumed re-issue, never on a sibling hook invocation of the SAME
 *     re-issue.
 *
 * A successful {@link consume} clears the marker outright (see that
 * function's own comment), so the NORMAL one-approval-one-execution cycle is
 * never penalised: every hook of one tool call defers, the (single,
 * first-registered) wrapper consumes once, done.
 */
export function markHookDeferred(requestKey: string, toolCallId: string, now: number = Date.now()): boolean {
	const store = getStore();
	const existing = store.hookDeferred.get(requestKey);
	if (existing !== undefined && existing.expiresAt > now) {
		return existing.toolCallId === toolCallId;
	}
	store.hookDeferred.set(requestKey, { toolCallId, expiresAt: now + HOOK_DEFER_TTL_MS });
	return true;
}
