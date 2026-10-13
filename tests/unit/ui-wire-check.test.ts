import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { analyseWire, extractSystemText, turnRatios, verdict } from "../../scripts/ui-wire-check-core.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const req = (sessionId: string, system: string, kind = "main.request") =>
	JSON.stringify({ kind, sessionId, corr: `${sessionId}#1`, payload: { messages: [{ role: "system", content: system }] } });

describe("extractSystemText", () => {
	it("reads an OpenAI system message", () => {
		expect(extractSystemText({ messages: [{ role: "user", content: "u" }, { role: "system", content: "S" }] })).toBe("S");
	});
	it("reads the developer role", () => {
		expect(extractSystemText({ messages: [{ role: "developer", content: "D" }] })).toBe("D");
	});
	it("joins text parts", () => {
		const content = [{ type: "text", text: "A" }, { type: "text", text: "B" }];
		expect(extractSystemText({ messages: [{ role: "system", content }] })).toBe("A\nB");
	});
	it("reads Responses instructions", () => {
		expect(extractSystemText({ instructions: "I" })).toBe("I");
	});
	it("reads Bedrock system blocks", () => {
		expect(extractSystemText({ system: [{ text: "X" }, { text: "Y" }] })).toBe("X\nY");
	});
	it("reads an Anthropic system string", () => {
		expect(extractSystemText({ system: "Z" })).toBe("Z");
	});
	it("returns undefined when absent", () => {
		expect(extractSystemText({ messages: [{ role: "user", content: "u" }] })).toBeUndefined();
	});
	it("returns undefined for non-objects", () => {
		expect(extractSystemText(null)).toBeUndefined();
		expect(extractSystemText(7)).toBeUndefined();
	});
});

describe("analyseWire", () => {
	it("is stable when every system prompt matches", () => {
		const w = analyseWire([req("s1", "same"), req("s1", "same"), req("s1", "same")], { probes: [] });
		expect(w.requests).toBe(3);
		expect(w.stable).toBe(true);
		expect(w.hashes).toEqual([sha("same"), sha("same"), sha("same")]);
		expect(w.sessionId).toBe("s1");
	});
	it("is unstable when one differs", () => {
		const w = analyseWire([req("s1", "a"), req("s1", "b"), req("s1", "a")], { probes: [] });
		expect(w.stable).toBe(false);
	});
	it("reports probe hits with a 1-based request index", () => {
		const w = analyseWire([req("s1", "a"), req("s1", "on feature/x now")], { probes: ["feature/x"] });
		expect(w.probeHits).toEqual([{ probe: "feature/x", request: 2 }]);
	});
	it("ignores other sessions and other kinds", () => {
		const w = analyseWire([req("s0", "zzz"), req("s1", "a", "tool.request"), req("s1", "a")], { sessionId: "s1", probes: [] });
		expect(w.requests).toBe(1);
	});
	it("skips malformed lines and empty probes", () => {
		const w = analyseWire(["{nope", req("s1", "a"), req("s1", "a")], { probes: ["", "a"] });
		expect(w.requests).toBe(2);
		expect(w.probeHits.map((h) => h.probe)).toEqual(["a", "a"]);
	});
	it("honours last", () => {
		const w = analyseWire([req("s1", "a"), req("s1", "b"), req("s1", "b")], { last: 2, probes: [] });
		expect(w.requests).toBe(2);
		expect(w.stable).toBe(true);
	});
	it("flags truncation by redaction", () => {
		const w = analyseWire([req("s1", "[redacted:truncated]"), req("s1", "[redacted:truncated]")], { probes: [] });
		expect(w.truncated).toBe(true);
	});
});

const row = (sessionId: string, corr: string, input: number, cacheRead: number) =>
	JSON.stringify({ kind: "turn", sessionId, corr, input, cacheRead });

describe("turnRatios", () => {
	it("returns turns 2+ with ratios", () => {
		const r = turnRatios([row("s1", "s1#1", 100, 0), row("s1", "s1#2", 100, 300), row("s1", "s1#3", 50, 150)], "s1");
		expect(r).toEqual([{ corr: "s1#2", ratio: 0.75 }, { corr: "s1#3", ratio: 0.75 }]);
	});
	it("skips a zero denominator", () => {
		expect(turnRatios([row("s1", "s1#1", 1, 0), row("s1", "s1#2", 0, 0)], "s1")).toEqual([]);
	});
});

describe("verdict", () => {
	const good = analyseWire([req("s1", "a"), req("s1", "a")], { probes: [] });
	it("passes", () => {
		expect(verdict(good, [{ corr: "c", ratio: 0.9 }, { corr: "d", ratio: 0.85 }], 0.5).status).toBe("PASS");
	});
	it("fails on a probe hit", () => {
		const w = analyseWire([req("s1", "a x"), req("s1", "a x")], { probes: ["x"] });
		const v = verdict(w, [{ corr: "c", ratio: 0.9 }], 0.5);
		expect(v.status).toBe("FAIL");
		expect(v.reasons.join(" ")).toContain("x");
	});
	it("fails when unstable", () => {
		const w = analyseWire([req("s1", "a"), req("s1", "b")], { probes: [] });
		const v = verdict(w, [{ corr: "c", ratio: 0.9 }], 0.5);
		expect(v.status).toBe("FAIL");
		expect(v.reasons.join(" ")).toContain("system prompt differs");
	});
	it("fails on a low ratio", () => {
		expect(verdict(good, [{ corr: "c", ratio: 0.1 }], 0.5).status).toBe("FAIL");
	});
	it("is insufficient with one request", () => {
		const w = analyseWire([req("s1", "a")], { probes: [] });
		expect(verdict(w, [{ corr: "c", ratio: 0.9 }], 0.5).status).toBe("INSUFFICIENT");
	});
	it("is insufficient with no turn-2 ratio", () => {
		expect(verdict(good, [], 0.5).status).toBe("INSUFFICIENT");
	});
});
