/**
 * WireRecord's union rejects an impossible record, asserted at compile time: if a line below stops erroring, tsc
 * reports an unused @ts-expect-error and typecheck fails. Partial<T> keeps each `never` guard, so mixed bags never
 * compiled; it did make each arm's own field optional, which the narrowed signature closes. The runtime assertions
 * are the paired positive: a signature that rejected everything would satisfy every directive here.
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
		// @ts-expect-error a `.request` record may not carry `status`: one record cannot hold both the body and the response.
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
		// @ts-expect-error the headers and request hooks write two records, or the wire-capture ordering assertion breaks.
		const impossible = wireRecord("main.headers", { headers: {}, payload: {} });

		expect(field(impossible, "headers")).toEqual({});
	});

	it("rejects a request record with no payload at all", () => {
		// @ts-expect-error the arm's own field is required: a `.request` record with no payload says nothing.
		const empty = wireRecord("main.request", {});

		expect(
			field(empty, "kind"),
			"the kind survives even on the shape the type rejects, which is what makes the runtime " +
				"half of this case meaningful",
		).toBe("main.request");
	});
});
