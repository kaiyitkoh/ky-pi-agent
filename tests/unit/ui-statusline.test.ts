import { describe, expect, it } from "vitest";

import {
  formatStatusline,
  formatTokens,
  parsePorcelain,
  sanitizeLabel,
  type Fg,
} from "../../.pi/extensions/ui/statusline.ts";
import { createAgentTracker } from "../../.pi/extensions/ui/agents.ts";
import { createGitProbe, GIT_STATUS_ARGS, type ProbeResult } from "../../.pi/extensions/ui/git-probe.ts";

const id: Fg = (_c, s) => s;
const tag: Fg = (c, s) => `<${c}>${s}`;

describe("formatStatusline", () => {
  it("renders every segment in fixed order", () => {
    expect(
      formatStatusline(
        { mode: "cheap", provider: "deepseek", contextLeftTokens: 870000, changedFiles: 3, agentsRunning: 2 },
        id,
      ),
    ).toBe("cheap deepseek · 870k left · 3 changed · 2 agents");
  });

  it("marks escalation", () => {
    expect(formatStatusline({ mode: "max", escalated: true }, id)).toBe("max↑");
  });

  it("singular agent and zero changed files", () => {
    expect(formatStatusline({ agentsRunning: 1 }, id)).toBe("1 agent");
    expect(formatStatusline({ changedFiles: 0 }, id)).toBe("0 changed");
  });

  it("yields undefined when nothing is known or nothing runs", () => {
    expect(formatStatusline({ agentsRunning: 0 }, id)).toBeUndefined();
    expect(formatStatusline({}, id)).toBeUndefined();
  });

  it("clamps negative remaining context", () => {
    expect(formatStatusline({ contextLeftTokens: -5 }, id)).toBe("0 left");
  });

  it("strips escape and bell from provider", () => {
    const out = formatStatusline({ provider: "\u001b[31mevil\u0007" }, id) ?? "";
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("\u0007");
    expect(out).toContain("evil");
  });

  it("stays within 64 visible columns in the worst case", () => {
    const out = formatStatusline(
      {
        mode: "balanced",
        escalated: true,
        provider: "a".repeat(40),
        contextLeftTokens: 999999,
        changedFiles: 999,
        agentsRunning: 99,
      },
      id,
    );
    expect((out ?? "").length).toBeLessThanOrEqual(64);
  });

  it("routes colours per segment", () => {
    const out = formatStatusline(
      { mode: "max", escalated: true, provider: "p", contextLeftTokens: 10, changedFiles: 2, agentsRunning: 1 },
      tag,
    ) as string;
    expect(out).toContain("<accent>max");
    expect(out).toContain("<warning>↑");
    expect(out).toContain("<muted>p");
    expect(out).toContain("<warning>2 changed");
    expect(out).toContain("<accent>1 agent");
    expect(out).toMatch(/<dim> · /);
  });
});

describe("parsePorcelain", () => {
  it("counts non-empty lines", () => {
    expect(parsePorcelain("")).toBe(0);
    expect(parsePorcelain(" M a\n?? b\n")).toBe(2);
    expect(parsePorcelain(" M a\r\n?? b\r\n")).toBe(2);
    expect(parsePorcelain("\n\n")).toBe(0);
  });
});

describe("formatTokens", () => {
  it("floors and abbreviates", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(870000)).toBe("870k");
    expect(formatTokens(1200000)).toBe("1.2M");
    expect(formatTokens(1999)).toBe("1k");
  });
});

describe("sanitizeLabel", () => {
  it("rejects non-strings and empties, truncates long values", () => {
    expect(sanitizeLabel(5)).toBeUndefined();
    expect(sanitizeLabel("\u0007 ")).toBeUndefined();
    expect(sanitizeLabel("abcdefghij", 5)).toBe("abcd…");
    expect(sanitizeLabel("a\u001b]0;title\u0007b")).toBe("ab");
  });
});

describe("agent tracker", () => {
  it("counts async runs up and down", () => {
    const t = createAgentTracker();
    expect(t.onBusEvent("subagent:async-started", { id: "r1" })).toBe(true);
    t.onBusEvent("subagent:async-started", { id: "r2" });
    expect(t.running()).toBe(2);
    t.onBusEvent("subagent:async-complete", { id: "r1" });
    expect(t.running()).toBe(1);
    t.onBusEvent("subagent:async-complete", { runId: "r2" });
    expect(t.running()).toBe(0);
  });

  it("counts foreground subagent tool calls only", () => {
    const t = createAgentTracker();
    expect(t.onToolStart("subagent", "c1")).toBe(true);
    expect(t.running()).toBe(1);
    expect(t.onToolStart("read", "c2")).toBe(false);
    expect(t.running()).toBe(1);
    expect(t.onToolEnd("subagent", "c1")).toBe(true);
    expect(t.running()).toBe(0);
  });

  it("does not count management actions or async launches as foreground runs", () => {
    const t = createAgentTracker();
    expect(t.onToolStart("subagent", "c1", { action: "status" })).toBe(false);
    expect(t.onToolStart("subagent", "c2", { action: "steer", id: "r1" })).toBe(false);
    expect(t.onToolStart("subagent", "c3", { agent: "scout", task: "x", async: true })).toBe(false);
    expect(t.running()).toBe(0);
    t.onBusEvent("subagent:async-started", { id: "r1" });
    expect(t.running()).toBe(1);
    expect(t.onToolStart("subagent", "c4", { agent: "scout", task: "x" })).toBe(true);
    expect(t.running()).toBe(2);
  });

  it("drops an async run on process-terminal even without a delivered completion", () => {
    const t = createAgentTracker();
    t.onBusEvent("subagent:async-started", { id: "r1" });
    expect(t.onBusEvent("subagent:process-terminal", { version: 1, state: "observed", runId: "r1" })).toBe(true);
    expect(t.running()).toBe(0);
    expect(t.onBusEvent("subagent:async-complete", { id: "r1" })).toBe(false);
    expect(t.running()).toBe(0);
  });

  it("dedupes starts and ignores unknown completes", () => {
    const t = createAgentTracker();
    t.onBusEvent("subagent:async-started", { id: "r1" });
    expect(t.onBusEvent("subagent:async-started", { id: "r1" })).toBe(false);
    expect(t.running()).toBe(1);
    expect(t.onBusEvent("subagent:async-complete", { id: "zzz" })).toBe(false);
    expect(t.running()).toBe(1);
  });

  it("ignores malformed payloads", () => {
    const t = createAgentTracker();
    for (const topic of ["subagent:async-started", "subagent:async-complete"]) {
      for (const p of [null, 42, "x", { id: 5 }, { id: "" }, {}]) {
        expect(() => t.onBusEvent(topic, p)).not.toThrow();
      }
    }
    expect(t.onToolStart(5, null)).toBe(false);
    expect(t.onToolStart("subagent", 7)).toBe(false);
    expect(t.running()).toBe(0);
  });

  it("reset returns to zero", () => {
    const t = createAgentTracker();
    t.onBusEvent("subagent:async-started", { id: "r1" });
    t.onToolStart("subagent", "c1");
    t.reset();
    expect(t.running()).toBe(0);
  });
});

describe("git probe", () => {
  function setup(minIntervalMs?: number) {
    let clock = 1000;
    const calls: Array<{ args: readonly string[]; resolve: (r: ProbeResult) => void; reject: (e: unknown) => void }> = [];
    const scheduled: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
    const results: Array<number | undefined> = [];
    const probe = createGitProbe({
      exec: (args) =>
        new Promise<ProbeResult>((resolve, reject) => {
          calls.push({ args, resolve, reject });
        }),
      onResult: (c) => results.push(c),
      now: () => clock,
      schedule: (fn, ms) => {
        const entry = { fn, ms, cancelled: false };
        scheduled.push(entry);
        return () => {
          entry.cancelled = true;
        };
      },
      minIntervalMs,
    });
    const tick = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    return { probe, calls, scheduled, results, advance: (ms: number) => (clock += ms), tick };
  }

  it("runs the fixed argv and reports the count", async () => {
    const h = setup();
    h.probe.trigger();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].args).toEqual(GIT_STATUS_ARGS);
    h.calls[0].resolve({ stdout: " M a\n", code: 0 });
    await h.tick();
    expect(h.results).toEqual([1]);
  });

  it("collapses triggers during a run into one trailing run", async () => {
    const h = setup(0);
    h.probe.trigger();
    h.probe.trigger();
    h.probe.trigger();
    h.probe.trigger();
    expect(h.calls).toHaveLength(1);
    h.calls[0].resolve({ stdout: "", code: 0 });
    await h.tick();
    expect(h.calls).toHaveLength(2);
    h.calls[1].resolve({ stdout: "", code: 0 });
    await h.tick();
    expect(h.calls).toHaveLength(2);
  });

  it("rate-limits with a single scheduled run at the remaining delay", async () => {
    const h = setup(2000);
    h.probe.trigger();
    h.calls[0].resolve({ stdout: "", code: 0 });
    await h.tick();
    h.advance(500);
    h.probe.trigger();
    h.probe.trigger();
    expect(h.calls).toHaveLength(1);
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0].ms).toBe(1500);
    h.advance(1500);
    h.scheduled[0].fn();
    expect(h.calls).toHaveLength(2);
  });

  it("backs off to four times the last duration", async () => {
    const h = setup(2000);
    h.probe.trigger();
    h.advance(1000);
    h.calls[0].resolve({ stdout: "", code: 0 });
    await h.tick();
    h.probe.trigger();
    expect(h.calls).toHaveLength(1);
    expect(h.scheduled[0].ms).toBe(3000);
  });

  it("stops after exit 128 until reset", async () => {
    const h = setup(0);
    h.probe.trigger();
    h.calls[0].resolve({ stdout: "", code: 128 });
    await h.tick();
    expect(h.results).toEqual([undefined]);
    h.probe.trigger();
    expect(h.calls).toHaveLength(1);
    h.probe.reset();
    h.probe.trigger();
    expect(h.calls).toHaveLength(2);
  });

  it("reports undefined on failure without throwing", async () => {
    const h = setup(0);
    h.probe.trigger();
    h.calls[0].resolve({ stdout: " M a\n", code: 1 });
    await h.tick();
    h.probe.trigger();
    h.calls[1].resolve({ stdout: " M a\n", code: 0, killed: true });
    await h.tick();
    h.probe.trigger();
    h.calls[2].reject(new Error("boom"));
    await h.tick();
    expect(h.results).toEqual([undefined, undefined, undefined]);
  });

  it("drops the result of a run that reset superseded", async () => {
    const h = setup(0);
    h.probe.trigger();
    h.probe.reset();
    h.calls[0].resolve({ stdout: " M a\n", code: 0 });
    await h.tick();
    expect(h.results).toEqual([]);
  });

  it("dispose cancels a scheduled run", async () => {
    const h = setup(2000);
    h.probe.trigger();
    h.calls[0].resolve({ stdout: "", code: 0 });
    await h.tick();
    h.probe.trigger();
    expect(h.scheduled).toHaveLength(1);
    h.probe.dispose();
    expect(h.scheduled[0].cancelled).toBe(true);
  });
});
