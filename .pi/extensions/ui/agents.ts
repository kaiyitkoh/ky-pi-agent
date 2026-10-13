export const SUBAGENT_BUS_TOPICS = ["subagent:async-started", "subagent:async-complete"] as const;

function idOf(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const p = payload as { id?: unknown; runId?: unknown };
  for (const candidate of [p.id, p.runId]) {
    if (typeof candidate === "string" && candidate !== "") return candidate;
  }
  return undefined;
}

/**
 * Child-status and foreground-complete bus events are deliberately not counted:
 * children belong to a run already counted, and foreground runs are already
 * tracked through their tool call.
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
      if (topic === "subagent:async-complete") return asyncIds.delete(id);
      return false;
    },
    onToolStart(toolName: unknown, toolCallId: unknown): boolean {
      if (toolName !== "subagent" || typeof toolCallId !== "string" || toolCallId === "") return false;
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
