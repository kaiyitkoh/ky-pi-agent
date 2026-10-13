// pi-subagents@0.76.1 emits async-complete only after delivery to the owning session
// (src/runs/background/result-watcher.js:528); process-terminal fires whenever the runner exits.
export const SUBAGENT_BUS_TOPICS = [
  "subagent:async-started",
  "subagent:async-complete",
  "subagent:process-terminal",
] as const;

function idOf(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const p = payload as { id?: unknown; runId?: unknown };
  for (const candidate of [p.id, p.runId]) {
    if (typeof candidate === "string" && candidate !== "") return candidate;
  }
  return undefined;
}

function isForegroundLaunch(args: unknown): boolean {
  if (typeof args !== "object" || args === null) return true;
  const a = args as { action?: unknown; async?: unknown };
  return a.action === undefined && a.async !== true;
}

/**
 * Child-status and foreground-complete bus events are deliberately not counted:
 * children belong to a run already counted, and foreground runs are already
 * tracked through their tool call. Management actions and async launches are not
 * foreground runs; an async launch is counted through its bus event instead.
 */
export function createAgentTracker() {
  const asyncIds = new Set<string>();
  const foreground = new Set<string>();

  return {
    onBusEvent(topic: string, payload: unknown): boolean {
      const id = idOf(payload);
      if (id === undefined) return false;
      if (topic === "subagent:async-started") {
        if (asyncIds.has(id)) return false;
        asyncIds.add(id);
        return true;
      }
      if (topic === "subagent:async-complete" || topic === "subagent:process-terminal") return asyncIds.delete(id);
      return false;
    },
    onToolStart(toolName: unknown, toolCallId: unknown, args?: unknown): boolean {
      if (toolName !== "subagent" || typeof toolCallId !== "string" || toolCallId === "") return false;
      if (!isForegroundLaunch(args)) return false;
      if (foreground.has(toolCallId)) return false;
      foreground.add(toolCallId);
      return true;
    },
    onToolEnd(toolName: unknown, toolCallId: unknown): boolean {
      if (toolName !== "subagent" || typeof toolCallId !== "string") return false;
      return foreground.delete(toolCallId);
    },
    running(): number {
      return asyncIds.size + foreground.size;
    },
    reset(): void {
      asyncIds.clear();
      foreground.clear();
    },
  };
}
