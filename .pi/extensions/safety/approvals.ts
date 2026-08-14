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

interface ApprovalsStore {
	/** Keyed by request id (the value {@link createPending} returns). */
	readonly pending: Map<string, PendingApproval>;
	/** Keyed by `requestKey` -- deliberately NOT the request id. See module docstring. */
	readonly granted: Map<string, Grant>;
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
	const created: ApprovalsStore = { pending: new Map(), granted: new Map() };
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
	if (grant === undefined) {
		return false;
	}
	store.granted.delete(requestKey);
	return grant.expiresAt > now;
}
