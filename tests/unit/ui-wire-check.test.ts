import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
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
	it("flags truncation by redaction and counts a fully truncated prompt as missing", () => {
		const w = analyseWire([req("s1", "[redacted:truncated]"), req("s1", "[redacted:truncated]")], { probes: [] });
		expect(w.truncated).toBe(true);
		expect(w.missing).toBe(2);
		expect(w.hashes).toEqual([]);
	});
	it("counts requests with no system text as missing", () => {
		const noSystem = JSON.stringify({ kind: "main.request", sessionId: "s1", payload: { messages: [{ role: "user", content: "u" }] } });
		const w = analyseWire([noSystem, noSystem], { probes: ["u"] });
		expect(w.missing).toBe(2);
		expect(w.probeHits).toEqual([]);
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
	it("is insufficient, never a pass, when no system text was extracted", () => {
		const noSystem = JSON.stringify({ kind: "main.request", sessionId: "s1", payload: { contents: [] } });
		const w = analyseWire([noSystem, noSystem], { probes: ["ky-leak"] });
		const v = verdict(w, [{ corr: "c", ratio: 0.9 }], 0.5);
		expect(v.status).toBe("INSUFFICIENT");
		expect(v.reasons.join(" ")).toContain("no extractable system text");
	});
	it("is insufficient when redaction truncated the whole system prompt", () => {
		const w = analyseWire([req("s1", "[redacted:truncated]"), req("s1", "[redacted:truncated]")], { probes: [] });
		expect(verdict(w, [{ corr: "c", ratio: 0.9 }], 0.5).status).toBe("INSUFFICIENT");
	});
	it("is insufficient with no turn-2 ratio", () => {
		expect(verdict(good, [], 0.5).status).toBe("INSUFFICIENT");
	});
});

describe("launcher", () => {
	const sh = (() => {
		const finder = process.platform === "win32" ? "where" : "which";
		const found = spawnSync(finder, ["sh"], { encoding: "utf-8", windowsHide: true });
		return (found.stdout ?? "").split(/\r?\n/).find((l) => l.trim().length > 0)!.trim();
	})();
	const fwd = (p: string) => p.split("\\").join("/");
	const launcher = fwd(join(repoRoot(), "scripts", "ui-wire-check.sh"));
	const dirs: string[] = [];
	afterAll(() => {
		for (const d of dirs) rmSync(d, { recursive: true, force: true });
	});

	function fixture(systems: string[], turnRows: string[] = [row("s1", "s1#1", 100, 0), row("s1", "s1#2", 10, 90)]): string {
		const dir = mkdtempSync(join(tmpdir(), "ui-wire-"));
		dirs.push(dir);
		writeFileSync(join(dir, "wire-2026-10-13.jsonl"), `${systems.map((s) => req("s1", s)).join("\n")}\n`);
		writeFileSync(join(dir, "turns-2026-10-13.jsonl"), `${turnRows.join("\n")}\n`);
		return dir;
	}
	const run = (args: string[]) => spawnSync(sh, [launcher, ...args], { encoding: "utf-8", windowsHide: true });
	const base = (dir: string) => ["--logs", fwd(dir), "--date", "2026-10-13"];

	it("passes on stable prompts and high ratios", () => {
		const r = run(base(fixture(["same", "same"])));
		expect(r.status).toBe(0);
		expect(r.stdout).toContain("PASS");
	});
	it("fails when a prompt differs", () => {
		const r = run(base(fixture(["a", "b"])));
		expect(r.status).toBe(1);
		expect(r.stdout).toContain("FAIL");
		expect(r.stdout).toContain("system prompt differs");
	});
	it("fails on a probe hit and names it", () => {
		const r = run([...base(fixture(["has ky-leak", "has ky-leak"])), "--probe", "ky-leak"]);
		expect(r.status).toBe(1);
		expect(r.stdout).toContain("ky-leak");
	});
	it("never prints the system text", () => {
		const r = run(base(fixture(["secret-sentence-xyz", "secret-sentence-xyz"])));
		expect(r.stdout).not.toContain("secret-sentence-xyz");
	});
	it("exits 2 naming the missing file", () => {
		const dir = mkdtempSync(join(tmpdir(), "ui-wire-"));
		dirs.push(dir);
		const r = run(base(dir));
		expect(r.status).toBe(2);
		expect(r.stdout).toContain("wire-2026-10-13.jsonl");
	});
	it("rejects an empty probe instead of checking nothing", () => {
		const r = run([...base(fixture(["same", "same"])), "--probe", ""]);
		expect(r.status).toBe(64);
		expect(r.stderr).toContain("--probe must not be empty");
	});
	it("rejects an unknown flag with usage", () => {
		const r = run(["--bogus", "1"]);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toContain("usage");
	});
});
