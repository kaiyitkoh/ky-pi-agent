import { describe, expect, it } from "vitest";

import {
  formatStatusline,
  formatTokens,
  parsePorcelain,
  sanitizeLabel,
  type Fg,
} from "../../.pi/extensions/ui/statusline.ts";
import { createAgentTracker } from "../../.pi/extensions/ui/agents.ts";

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
