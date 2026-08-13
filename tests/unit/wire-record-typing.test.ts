/**
 * DIAG-01 — `WireRecord`'s union really does reject an impossible record.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS UNVERIFIED, AND WHAT TURNED OUT NOT TO BE BROKEN
 * ---------------------------------------------------------------------------
 * `schema.ts:287-288` states the design intent in as many words: the record type
 * is "modelled as a union rather than three optional fields so a record carrying
 * both a request `payload` and a response `status` does not typecheck". Nothing
 * asserted it, in either direction — which is the finding this file answers.
 *
 * `wireRecord` used to take `fields: Partial<WireRecord>`. A code review argued the
 * mixed-field protection was fictional, on the grounds that `Partial` distributes
 * over the union and erases the `never` guards. **MEASURED: it was not fictional.**
 * `Partial<T>` is homomorphic, so it does distribute — but it keeps the guard's TYPE
 * and only makes it optional, so `headers?: never` becomes `headers?: undefined` and
 * `undefined` stays the only assignable value. A mixed bag matches no arm.
 * `wireRecord("main.request", { payload: {}, status: 200 })` did NOT compile
 * [VERIFIED: the signature was reverted and `tsc --noEmit` re-run; the
 * `@ts-expect-error` on that line stayed IN USE, i.e. the line still errored].
 *
 * The real gap was smaller: `Partial` made each arm's OWN field optional too, so
 * `wireRecord("main.request", {})` compiled — a `.request` record that says a
 * request happened and nothing about what was in it. Under the same revert, that is
 * the ONE directive below that became "unused", which is precisely how this file
 * located the difference between the review's claim and the compiler's behaviour.
 *
 * The narrowed signature closes that and moves every check to the CALL SITE, where
 * a human can act on it, instead of behind a cast two frames away.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE LOOKS LIKE THIS
 * ---------------------------------------------------------------------------
 * The protection is a COMPILE-TIME one, so the only honest way to assert it is at
 * compile time. `@ts-expect-error` is that assertion and it is a real gate in both
 * directions: if the type stops rejecting the line below, tsc reports "Unused
 * '@ts-expect-error' directive" and `npm run typecheck` FAILS. A runtime
 * `expect(...).toThrow()` could not express this — `wireRecord` happily builds any
 * object it is handed, which is exactly why the type has to be the control.
 *
 * The runtime assertions in each case are there so the file is not a set of bare
 * directives: each one also pins that the LEGITIMATE shape still works, which is
 * the paired positive. A signature narrowed until it rejects everything would
 * satisfy every `@ts-expect-error` here while breaking the whole capture path.
 */
import { describe, expect, it } from "vitest";

import type { WireRecord } from "../../.pi/extensions/diagnostics/schema.ts";
import { UNCORRELATED, wireRecord } from "../../.pi/extensions/diagnostics/wire.ts";

/** Read a field off a record without narrowing the union at every call site. */
function field(record: WireRecord, key: string): unknown {
	return (record as unknown as Record<string, unknown>)[key];
}

describe("wireRecord — the arm is selected by the kind, at the call site", () => {
	it("accepts each kind's own fields (the paired positive)", () => {
		const request = wireRecord("main.request", { payload: { model: "faux-flash" } });
		const headers = wireRecord("nested.headers", { headers: { authorization: null } });
		const response = wireRecord("main.response", { status: 200, headers: { etag: "abc" } });
		const bareResponse = wireRecord("nested.response", { status: 503 });

		expect(
			[
				field(request, "payload"),
				field(headers, "headers"),
				field(response, "status"),
				field(bareResponse, "status"),
			],
			"every legitimate shape must still compose. Without this half, a signature narrowed until " +
				"it rejected everything would satisfy every @ts-expect-error below while breaking the " +
				"entire capture path",
		).toEqual([{ model: "faux-flash" }, { authorization: null }, 200, 503]);

		expect(
			field(response, "kind"),
			"the kind must reach the record, since it is what a reader filters the dump on",
		).toBe("main.response");

		expect(
			field(request, "corr"),
			`with no id issued and none passed, the stamp falls back to ${UNCORRELATED} — a distinct ` +
				"value rather than a silent omission, because seeing it in a real dump means the header " +
				"hook did not run and that is a finding",
		).toBe(UNCORRELATED);
	});

	it("still accepts the attribution fields on any kind", () => {
		const record = wireRecord("nested.request", {
			payload: {},
			corr: "sess#7",
			sessionId: "sess",
			role: "advisor",
		});

		expect(
			[field(record, "corr"), field(record, "sessionId"), field(record, "role")],
			"`corr`, `sessionId` and `role` are kind-independent: the nested path passes all three on " +
				"every record so a truncated dump is still joinable. Narrowing the arm must not have " +
				"cost them",
		).toEqual(["sess#7", "sess", "advisor"]);
	});
});

describe("wireRecord — an impossible record does not compile", () => {
	it("rejects a request that also carries a response status", () => {
		// @ts-expect-error a `.request` record may not carry `status`: it would claim
		// one record captured both the outgoing body and the HTTP response, which is
		// exactly the mix `schema.ts`'s union exists to forbid. This was ALREADY
		// rejected under the old `Partial<WireRecord>` signature — measured, not
		// assumed — so this case is the missing assertion rather than a new fix. It
		// stays because an unasserted protection is one edit from not existing.
		const impossible = wireRecord("main.request", { payload: {}, status: 200 });

		expect(
			field(impossible, "payload"),
			"the line is still exercised at runtime so the directive above is attached to a real call " +
				"rather than to dead code a refactor could delete without noticing",
		).toEqual({});
	});

	it("rejects a response that also carries a payload", () => {
		// @ts-expect-error the mirror image: a `.response` record has no payload to
		// carry, and one that had would file the request's bytes under the response.
		const impossible = wireRecord("nested.response", { status: 200, payload: {} });

		expect(field(impossible, "status")).toBe(200);
	});

	it("rejects a headers record that also carries a payload", () => {
		// @ts-expect-error `before_provider_headers` and `before_provider_request` are
		// two hooks and two records; merging them would put two entries' worth of data
		// in one and break the headers -> request -> response ordering assertion in
		// tests/integration/wire-capture.test.ts.
		const impossible = wireRecord("main.headers", { headers: {}, payload: {} });

		expect(field(impossible, "headers")).toEqual({});
	});

	it("rejects a request record with no payload at all", () => {
		// @ts-expect-error the arm's field is REQUIRED, not optional. A `.request`
		// record with no payload is a row that says a request happened and nothing
		// about what was in it.
		//
		// THIS IS THE ONE THE OLD SIGNATURE LET THROUGH. `Partial` made every field
		// optional, including the arm's own, so this line compiled — and reverting the
		// signature makes THIS directive, and only this one, report "unused".
		const empty = wireRecord("main.request", {});

		expect(
			field(empty, "kind"),
			"the kind survives even on the shape the type rejects, which is what makes the runtime " +
				"half of this case meaningful",
		).toBe("main.request");
	});
});
