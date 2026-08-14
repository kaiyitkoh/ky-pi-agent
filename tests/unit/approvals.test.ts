/**
 * SAFE-10 -- `.pi/extensions/safety/approvals.ts`, table-driven where the
 * behaviour is table-shaped and direct-assertion where it is a single
 * property (TTL, one-shot, cross-instance).
 *
 * Every clock-dependent assertion advances an INJECTED `now` value across
 * calls -- no `setTimeout`, no real sleeping (see the plan's own acceptance
 * criterion: "no `setTimeout` and no real sleeping").
 */
import { describe, expect, it } from "vitest";

import {
	APPROVAL_TTL_MS,
	APPROVALS_STORE_KEY,
	approve,
	consume,
	createPending,
	peek,
	validate,
} from "../../.pi/extensions/safety/approvals.ts";

/** Read the raw store off `globalThis`, for tests that need to inspect map SIZE directly (peek/consume/validate all already time-gate individually, so they cannot distinguish "swept" from "merely expired but not yet removed"). */
function rawStore(): { pending: Map<string, unknown>; granted: Map<string, { expiresAt: number }> } {
	const globalSlot = globalThis as unknown as Record<
		string,
		{ pending: Map<string, unknown>; granted: Map<string, { expiresAt: number }> } | undefined
	>;
	const store = globalSlot[APPROVALS_STORE_KEY];
	if (store === undefined) {
		throw new Error(`${APPROVALS_STORE_KEY} is not yet initialised -- call createPending() at least once first`);
	}
	return store;
}

const T0 = 1_700_000_000_000; // an arbitrary fixed epoch millisecond, never real wall-clock time

describe("SAFE-10 -- APPROVAL_TTL_MS is exactly 10 minutes", () => {
	it("equals 600000", () => {
		expect(APPROVAL_TTL_MS).toBe(600_000);
	});
});

describe("SAFE-10 -- createPending / validate", () => {
	it("createPending returns a request id that validate() accepts for the exact command and reason", () => {
		const id = createPending("key-a", "terraform apply", "irreversible", T0);
		expect(validate(id, "terraform apply", "irreversible", T0)).toBe(true);
	});

	it("validate returns false for a correct id with an EDITED command", () => {
		const id = createPending("key-b", "terraform apply", "irreversible", T0);
		expect(validate(id, "terraform destroy", "irreversible", T0)).toBe(false);
	});

	it("validate returns false for a correct id with an EDITED reason", () => {
		const id = createPending("key-c", "terraform apply", "irreversible", T0);
		expect(validate(id, "terraform apply", "different reason", T0)).toBe(false);
	});

	it("validate returns false for an unknown id", () => {
		expect(validate("no-such-id", "terraform apply", "irreversible", T0)).toBe(false);
	});

	it("validate does not mutate the store -- calling it twice gives the same answer", () => {
		const id = createPending("key-d", "terraform apply", "irreversible", T0);
		expect(validate(id, "terraform apply", "irreversible", T0)).toBe(true);
		expect(validate(id, "terraform apply", "irreversible", T0)).toBe(true);
	});
});

describe("SAFE-10 -- approve / consume: one-shot", () => {
	it("approve succeeds for a matching id/command/reason and consume returns true exactly once", () => {
		const id = createPending("key-e", "terraform apply", "irreversible", T0);
		expect(approve(id, "terraform apply", "irreversible", T0)).toBe(true);
		expect(consume("key-e", T0)).toBe(true);
		expect(consume("key-e", T0)).toBe(false); // one-shot: second call for the same grant fails
	});

	it("approve fails for a mismatched command and creates no grant", () => {
		const id = createPending("key-f", "terraform apply", "irreversible", T0);
		expect(approve(id, "terraform destroy", "irreversible", T0)).toBe(false);
		expect(consume("key-f", T0)).toBe(false);
	});

	it("approve fails for an unknown id", () => {
		expect(approve("no-such-id", "terraform apply", "irreversible", T0)).toBe(false);
	});

	it("a failed approve leaves the pending entry usable for a later correct retry", () => {
		const id = createPending("key-g", "terraform apply", "irreversible", T0);
		expect(approve(id, "terraform destroy", "irreversible", T0)).toBe(false); // wrong command, rejected
		expect(approve(id, "terraform apply", "irreversible", T0 + 1000)).toBe(true); // correct retry, still within TTL
		expect(consume("key-g", T0 + 1000)).toBe(true);
	});

	it("consume for an id that was never approved returns false", () => {
		expect(consume("never-approved-key", T0)).toBe(false);
	});
});

describe("SAFE-10 -- a grant for command A is not consumable for command B (T-04-09)", () => {
	it("approving under requestKey A never satisfies a consume() for requestKey B, even for the identical command text", () => {
		const idA = createPending("key-command-A", "terraform apply", "irreversible", T0);
		expect(approve(idA, "terraform apply", "irreversible", T0)).toBe(true);
		// Same command text, but a DIFFERENT requestKey (as it would be if a
		// different cwd or tool produced the same command string) -- no grant
		// exists under that key.
		expect(consume("key-command-B", T0)).toBe(false);
		// The real grant, under its own key, still works.
		expect(consume("key-command-A", T0)).toBe(true);
	});
});

describe("SAFE-10 -- expiry, proven with an injected clock", () => {
	it("a pending entry expires after APPROVAL_TTL_MS -- validate() returns false past the deadline", () => {
		const id = createPending("key-h", "terraform apply", "irreversible", T0);
		expect(validate(id, "terraform apply", "irreversible", T0 + APPROVAL_TTL_MS - 1)).toBe(true);
		expect(validate(id, "terraform apply", "irreversible", T0 + APPROVAL_TTL_MS)).toBe(false);
	});

	it("an expired pending entry cannot be approved", () => {
		const id = createPending("key-i", "terraform apply", "irreversible", T0);
		expect(approve(id, "terraform apply", "irreversible", T0 + APPROVAL_TTL_MS + 1)).toBe(false);
	});

	it("a granted approval expires after APPROVAL_TTL_MS -- consume() returns false past the deadline, and the grant is gone either way (one-shot)", () => {
		const id = createPending("key-j", "terraform apply", "irreversible", T0);
		expect(approve(id, "terraform apply", "irreversible", T0)).toBe(true);
		expect(consume("key-j", T0 + APPROVAL_TTL_MS + 1)).toBe(false);
	});

	it("a still-fresh grant consumed just before its deadline succeeds", () => {
		const id = createPending("key-k", "terraform apply", "irreversible", T0);
		expect(approve(id, "terraform apply", "irreversible", T0)).toBe(true);
		expect(consume("key-k", T0 + APPROVAL_TTL_MS - 1)).toBe(true);
	});
});

describe("SAFE-10 -- cross-instance: the store lives under a well-known globalThis slot, not a module-level variable", () => {
	it("APPROVALS_STORE_KEY names a real slot on globalThis after a write", () => {
		createPending("key-l", "terraform apply", "irreversible", T0);
		const globalSlot = globalThis as unknown as Record<string, unknown>;
		expect(globalSlot[APPROVALS_STORE_KEY]).toBeDefined();
		const store = globalSlot[APPROVALS_STORE_KEY] as { pending: Map<unknown, unknown>; granted: Map<unknown, unknown> };
		expect(store.pending instanceof Map).toBe(true);
		expect(store.granted instanceof Map).toBe(true);
	});

	it(
		"STRUCTURAL PROOF, not behavioural: a second dynamic import of approvals.ts through a differently-spelled " +
			"relative specifier resolves to the same globalThis slot and observes a grant created through the first import. " +
			"Node/Vitest's own ESM module cache dedupes both specifiers to one module instance -- unlike jiti's per-extension " +
			"module registry in Pi, which is the actual hazard this store defends against (see approvals.ts's module docstring, " +
			'"WHY BOTH MAPS LIVE UNDER A globalThis-KEYED SLOT") -- so this test cannot force two GENUINE module instances to ' +
			"exist in-process. What it DOES prove: the store is reached through a named global slot rather than a captured " +
			"closure variable, which is the property that makes it instance-agnostic regardless of how many times the module " +
			"is evaluated. Recorded in 04-07-SUMMARY.md per the plan's own instruction for this exact toolchain limitation.",
		async () => {
			const viaRelative = await import("../../.pi/extensions/safety/approvals.ts");
			const viaDotSegment = await import("../../.pi/extensions/safety/../safety/approvals.ts");

			const id = viaRelative.createPending("key-cross-instance", "terraform apply", "irreversible", T0);
			expect(viaDotSegment.approve(id, "terraform apply", "irreversible", T0)).toBe(true);
			expect(viaRelative.consume("key-cross-instance", T0)).toBe(true);
		},
	);
});

describe("CR-01 -- peek(): a non-consuming read of the granted map", () => {
	it("peek returns true for an unexpired grant WITHOUT removing it -- a later consume() still succeeds", () => {
		const id = createPending("peek-key-a", "terraform apply", "irreversible", T0);
		expect(approve(id, "terraform apply", "irreversible", T0)).toBe(true);

		expect(peek("peek-key-a", T0)).toBe(true);
		expect(peek("peek-key-a", T0)).toBe(true); // calling it twice must not consume it either

		expect(consume("peek-key-a", T0)).toBe(true);
		expect(peek("peek-key-a", T0), "consume() is one-shot -- a THIRD peek after the real consume must see nothing").toBe(
			false,
		);
	});

	it("peek returns false for a grant that has expired", () => {
		const id = createPending("peek-key-b", "terraform apply", "irreversible", T0);
		expect(approve(id, "terraform apply", "irreversible", T0)).toBe(true);
		expect(peek("peek-key-b", T0 + APPROVAL_TTL_MS + 1)).toBe(false);
	});

	it("peek returns false for a requestKey with no grant at all", () => {
		expect(peek("no-such-grant-key", T0)).toBe(false);
	});
});

describe("WR-05 -- createPending() sweeps expired pending/granted entries so neither map grows without bound", () => {
	it("an expired PENDING entry is removed by the next createPending() call", () => {
		createPending("wr05-pending-a", "terraform apply", "irreversible", T0);
		const store = rawStore();
		const sizeAtT0 = store.pending.size;
		expect(sizeAtT0, "the entry just created must actually be present, or this test proves nothing").toBeGreaterThan(
			0,
		);

		// Advance well past the TTL, then create ANOTHER pending entry -- the
		// sweep at the top of createPending() must remove the now-expired
		// wr05-pending-a entry, so the store does not simply keep growing by
		// one entry per confirm-block retry (the exact WR-05 growth hazard,
		// compounded once CR-01 lets a model retry a confirm-classified
		// command many times before ever approving it).
		createPending("wr05-pending-b", "terraform destroy", "irreversible", T0 + APPROVAL_TTL_MS + 1);

		const survivingKeys = [...store.pending.values()].map((v) => (v as { requestKey: string }).requestKey);
		expect(
			survivingKeys,
			"the expired wr05-pending-a entry must have been swept away by the later createPending() call",
		).not.toContain("wr05-pending-a");
	});

	it("an expired GRANTED entry is removed by the next createPending() call", () => {
		const id = createPending("wr05-grant-key", "terraform apply", "irreversible", T0);
		expect(approve(id, "terraform apply", "irreversible", T0)).toBe(true);
		const store = rawStore();
		expect(
			store.granted.has("wr05-grant-key"),
			"the grant just created must actually be present, or this test proves nothing",
		).toBe(true);

		createPending("wr05-unrelated", "kubectl get pods", "unclassified verb", T0 + APPROVAL_TTL_MS + 1);

		expect(
			store.granted.has("wr05-grant-key"),
			"the expired grant must have been swept away by the later createPending() call",
		).toBe(false);
	});

	it("an UNEXPIRED pending entry survives a later createPending() call -- the sweep never removes live entries", () => {
		createPending("wr05-live-a", "terraform apply", "irreversible", T0);
		createPending("wr05-live-b", "terraform destroy", "irreversible", T0 + 1000);
		const store = rawStore();
		const survivingKeys = [...store.pending.values()].map((v) => (v as { requestKey: string }).requestKey);
		expect(survivingKeys).toContain("wr05-live-a");
		expect(survivingKeys).toContain("wr05-live-b");
	});
});
