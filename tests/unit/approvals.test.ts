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

import { APPROVAL_TTL_MS, APPROVALS_STORE_KEY, approve, consume, createPending, validate } from "../../.pi/extensions/safety/approvals.ts";

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
