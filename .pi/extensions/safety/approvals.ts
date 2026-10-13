/**
 * Block -> approve -> re-issue store: one-shot, command-bound, expiring grants, so approving one command cannot unlock another.
 * Grants key on policy.ts's requestKey, not the request id, so an edited command never matches; the hook only peeks and the wrapper consumes.
 * Stateful by design (no ctx, filesystem or default export); time is an injectable `now` so expiry tests need no sleeping.
 */
import { randomUUID } from "node:crypto";

/** Applies to both a pending request and a granted approval (10 minutes). */
export const APPROVAL_TTL_MS = 10 * 60 * 1000;

/**
 * Bounds how long the hook may defer to a wrapper that never consumes the grant (tool-name collision, unregistered wrapper)
 * before a distinct tool call is re-blocked. A replayed toolCallId (provider-supplied, pi-agent-core agent-loop.js) is not
 * capped; reachable only if the wrapper never runs, the exact command was human-approved and the id is replayed (docs/SAFETY.md "Load order").
 */
export const HOOK_DEFER_TTL_MS = 5_000;

interface PendingApproval {
	readonly requestKey: string;
	readonly command: string;
	readonly reason: string;
	readonly expiresAt: number;
}

interface Grant {
	readonly command: string;
	readonly reason: string;
	readonly expiresAt: number;
}

interface HookDeferredMarker {
	readonly toolCallId: string;
	readonly expiresAt: number;
}

interface ApprovalsStore {
	readonly pending: Map<string, PendingApproval>;
	/** Keyed by requestKey, not the request id. */
	readonly granted: Map<string, Grant>;
	readonly hookDeferred: Map<string, HookDeferredMarker>;
}

/** Well-known globalThis slot: jiti can load this file as separate module instances, and a grant invisible at the wrapper would block every approved command. */
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

/** Record a pending request fingerprinted by policy.ts#computeRequestKey; returns the random request id the model must echo back. */
export function createPending(requestKey: string, command: string, reason: string, now: number = Date.now()): string {
	const store = getStore();
	sweepExpired(store, now);
	const id = randomUUID();
	store.pending.set(id, { requestKey, command, reason, expiresAt: now + APPROVAL_TTL_MS });
	return id;
}

/** Drop expired entries on every createPending so the maps cannot grow unbounded; no timer. */
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
	// Deferral markers are short-lived but swept too.
	for (const [key, marker] of store.hookDeferred) {
		if (marker.expiresAt <= now) {
			store.hookDeferred.delete(key);
		}
	}
}

/** Pure: true only for an unexpired id whose command and reason match the pending entry byte-for-byte. */
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

/** On a valid triple, replace the pending entry with a one-shot grant keyed on requestKey; a failed validation leaves it for a corrected retry. */
export function approve(id: string, command: string, reason: string, now: number = Date.now()): boolean {
	if (!validate(id, command, reason, now)) {
		return false;
	}
	const store = getStore();
	const entry = store.pending.get(id);
	if (entry === undefined) {
		// Unreachable after validate(); denied rather than assumed.
		return false;
	}
	store.pending.delete(id);
	store.granted.set(entry.requestKey, { command, reason, expiresAt: now + APPROVAL_TTL_MS });
	return true;
}

/** The wrapper runs straight after the hook that confirmed, so a confirmed push's grant lives only this long. */
export const CONFIRMED_GRANT_TTL_MS = 30_000;

/** A one-shot grant for a command a human confirmed directly in the hook, with no pending request to echo back. */
export function grantConfirmed(requestKey: string, command: string, reason: string, now: number = Date.now()): void {
	const store = getStore();
	sweepExpired(store, now);
	store.granted.set(requestKey, { command, reason, expiresAt: now + CONFIRMED_GRANT_TTL_MS });
}

/** Non-consuming read for the hook: consuming there would leave the wrapper's consume() nothing and block the approved command. */
export function peek(requestKey: string, now: number = Date.now()): boolean {
	const store = getStore();
	const grant = store.granted.get(requestKey);
	if (grant === undefined) {
		return false;
	}
	return grant.expiresAt > now;
}

/** One-shot: removes the grant whatever the expiry outcome. A different command has a different requestKey and never matches. */
export function consume(requestKey: string, now: number = Date.now()): boolean {
	const store = getStore();
	const grant = store.granted.get(requestKey);
	// The wrapper ran for this key, so any deferral marker is stale.
	store.hookDeferred.delete(requestKey);
	if (grant === undefined) {
		return false;
	}
	store.granted.delete(requestKey);
	return grant.expiresAt > now;
}

/**
 * Self-limiting deferral for the hook, scoped to one tool call. Without it an unconsumed grant (wrapper never ran) would let every
 * re-issue run unguarded for APPROVAL_TTL_MS. Pi runs every loaded copy's hook for the same toolCallId (runner.js emitToolCall), so:
 * the first call for a requestKey records the id and may defer; the same id may defer again; a different id while the marker is
 * live returns false and the hook mints a fresh pending request. A successful consume() clears the marker.
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
